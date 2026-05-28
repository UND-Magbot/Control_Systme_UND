"""백엔드 콘솔 로그를 실시간으로 텍스트 파일에 기록하는 모듈.

목적:
    장기간 자율주행 반복 테스트 중 발생하는 오류를 사후에 검출하기 위해,
    백엔드 프로세스의 모든 콘솔 출력(print, uvicorn 로그 등)을 실시간으로
    프로젝트 루트의 ``backend_logs/`` 폴더에 텍스트 파일로 남긴다.

동작:
    - 서버 실행마다 새 로그 파일 1개를 생성한다
      (``run_NNNN_YYYYMMDD_HHMMSS.log``).
    - 파일 상단 헤더에 '몇 번째 실행'인지와 시작 시각을 표기한다.
    - 모든 출력 라인 앞에 ``[YYYY-MM-DD HH:MM:SS.mmm]`` 타임스탬프를 붙인다.
    - 기존 콘솔(stdout/stderr) 출력은 그대로 유지하면서 파일에도
      동시에 기록한다(tee 방식).
"""

import atexit
import gzip
import logging
import os
import re
import sys
import threading
import time
import zipfile
from datetime import datetime

# 프로젝트 루트 = .../Backend/app/console_logger.py → app → Backend → <root>
_ROOT_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
_LOG_DIR = os.path.join(_ROOT_DIR, "backend_logs")
_COUNTER_FILE = os.path.join(_LOG_DIR, ".run_counter")

# 로그 보존 정책 (날짜 기반, mtime 기준).
# - COMPRESS_AFTER_DAYS 일 이상 지난 .log → 파일명의 YYYYMMDD 기준
#   logs_YYYYMMDD.zip 하나에 통합 후 원본 삭제 (같은 날 여러 run을 한 zip으로 묶음)
# - 기존에 남아 있는 *.log.gz 도 발견되면 풀어서 동일 zip에 마이그레이션
# - DELETE_AFTER_DAYS 일 이상 지난 .log / .log.gz / logs_*.zip → 영구 삭제
# 정리는 setup_console_logging() 호출 시(=백엔드 기동 시) 1회 실행한다.
# COMPRESS=1: 백엔드를 다음날 재기동하면 전날 로그가 자동 통합된다.
# 같은 날 안의 여러 번 재시작에서는 mtime이 24h 미만이라 통합되지 않는다.
LOG_COMPRESS_AFTER_DAYS = 1
LOG_DELETE_AFTER_DAYS = 30

_setup_done = False
_log_file = None


def _next_run_number() -> int:
    """실행 횟수 카운터를 1 증가시켜 반환한다."""
    count = 0
    try:
        with open(_COUNTER_FILE, "r", encoding="utf-8") as f:
            count = int(f.read().strip() or "0")
    except (FileNotFoundError, ValueError):
        count = 0
    count += 1
    try:
        with open(_COUNTER_FILE, "w", encoding="utf-8") as f:
            f.write(str(count))
    except OSError:
        pass
    return count


def _timestamp() -> str:
    """[YYYY-MM-DD HH:MM:SS.mmm] 용 타임스탬프 문자열을 만든다."""
    now = datetime.now()
    return now.strftime("%Y-%m-%d %H:%M:%S") + f".{now.microsecond // 1000:03d}"


class _Tee:
    """원본 스트림과 로그 파일에 동시에 쓰는 래퍼.

    파일에는 줄 단위로 타임스탬프를 붙여 기록한다. write() 호출이
    줄 중간에 끊겨도 개행이 올 때까지 버퍼링한 뒤 한 줄로 기록한다.
    """

    def __init__(self, original, file_obj, lock: threading.RLock):
        self._original = original
        self._file = file_obj
        self._lock = lock
        self._buffer = ""

    def write(self, text):
        if not text:
            return
        with self._lock:
            # 콘솔 출력은 그대로 유지
            try:
                self._original.write(text)
            except Exception:
                pass
            # 파일에는 줄 단위로 타임스탬프를 붙여 기록
            self._buffer += text
            while "\n" in self._buffer:
                line, self._buffer = self._buffer.split("\n", 1)
                try:
                    self._file.write(f"[{_timestamp()}] {line}\n")
                except Exception:
                    pass
            try:
                self._file.flush()
            except Exception:
                pass

    def flush(self):
        with self._lock:
            try:
                self._original.flush()
            except Exception:
                pass
            try:
                self._file.flush()
            except Exception:
                pass

    def isatty(self):
        try:
            return self._original.isatty()
        except Exception:
            return False

    def __getattr__(self, name):
        # encoding, fileno 등 나머지 속성은 원본 스트림에 위임
        return getattr(self._original, name)


