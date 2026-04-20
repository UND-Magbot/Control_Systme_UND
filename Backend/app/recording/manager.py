import os
import threading
import uuid
from datetime import datetime
from typing import Optional

from app.database.database import SessionLocal
from app.database.models import RecordingInfo, RobotInfo
from app.recording.worker import CameraRecordingWorker
from app.recording import service as rec_service

# ── 싱글턴 상태 ──
_sessions: dict[tuple, dict] = {}   # (robot_id, module_id) → SessionInfo
_lock = threading.Lock()

from app.recording.service import RECORDINGS_BASE
print(f"[REC] RECORDINGS_BASE = {RECORDINGS_BASE}")


def _build_output_dir(robot_id: int) -> str:
    date_str = datetime.now().strftime("%Y-%m-%d")
    return os.path.join(RECORDINGS_BASE, str(robot_id), date_str)


def _get_current_schedule_id() -> Optional[int]:
    """현재 실행 중인 스케줄 ID 조회 (있으면)"""
    try:
        db = SessionLocal()
        try:
            from app.database.models import ScheduleInfo
            sched = (
                db.query(ScheduleInfo)
                .filter(ScheduleInfo.TaskStatus == "running")
                .first()
            )
            return sched.id if sched else None
        finally:
            db.close()
    except Exception:
        return None


def start_auto_recording(robot_id: int):
    """네비게이션 시작 시 호출 — 로봇의 전체 카메라 자동 녹화 시작"""
    db = SessionLocal()
    try:
        # 수동 녹화 세션이 있으면 먼저 중지
        with _lock:
            to_stop = [
                key for key, info in _sessions.items()
                if key[0] == robot_id and info["record_type"] == "manual"
            ]
        for key in to_stop:
            _stop_session(key)

        # 활성 카메라 모듈 조회
        modules = rec_service.get_active_camera_modules(db, robot_id)
        if not modules:
            print(f"[REC] robot_id={robot_id}: 활성 카메라 없음, 자동 녹화 건너뜀")
            _log_recording_error(robot_id, 0, "활성 카메라 모듈 없음 — 자동 녹화 건너뜀")
            return

        group_id = str(uuid.uuid4())
        schedule_id = _get_current_schedule_id()

        # 로봇 정보 1회 조회 후 재사용 (모듈별 중복 조회 방지)
        robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()

        for module in modules:
            key = (robot_id, module.id)
            with _lock:
                if key in _sessions:
                    continue  # 이미 녹화 중

            rtsp_url = rec_service.build_rtsp_url(db, module, robot=robot)
            if not rtsp_url:
                reason = f"RTSP URL 생성 실패 (CameraIP/RobotIP 미설정)"
                print(f"[REC] module_id={module.id}: {reason}")
                _log_recording_error(robot_id, module.id, reason)
                continue

            output_dir = _build_output_dir(robot_id)

            # DB 레코드 생성
            rec = rec_service.create_recording(
                db, robot_id, module.id, group_id, "auto",
                video_path=output_dir,
                schedule_id=schedule_id,
            )

            # Worker 생성 및 시작
            worker = CameraRecordingWorker(
                rtsp_url=rtsp_url,
                output_dir=output_dir,
                robot_id=robot_id,
                module_id=module.id,
                record_type="auto",
                on_error=_on_worker_error,
            )
            worker.start()

            with _lock:
                _sessions[key] = {
                    "worker": worker,
                    "record_type": "auto",
                    "group_id": group_id,
                    "db_record_id": rec.id,
                    "started_at": datetime.now().isoformat(),
                }

        print(f"[REC] 자동 녹화 시작: robot_id={robot_id}, 카메라 {len(modules)}대")
    finally:
        db.close()


def _stop_all_recording_sync(robot_id: int = None):
    """실제 정지 작업 — 백그라운드 스레드에서 실행"""
    with _lock:
        if robot_id:
            keys = [k for k in _sessions if k[0] == robot_id]
        else:
            keys = list(_sessions.keys())
    for key in keys:
        try:
            _stop_session(key)
        except Exception as e:
            print(f"[REC] 세션 정지 실패 {key}: {e}")
    if keys:
        print(f"[REC] 녹화 전체 중지 완료: robot_id={robot_id}, {len(keys)}개 세션")


