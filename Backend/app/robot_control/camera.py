"""카메라 MJPEG 스트리밍 엔드포인트.

카메라(RTSP)당 업스트림 연결을 하나만 연다(`_CameraStream`). 대시보드 슬롯과
확대 모달이 같은 카메라를 동시에 봐도 RTSP 세션은 카메라당 1개로 유지된다.
→ 카메라 서버의 동시 세션 한도 초과로 인한 디코딩 깨짐('Could not find ref
with POC')과 무한 끊김/깜빡임을 방지한다. 클라이언트가 모두 나가면 유예시간
후 업스트림을 닫는다.
"""

import asyncio
import threading
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

import cv2
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.database.database import SessionLocal
from app.database.models import RobotModule, RobotInfo

router = APIRouter()

READ_TIMEOUT_SEC = 5.0

# ── 투명 재연결 / 송출 파라미터 ──
_RECONNECT_DELAY_MIN = 1.0    # 재연결 대기 시작값(초)
_RECONNECT_DELAY_MAX = 5.0    # 재연결 대기 상한(초)
_STREAM_STALL_SEC = 5.0       # 이 시간 동안 정상 프레임이 없으면 캡처 폐기 후 재연결
_READ_FAIL_SLEEP = 0.02       # 읽기 실패 시 짧은 대기 — busy-spin 방지
_STREAM_GRACE_SEC = 15.0      # 마지막 클라이언트가 나간 뒤 업스트림 유지 시간(초)
_EMIT_INTERVAL = 0.04         # MJPEG 송출 주기(초) — 약 25fps 상한
_HOLD_FRAME_INTERVAL = 0.5    # 새 프레임이 없을 때 마지막 프레임 재송출 간격(초)
_JPEG_QUALITY = 75            # MJPEG JPEG 품질(1-100)
_MAX_FRAME_WIDTH = 1280       # 이보다 넓은 프레임은 다운스케일
_CORRUPT_STD_THRESHOLD = 3.0  # 프레임 표준편차가 이보다 낮으면 디코딩 깨짐(회색)으로 간주


def _mjpeg_part(jpeg_bytes: bytes) -> bytes:
    """MJPEG multipart 한 파트로 감싼다."""
    return b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg_bytes + b"\r\n"


def _encode_jpeg(frame) -> bytes | None:
    """프레임을 (필요 시 다운스케일하여) JPEG 바이트로 인코딩."""
    h, w = frame.shape[:2]
    if w > _MAX_FRAME_WIDTH:
        scale = _MAX_FRAME_WIDTH / w
        frame = cv2.resize(
            frame, (_MAX_FRAME_WIDTH, max(1, int(h * scale))),
            interpolation=cv2.INTER_AREA,
        )
    ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, _JPEG_QUALITY])
    return jpeg.tobytes() if ok else None


def _is_corrupt_frame(frame) -> bool:
    """디코딩 깨짐(회색) 프레임인지 판정.

    HEVC 디코더가 참조 프레임(IDR)을 못 찾으면('Could not find ref with POC')
    거의 단색(회색) 프레임을 내놓는다. 정상 영상은 텍스처가 있어 표준편차가
    크고, 깨진 프레임은 거의 균일해 표준편차가 0에 가깝다. 정상 프레임이
    이 임계값 아래로 내려갈 일은 사실상 없어 오판 위험은 무시할 수준이다.
    비용 절감을 위해 8px 간격으로 희소 샘플링한다.
    """
    try:
        return float(frame[::8, ::8].std()) < _CORRUPT_STD_THRESHOLD
    except Exception:
        return False


# ── 카메라별 공유 업스트림 ──────────────────────────────────────────────
_streams: dict[str, "_CameraStream"] = {}
_streams_lock = threading.Lock()