def _redirect_logging_handlers(orig_out, orig_err, tee_out, tee_err) -> None:
    """이미 구성된 logging 스트림 핸들러를 tee로 재연결한다.

    uvicorn은 app 모듈을 import 하기 전에 로깅을 구성하므로, 그 핸들러는
    교체 이전의 원본 stdout/stderr를 참조하고 있다. 따라서 sys.stdout/
    sys.stderr 교체만으로는 uvicorn 로그가 파일에 남지 않는다. 기존
    핸들러의 스트림 자체를 tee로 바꿔주어야 한다.
    """
    loggers: list[logging.Logger] = [logging.getLogger()]
    for name in list(logging.root.manager.loggerDict.keys()):
        obj = logging.root.manager.loggerDict.get(name)
        if isinstance(obj, logging.Logger):
            loggers.append(obj)

    for lg in loggers:
        for handler in list(getattr(lg, "handlers", [])):
            # 파일 핸들러는 건드리지 않음
            if isinstance(handler, logging.FileHandler):
                continue
            if isinstance(handler, logging.StreamHandler):
                if handler.stream is orig_out:
                    handler.setStream(tee_out)
                elif handler.stream is orig_err:
                    handler.setStream(tee_err)


def _finalize() -> None:
    """프로세스 종료 시 남은 버퍼를 비우고 종료 푸터를 기록한다."""
    try:
        for stream in (sys.stdout, sys.stderr):
            if isinstance(stream, _Tee) and stream._buffer:
                stream.write("\n")
        if _log_file is not None and not _log_file.closed:
            _log_file.write(
                "================================================================\n"
                f" 종료 시각 : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                "================================================================\n"
            )
            _log_file.flush()
    except Exception:
        pass


_LOG_PAT = re.compile(r"^run_\d+_(\d{8})_\d{6}\.log$")
_GZ_PAT  = re.compile(r"^run_\d+_(\d{8})_\d{6}\.log\.gz$")
_ZIP_PAT = re.compile(r"^logs_(\d{8})\.zip$")