def stop_all_recording(robot_id: int = None):
    """네비게이션 종료 시 호출 — 비동기로 녹화 세션 정리 (호출자 즉시 반환)"""
    with _lock:
        if robot_id:
            count = sum(1 for k in _sessions if k[0] == robot_id)
        else:
            count = len(_sessions)
    if count == 0:
        return
    print(f"[REC] 녹화 전체 중지 요청: robot_id={robot_id}, {count}개 세션 (백그라운드 처리)")
    t = threading.Thread(
        target=_stop_all_recording_sync,
        args=(robot_id,),
        daemon=True,
        name=f"rec-stop-{robot_id}",
    )
    t.start()


def start_manual_recording(robot_id: int, module_id: int) -> dict:
    """수동 녹화 시작 (API에서 호출)"""
    from app.navigation.send_move import is_nav_active
    if is_nav_active():
        return {"error": "자동 녹화 중에는 수동 녹화를 시작할 수 없습니다"}

    key = (robot_id, module_id)
    with _lock:
        if key in _sessions:
            return {"error": "이미 녹화 중입니다"}

    db = SessionLocal()
    try:
        modules = rec_service.get_active_camera_modules(db, robot_id)
        module = next((m for m in modules if m.id == module_id), None)
        if not module:
            return {"error": "카메라 모듈을 찾을 수 없습니다"}

        robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
        rtsp_url = rec_service.build_rtsp_url(db, module, robot=robot)
        if not rtsp_url:
            return {"error": "RTSP URL 생성 실패"}

        group_id = str(uuid.uuid4())
        output_dir = _build_output_dir(robot_id)

        rec = rec_service.create_recording(
            db, robot_id, module_id, group_id, "manual",
            video_path=output_dir,
        )

        worker = CameraRecordingWorker(
            rtsp_url=rtsp_url,
            output_dir=output_dir,
            robot_id=robot_id,
            module_id=module_id,
            record_type="manual",
            on_error=_on_worker_error,
        )
        worker.start()

        with _lock:
            _sessions[key] = {
                "worker": worker,
                "record_type": "manual",
                "group_id": group_id,
                "db_record_id": rec.id,
                "started_at": datetime.now().isoformat(),
            }

        print(f"[REC] 수동 녹화 시작: robot_id={robot_id}, module_id={module_id}")
        return {"status": "ok", "group_id": group_id}
    finally:
        db.close()


def stop_manual_recording(robot_id: int, module_id: int) -> dict:
    """수동 녹화 중지 (API에서 호출)"""
    key = (robot_id, module_id)
    with _lock:
        info = _sessions.get(key)
        if not info or info["record_type"] != "manual":
            return {"error": "수동 녹화 세션을 찾을 수 없습니다"}

    _stop_session(key)
    print(f"[REC] 수동 녹화 중지: robot_id={robot_id}, module_id={module_id}")
    return {"status": "ok"}


def get_active_sessions(robot_id: int = None) -> list:
    """현재 활성 녹화 세션 목록"""
    with _lock:
        result = []
        for (rid, mid), info in _sessions.items():
            if robot_id and rid != robot_id:
                continue
            result.append({
                "robot_id": rid,
                "module_id": mid,
                "record_type": info["record_type"],
                "group_id": info["group_id"],
                "started_at": info["started_at"],
            })
        return result


def stop_all():
    """앱 종료 시 모든 녹화 세션 정리 + 파일 누락 레코드 정리"""
    with _lock:
        keys = list(_sessions.keys())
    for key in keys:
        _stop_session(key)
    print(f"[REC] 전체 녹화 종료: {len(keys)}개 세션")

    db = SessionLocal()
    try:
        count = rec_service.cleanup_orphaned(db)
        if count > 0:
            print(f"[REC] 고아 녹화 레코드 {count}건 정리 완료")
    finally:
        db.close()


def cleanup_orphaned_recordings():
    """서버 시작 시 고아 레코드 정리"""
    db = SessionLocal()
    try:
        count = rec_service.cleanup_orphaned(db)
        if count > 0:
            print(f"[REC] 고아 녹화 레코드 {count}건 정리 완료")
    finally:
        db.close()


