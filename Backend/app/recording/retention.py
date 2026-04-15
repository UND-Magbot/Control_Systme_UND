import os
import shutil
import time
import zipfile
import threading
from datetime import datetime, timedelta

from app.database.database import SessionLocal
from app.database.models import RecordingInfo
from app.logs.service import log_event

RETENTION_DAYS = 7
CHECK_INTERVAL = 3600  # 1시간
STORAGE_WARN_PERCENT = 10   # 잔여 10% 미만 → 경고 로그
STORAGE_CRITICAL_PERCENT = 5  # 잔여 5% 미만 → 녹화 일시 중지

from app.recording.service import RECORDINGS_BASE


def retention_thread():
    """30일 보관 + ZIP 압축 + 저장소 모니터링 백그라운드 스레드"""
    while True:
        try:
            _run_retention()
            _check_storage()
        except Exception as e:
            print(f"[RETENTION] 오류: {e}")

        time.sleep(CHECK_INTERVAL)


def _run_retention():
    """30일 경과 녹화 → ZIP 압축 → Status='archived' → 원본 삭제"""
    db = SessionLocal()
    try:
        cutoff = datetime.now() - timedelta(days=RETENTION_DAYS)
        old_records = (
            db.query(RecordingInfo)
            .filter(
                RecordingInfo.Status == "completed",
                RecordingInfo.RecordStart < cutoff,
                RecordingInfo.DeletedAt.is_(None),
            )
            .all()
        )

        if not old_records:
            return

        # 날짜별로 그룹핑
        by_date: dict[str, list] = {}
        for rec in old_records:
            date_key = rec.RecordStart.strftime("%Y-%m-%d") if rec.RecordStart else "unknown"
            by_date.setdefault(date_key, []).append(rec)

        for date_key, records in by_date.items():
            zip_path = os.path.join(RECORDINGS_BASE, f"archive_{date_key}.zip")
            files_to_zip = []

            for rec in records:
                if rec.VideoPath and os.path.exists(rec.VideoPath):
                    if os.path.isdir(rec.VideoPath):
                        for f in os.listdir(rec.VideoPath):
                            fp = os.path.join(rec.VideoPath, f)
                            if os.path.isfile(fp):
                                files_to_zip.append(fp)
                    elif os.path.isfile(rec.VideoPath):
                        files_to_zip.append(rec.VideoPath)

            if files_to_zip:
                with zipfile.ZipFile(zip_path, "a", zipfile.ZIP_DEFLATED) as zf:
                    for fp in files_to_zip:
                        zf.write(fp, os.path.basename(fp))

                # 원본 삭제
                for fp in files_to_zip:
                    try:
                        os.remove(fp)
                    except Exception:
                        pass

            # DB 상태 업데이트
            for rec in records:
                rec.Status = "archived"
            db.commit()

        print(f"[RETENTION] {len(old_records)}건 아카이브 완료")
    finally:
        db.close()


def _check_storage():
    """저장소 용량 모니터링"""
    try:
        if not os.path.exists(RECORDINGS_BASE):
            return

        usage = shutil.disk_usage(RECORDINGS_BASE)
        free_percent = (usage.free / usage.total) * 100

        if free_percent < STORAGE_CRITICAL_PERCENT:
            log_event(
                "system", "storage_critical",
                f"저장소 잔여 {free_percent:.1f}% — 녹화 일시 중지",
            )
            try:
                from app.recording.manager import stop_all
                stop_all()
            except Exception:
                pass

        elif free_percent < STORAGE_WARN_PERCENT:
            log_event(
                "system", "storage_warning",
                f"저장소 잔여 {free_percent:.1f}% — 용량 부족 주의",
            )
    except Exception as e:
        print(f"[RETENTION] 저장소 확인 실패: {e}")


def start_retention_thread():
    """retention 스레드 시작"""
    t = threading.Thread(target=retention_thread, daemon=True, name="retention")
    t.start()
    print("[RETENTION] 보관 정책 스레드 시작")