class _CameraStream:
    """한 RTSP URL에 대한 공유 업스트림.

    전용 리더 스레드가 RTSP를 쉬지 않고 읽어 '최신 JPEG 프레임'만 유지한다
    (+투명 재연결). 여러 HTTP 클라이언트가 `latest`를 공유 송출하므로,
    클라이언트 수와 무관하게 카메라당 RTSP 세션은 항상 1개다.

    OpenCV VideoCapture(FFmpeg)는 동일 스레드에서 open/read/release 되어야
    하므로 모든 cv2.VideoCapture 호출을 리더 스레드 한 곳에 고정한다.

    동시성: `_refcount`/`_idle_since`는 `_streams_lock`으로 보호한다.
    `latest`는 튜플 통째 교체라 GIL 하 원자적 — 별도 락 불필요.
    """

    def __init__(self, rtsp_url: str):
        self.rtsp_url = rtsp_url
        self.latest: tuple = (0, None)   # (seq, jpeg_bytes)
        self._refcount = 0               # 시청 중인 클라이언트 수
        self._idle_since = 0.0           # refcount 0이 된 시각
        self._thread: threading.Thread | None = None

    def _start(self) -> None:
        self._thread = threading.Thread(
            target=self._run, name="cam-stream", daemon=True
        )
        self._thread.start()

    def _run(self) -> None:
        cap = None
        seq = 0
        last_good_time = 0.0   # 마지막 '정상'(깨지지 않은) 프레임 시각
        reconnect_delay = _RECONNECT_DELAY_MIN
        try:
            while True:
                # 종료 판정 — refcount 0으로 유예시간 경과 시 레지스트리에서 제거.
                # 판정+제거를 한 락 안에서 처리해 acquire 와의 경쟁을 막는다.
                with _streams_lock:
                    if (self._refcount <= 0 and self._idle_since > 0
                            and time.time() - self._idle_since > _STREAM_GRACE_SEC):
                        if _streams.get(self.rtsp_url) is self:
                            del _streams[self.rtsp_url]
                        break

                try:
                    # ── (재)연결 ──
                    if cap is None:
                        cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
                        try:
                            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, int(READ_TIMEOUT_SEC * 1000))
                            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, int(READ_TIMEOUT_SEC * 1000))
                            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # 최신 프레임만 — 누적 지연 방지
                        except Exception:
                            pass
                        if not cap.isOpened():
                            cap.release()
                            cap = None
                            time.sleep(reconnect_delay)
                            reconnect_delay = min(reconnect_delay * 1.5, _RECONNECT_DELAY_MAX)
                            continue
                        reconnect_delay = _RECONNECT_DELAY_MIN
                        last_good_time = time.time()  # 첫 프레임 대기 유예 시작

                    # ── 프레임 읽기 + 품질 검사 ──
                    ret, frame = cap.read()
                    now = time.time()
                    if ret and frame is not None and not _is_corrupt_frame(frame):
                        # 정상 프레임 — 갱신
                        last_good_time = now
                        jpeg = _encode_jpeg(frame)
                        if jpeg is not None:
                            seq += 1
                            self.latest = (seq, jpeg)  # 원자적 교체
                        continue

                    # 비정상 — 읽기 실패 또는 디코딩 깨짐(회색) 프레임.
                    # 깨진 프레임은 버려서 마지막 '정상' 프레임을 유지한다(회색 깜빡임 방지).
                    # 일정 시간 정상 프레임이 없으면 캡처를 폐기·재연결 → 새 RTSP 세션에서
                    # 카메라가 IDR(키프레임)을 다시 보내 깨짐이 복구된다.
                    if now - last_good_time > _STREAM_STALL_SEC:
                        cap.release()
                        cap = None
                    else:
                        time.sleep(_READ_FAIL_SLEEP)
                except Exception:
                    # 일시 오류 — 캡처 폐기 후 재연결 (리더 스레드는 죽지 않음)
                    if cap is not None:
                        try:
                            cap.release()
                        except Exception:
                            pass
                    cap = None
                    time.sleep(_READ_FAIL_SLEEP)
        finally:
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
            # 비정상 종료 대비 — 레지스트리에서 확실히 제거
            with _streams_lock:
                if _streams.get(self.rtsp_url) is self:
                    del _streams[self.rtsp_url]


def _acquire_stream(rtsp_url: str) -> _CameraStream:
    """rtsp_url 의 공유 스트림에 클라이언트 1명 등록 (없으면 생성·시작)."""
    with _streams_lock:
        s = _streams.get(rtsp_url)
        if s is None:
            s = _CameraStream(rtsp_url)
            _streams[rtsp_url] = s
            s._refcount = 1
            s._start()
        else:
            s._refcount += 1
            s._idle_since = 0.0
        return s


def _release_stream(s: _CameraStream) -> None:
    """클라이언트 1명 해제. refcount 0이면 유예 타이머 시작."""
    with _streams_lock:
        s._refcount -= 1
        if s._refcount <= 0:
            s._refcount = 0
            s._idle_since = time.time()