def _archive_into_zip(zip_path: str, arcname: str, data: bytes, mtime: float) -> None:
    """날짜별 zip(없으면 생성, 있으면 append)에 한 항목을 추가한다.

    arcname 으로 ZipInfo 를 만들고 mtime 을 date_time 으로 박는다.
    같은 이름이 이미 들어 있으면 중복 추가하지 않는다.
    """
    # 이미 같은 이름의 엔트리가 zip 안에 있는지 사전 확인 (append 충돌 회피)
    if os.path.exists(zip_path):
        try:
            with zipfile.ZipFile(zip_path, mode="r") as zf:
                if arcname in zf.namelist():
                    return
        except zipfile.BadZipFile:
            # 손상된 zip은 무시하고 새로 쓰지 않는다(다음 사이클에서 사람이 판단)
            return

    dt = datetime.fromtimestamp(mtime)
    info = zipfile.ZipInfo(
        filename=arcname,
        date_time=(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second),
    )
    info.compress_type = zipfile.ZIP_DEFLATED
    with zipfile.ZipFile(zip_path, mode="a", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(info, data)


def _rotate_old_logs(current_log_path: str | None) -> None:
    """오래된 로그 파일을 날짜별 zip 으로 묶거나 삭제한다.

    mtime 기준으로:
      - DELETE_AFTER_DAYS 이상 지난 .log / .log.gz / logs_*.zip → 영구 삭제
      - COMPRESS_AFTER_DAYS 이상 지난 .log → 파일명의 YYYYMMDD 기준
        logs_YYYYMMDD.zip 에 추가 후 원본 삭제 (같은 날 여러 run을 한 zip으로 묶음)
      - 기존 *.log.gz 도 발견되면 풀어서 같은 날짜의 zip 에 통합 후 .gz 원본 삭제
        (구 파일별 압축 구조 → 신 날짜별 zip 구조 마이그레이션)

    현재 실행에서 쓰고 있는 파일과 숨김 파일(.run_counter 등)은 건드리지 않는다.
    개별 파일 처리 실패는 경고만 남기고 계속 진행 — 로깅 자체에는 영향 없다.
    """
    if not os.path.isdir(_LOG_DIR):
        return

    now = time.time()
    compress_cutoff = now - LOG_COMPRESS_AFTER_DAYS * 86400
    delete_cutoff = now - LOG_DELETE_AFTER_DAYS * 86400
    current_abspath = os.path.abspath(current_log_path) if current_log_path else None

    bundled = 0    # 압축 zip 으로 통합된 .log 개수
    migrated = 0   # 풀어서 통합된 .log.gz 개수 (마이그레이션)
    deleted = 0    # 삭제된 항목 수 (.log/.log.gz/.zip 통합)

    for name in os.listdir(_LOG_DIR):
        # 숨김/메타 파일 제외 (예: .run_counter)
        if name.startswith("."):
            continue
        path = os.path.join(_LOG_DIR, name)
        if not os.path.isfile(path):
            continue
        # 현재 열려 있는 로그 파일은 건드리지 않음
        if current_abspath and os.path.abspath(path) == current_abspath:
            continue

        is_log = bool(_LOG_PAT.match(name))
        is_gz  = bool(_GZ_PAT.match(name))
        is_zip = bool(_ZIP_PAT.match(name))
        if not (is_log or is_gz or is_zip):
            # 로그 관련 파일이 아니면 절대 건드리지 않음 (사용자 데이터일 수 있음)
            continue

        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue

        try:
            # 1) 삭제 대상이 가장 우선 (.log / .log.gz / logs_*.zip 동일 기준)
            if mtime < delete_cutoff:
                os.remove(path)
                deleted += 1
                continue

            # 2) 압축 시점(1일) 미경과면 그대로 둠
            if mtime >= compress_cutoff:
                continue

            # 3) .log → 날짜별 zip 에 통합
            if is_log:
                date_str = _LOG_PAT.match(name).group(1)
                zip_path = os.path.join(_LOG_DIR, f"logs_{date_str}.zip")
                with open(path, "rb") as f:
                    data = f.read()
                _archive_into_zip(zip_path, name, data, mtime)
                os.remove(path)
                bundled += 1
                continue

            # 4) .log.gz → 풀어서 같은 zip 에 통합 (마이그레이션)
            if is_gz:
                date_str = _GZ_PAT.match(name).group(1)
                inner_name = name[:-3]  # ".gz" 제거 → .log
                zip_path = os.path.join(_LOG_DIR, f"logs_{date_str}.zip")
                with gzip.open(path, "rb") as f:
                    data = f.read()
                _archive_into_zip(zip_path, inner_name, data, mtime)
                os.remove(path)
                migrated += 1
                continue

            # 5) logs_*.zip 은 위 1)의 삭제 컷오프만 적용. 그 외엔 손대지 않음.

        except (OSError, zipfile.BadZipFile) as e:
            print(f"[WARN console_logger] rotation 실패 {name}: {e}")

    if bundled or migrated or deleted:
        print(
            f"[OK console_logger] 로그 정리 완료 — "
            f"날짜별 zip 통합 {bundled}개 (>{LOG_COMPRESS_AFTER_DAYS}일), "
            f"gz 마이그레이션 {migrated}개, "
            f"삭제 {deleted}개 (>{LOG_DELETE_AFTER_DAYS}일)"
        )


def setup_console_logging() -> str | None:
    """콘솔 로그 파일 출력을 설정한다.

    Returns:
        생성된 로그 파일 경로. 설정에 실패하면 None.
    """
    global _setup_done, _log_file
    if _setup_done:
        return getattr(_log_file, "name", None)
    _setup_done = True

    orig_out = sys.stdout
    orig_err = sys.stderr

    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
    except OSError as e:
        # 디렉터리 생성 실패 시 콘솔 로깅만 유지하고 조용히 포기
        print(f"[WARN console_logger] 로그 디렉터리 생성 실패: {e}")
        return None

    run_no = _next_run_number()
    started = datetime.now()
    fname = f"run_{run_no:04d}_{started.strftime('%Y%m%d_%H%M%S')}.log"
    fpath = os.path.join(_LOG_DIR, fname)

    log_file = open(fpath, "w", encoding="utf-8")
    _log_file = log_file

    log_file.write(
        "================================================================\n"
        f" 백엔드 실행 로그   |   {run_no}번째 실행\n"
        f" 시작 시각 : {started.strftime('%Y-%m-%d %H:%M:%S')}\n"
        f" PID       : {os.getpid()}\n"
        "================================================================\n"
    )
    log_file.flush()

    # stdout/stderr가 공유하는 단일 락 — 스레드 간 줄 섞임 방지
    lock = threading.RLock()
    tee_out = _Tee(orig_out, log_file, lock)
    tee_err = _Tee(orig_err, log_file, lock)
    sys.stdout = tee_out
    sys.stderr = tee_err

    _redirect_logging_handlers(orig_out, orig_err, tee_out, tee_err)
    atexit.register(_finalize)

    print(f"[OK] 콘솔 로그 파일 기록 시작: {fpath}")

    # 오래된 로그 정리(압축/삭제) — tee 설정 이후 실행해서 정리 결과도 새 로그에 남는다.
    try:
        _rotate_old_logs(fpath)
    except Exception as e:
        print(f"[WARN console_logger] 로그 정리 중 예외: {e}")

    return fpath