# ── 내부 헬퍼 ──

def _stop_session(key: tuple):
    """세션 중지 + DB 업데이트.

    FFmpeg 종료 대기·파일시스템 조회·썸네일 생성 등 블로킹 I/O는 모두
    DB 세션 바깥에서 수행하여 커넥션 풀 점유 시간을 최소화한다.
    """
    with _lock:
        info = _sessions.pop(key, None)
    if not info:
        return

    worker = info["worker"]

    # 1) VideoPath 조회 (짧은 세션)
    video_path = None
    try:
        db = SessionLocal()
        try:
            rec = db.query(RecordingInfo).filter(RecordingInfo.id == info["db_record_id"]).first()
            video_path = rec.VideoPath if rec else None
        finally:
            db.close()
    except Exception as e:
        print(f"[REC] VideoPath 조회 실패: {e}")

    # 2) FFmpeg 종료 대기 — 세션 점유 없음 (최대 10초)
    worker.stop()

    # 3) 파일시스템 확인 + 썸네일 생성 — 세션 점유 없음
    has_files = False
    total_size = 0
    thumb_path = None
    try:
        from app.recording.service import to_absolute_path
        prefix = worker.file_prefix
        video_dir = to_absolute_path(video_path) if video_path else None
        if video_dir and os.path.isdir(video_dir):
            if prefix:
                mp4_files = [f for f in os.listdir(video_dir)
                             if f.endswith(".mp4") and f.startswith(prefix)]
            else:
                mp4_files = [f for f in os.listdir(video_dir)
                             if f.endswith(".mp4") and f"cam{key[1]}" in f]
            has_files = len(mp4_files) > 0
            total_size = sum(
                os.path.getsize(os.path.join(video_dir, f))
                for f in mp4_files
            ) if has_files else 0
            if has_files and total_size > 0:
                first_mp4 = os.path.join(video_dir, mp4_files[0])
                try:
                    from app.recording.worker import generate_thumbnail
                    thumb_path = generate_thumbnail(first_mp4)
                except Exception:
                    pass
    except Exception as e:
        print(f"[REC] 파일 확인 실패: {e}")

    # 4) 최종 상태 업데이트 (짧은 세션)
    try:
        db = SessionLocal()
        try:
            if has_files and total_size > 0:
                rec_service.complete_recording(
                    db, info["db_record_id"],
                    video_size=total_size,
                    thumbnail_path=thumb_path,
                )
            else:
                reason = worker.error_reason or "녹화 파일 미생성 (원인 불명)"
                rec_service.error_recording(db, info["db_record_id"], reason=reason)
                print(f"[REC] 녹화 실패: robot={key[0]}, module={key[1]} — {reason}")
                _log_recording_error(key[0], key[1], reason)
        finally:
            db.close()
    except Exception as e:
        print(f"[REC] DB 업데이트 실패: {e}")


def _on_worker_error(robot_id: int, module_id: int):
    """Worker 에러 콜백 — 세션 정리 + DB 에러 표시"""
    key = (robot_id, module_id)
    with _lock:
        info = _sessions.pop(key, None)
    if not info:
        return

    # worker에서 에러 사유 추출
    worker = info.get("worker")
    reason = (worker.error_reason if worker else None) or "녹화 Worker 비정상 종료"

    try:
        db = SessionLocal()
        try:
            rec_service.error_recording(db, info["db_record_id"], reason=reason)
            print(f"[REC] Worker 에러: robot={robot_id}, module={module_id} — {reason}")
            _log_recording_error(robot_id, module_id, reason)
        finally:
            db.close()
    except Exception as e:
        print(f"[REC] 에러 처리 실패: {e}")


def _log_recording_error(robot_id: int, module_id: int, reason: str):
    """녹화 실패를 운영 로그(log_event)에 기록"""
    try:
        from app.logs.service import log_event
        from app.user_cache import get_robot_name, get_robot_business_id
        log_event(
            "error", "recording_error",
            f"녹화 실패 (cam={module_id}): {reason}",
            robot_id=robot_id,
            robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception:
        pass