async def _camera_mjpeg(rtsp_url: str, request: Request):
    """공유 스트림의 최신 프레임을 MJPEG로 송출하는 제너레이터.

    실제 RTSP 디코딩은 `_CameraStream` 리더 스레드가 전담하고, 이 제너레이터는
    `latest`를 일정 주기로 꺼내 보내기만 한다(이벤트 루프 부하 최소). 새 프레임이
    없으면(끊김/재연결 중) 마지막 프레임을 유지 송출 → 브라우저는 끊김을 모른다.
    클라이언트가 연결을 닫으면 종료하고 스트림 refcount를 해제한다.
    """
    stream = _acquire_stream(rtsp_url)
    last_seq = -1
    last_jpeg: bytes | None = None
    last_emit = 0.0
    try:
        while True:
            if await request.is_disconnected():
                break
            seq, jpeg = stream.latest
            now = time.time()
            if jpeg is not None and seq != last_seq:
                # 새 프레임 — 즉시 송출
                last_seq = seq
                last_jpeg = jpeg
                last_emit = now
                yield _mjpeg_part(jpeg)
            elif last_jpeg is not None and (now - last_emit) >= _HOLD_FRAME_INTERVAL:
                # 새 프레임 없음(끊김/재연결 중) — 마지막 프레임 유지 송출
                last_emit = now
                yield _mjpeg_part(last_jpeg)
            await asyncio.sleep(_EMIT_INTERVAL)
    except (GeneratorExit, asyncio.CancelledError):
        pass
    finally:
        _release_stream(stream)


@router.get("/Video/{module_id}")
async def stream_camera(module_id: int, request: Request):
    from app.robot_io.sender import send_to_robot

    db = SessionLocal()
    try:
        module = db.query(RobotModule).filter(RobotModule.id == module_id).first()
        if not module or module.ModuleType != "camera" or not module.camera_info:
            return StreamingResponse(iter([]), media_type="text/plain", status_code=404)

        ci = module.camera_info
        if ci.StreamType != "rtsp":
            return StreamingResponse(iter([]), media_type="text/plain", status_code=400)

        robot = db.query(RobotInfo).filter(RobotInfo.id == module.RobotId).first()
        ip = ci.CameraIP or (robot.RobotIP if robot else None)
        if not ip:
            return StreamingResponse(iter([]), media_type="text/plain", status_code=404)

        url = f"rtsp://{ip}:{ci.Port}{ci.Path}"
    finally:
        db.close()

    send_to_robot("WAKE")
    await asyncio.sleep(1)

    return StreamingResponse(
        _camera_mjpeg(url, request),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


# ── PTZ ────────────────────────────────────────────────────────────────
# HTTP 스트림(현재 열화상 MJPEG 재송출 서버)에 /ptz/zoom 핸들러가 있는 카메라만 지원.
# RTSP 카메라는 백엔드에서 직접 ISAPI를 부르려면 카메라 자체 IP/credentials가
# DB에 있어야 하는데, 그건 도입 시점에 별도로 작업하기로 함.
@router.post("/Video/{module_id}/ptz")
def ptz_camera(module_id: int, action: str):
    """action: 'zoom_in' | 'zoom_out' (단발). 500ms 후 카메라가 자동 정지."""
    if action == "zoom_in":
        direction = "in"
    elif action == "zoom_out":
        direction = "out"
    else:
        raise HTTPException(400, "action must be 'zoom_in' or 'zoom_out'")

    db = SessionLocal()
    try:
        module = db.query(RobotModule).filter(RobotModule.id == module_id).first()
        if not module or module.ModuleType != "camera" or not module.camera_info:
            raise HTTPException(404, "camera module not found")
        ci = module.camera_info
        if ci.StreamType != "http":
            raise HTTPException(400, f"PTZ only supported on http stream cameras (got '{ci.StreamType}')")
        robot = db.query(RobotInfo).filter(RobotInfo.id == module.RobotId).first()
        ip = ci.CameraIP or (robot.RobotIP if robot else None)
        if not ip:
            raise HTTPException(404, "camera ip not configured")
        target = f"http://{ip}:{ci.Port}/ptz/zoom"
    finally:
        db.close()

    url = f"{target}?{urlencode({'dir': direction})}"
    print(f"[PTZ] forwarding to {url}")
    try:
        with urlopen(UrlRequest(url, method="POST", data=b""), timeout=5) as resp:
            status = resp.status
            body = resp.read(200).decode("utf-8", errors="replace")
            print(f"[PTZ] upstream {status}: {body}")
            if status != 200:
                raise HTTPException(502, f"upstream returned {status}: {body}")
    except URLError as e:
        print(f"[PTZ] upstream unreachable: {e}")
        raise HTTPException(502, f"upstream unreachable: {e}")
    return JSONResponse({"ok": True})
