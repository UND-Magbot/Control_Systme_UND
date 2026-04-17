"""스케줄러 엔진 — 상태 관리, 콜백, 메인 루프.

실행 조건 판정은 run_conditions.py, 실제 실행은 executor.py로 분리되어 있다.
이 모듈은 _active_schedule_id 상태 보호와 navigation 콜백, 메인 폴링 루프만 담당.
"""

import threading
import time
from datetime import datetime

from app.database.database import SessionLocal
from app.database.models import ScheduleInfo
from app.logs.service import log_event
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id
from app.scheduler.run_conditions import should_run_now
from app.scheduler.executor import execute_schedule

# 현재 스케줄러에 의해 실행 중인 스케줄 ID
_active_schedule_id: int | None = None
_lock = threading.Lock()


def get_active_schedule_id() -> int | None:
    return _active_schedule_id


def cancel_active_schedule(reason: str = "사용자 취소"):
    """진행 중인 스케줄을 취소/대기 상태로 변경한다.
    - once(단일): 취소
    - weekly/interval(반복): 대기 (다음 회차 실행 가능)
    """
    global _active_schedule_id

    with _lock:
        schedule_id = _active_schedule_id
        if schedule_id is None:
            return
        _active_schedule_id = None

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if sched:
            mode = getattr(sched, 'ScheduleMode', None) or (
                "weekly" if sched.Repeat == "Y" else "once"
            )
            if mode == "once":
                sched.TaskStatus = "취소"
            else:
                sched.TaskStatus = "대기"
            db.commit()
            print(f"[SCHEDULER] 스케줄 #{schedule_id} → {sched.TaskStatus} ({reason})")
    except Exception as e:
        print(f"[SCHEDULER ERR] 취소 처리 실패: {e}")
        db.rollback()
    finally:
        db.close()


# ─── 네비게이션 콜백 ───

def on_navigation_complete():
    """네비게이션 완료 시 호출되는 콜백 — 스케줄 상태 갱신."""
    global _active_schedule_id

    with _lock:
        schedule_id = _active_schedule_id
        if schedule_id is None:
            return
        _active_schedule_id = None

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if not sched:
            return

        now = datetime.now()
        sched.LastRunDate = now
        sched.RunCount = (sched.RunCount or 0) + 1

        mode = getattr(sched, 'ScheduleMode', None) or (
            "weekly" if sched.Repeat == "Y" else "once"
        )

        if mode == "once":
            sched.TaskStatus = "완료"
        elif mode in ("weekly", "interval"):
            should_continue = True

            # 시리즈 종료일 체크
            series_end = getattr(sched, 'SeriesEndDate', None)
            if not series_end and sched.Repeat_End:
                try:
                    series_end = datetime.strptime(str(sched.Repeat_End).strip(), "%Y-%m-%d").date()
                except ValueError:
                    pass
            if series_end and now.date() >= series_end:
                should_continue = False

            # MaxRunCount 체크
            if sched.MaxRunCount and sched.RunCount >= sched.MaxRunCount:
                should_continue = False

            sched.TaskStatus = "대기" if should_continue else "완료"

        db.commit()
        print(f"[SCHEDULER] 스케줄 #{schedule_id} 완료 → 상태: {sched.TaskStatus} (실행 {sched.RunCount}회)")
        import app.navigation.send_move as nav_mod
        route_summary = " → ".join(
            wp.get("name", f"WP{i+1}") for i, wp in enumerate(nav_mod.waypoints_list)
        ) if nav_mod.waypoints_list else ""
        log_event("schedule", "nav_complete",
                  f"스케줄 완료: {sched.WorkName} (실행 {sched.RunCount}회)",
                  detail=f"경로: {route_summary}" if route_summary else None,
                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

    except Exception as e:
        print(f"[SCHEDULER ERR] 완료 처리 실패: {e}")
        db.rollback()
    finally:
        db.close()


def on_navigation_error(error_msg: str = ""):
    """네비게이션 오류 시 호출되는 콜백."""
    global _active_schedule_id

    with _lock:
        schedule_id = _active_schedule_id
        if schedule_id is None:
            return
        _active_schedule_id = None

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if sched:
            sched.TaskStatus = "오류"
            sched.LastRunDate = datetime.now()
            db.commit()
            print(f"[SCHEDULER] 스케줄 #{schedule_id} 오류: {error_msg}")
    except Exception as e:
        print(f"[SCHEDULER ERR] 오류 처리 실패: {e}")
        db.rollback()
    finally:
        db.close()


# ─── 메인 루프 ───

def scheduler_thread():
    """메인 스케줄러 루프 — 30초마다 실행 조건 체크."""
    global _active_schedule_id

    print("[SCHEDULER] 스케줄러 엔진 시작")

    # 서버 시작 후 초기 대기 (DB 연결 안정화)
    time.sleep(5)

    while True:
        try:
            now = datetime.now()
            db = SessionLocal()

            try:
                # "대기" 상태 스케줄 조회
                schedules = (
                    db.query(ScheduleInfo)
                    .filter(ScheduleInfo.TaskStatus == "대기")
                    .order_by(ScheduleInfo.StartDate.asc())
                    .all()
                )

                for sched in schedules:
                    if _active_schedule_id is not None:
                        break  # 이미 실행 중인 스케줄이 있으면 스킵

                    if should_run_now(sched, now):
                        with _lock:
                            _active_schedule_id = sched.id
                        if not execute_schedule(sched):
                            with _lock:
                                _active_schedule_id = None

            finally:
                db.close()

        except Exception as e:
            print(f"[SCHEDULER ERR] 루프 오류: {e}")

        time.sleep(30)
