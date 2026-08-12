"""스케줄러 엔진 — 상태 관리, 콜백, 메인 루프.

실행 조건 판정은 run_conditions.py, 실제 실행은 executor.py, 회차 이력은
runs.py 로 분리되어 있다. 이 모듈은 활성 스케줄 상태 보호와 navigation 콜백,
메인 폴링 루프만 담당한다.

실행 보장(PRD-Schedule-Execution §2):
- 판정 단위가 "지금이 그 분인가"가 아니라 **회차(ScheduleId, PlannedAt)**다.
  허용 지연(grace) 안이면 늦게라도 실행하고, 넘기면 미실행으로 기록한다.
- 실행 못 한 회차는 반드시 ScheduleRun 에 사유와 함께 남는다 — 조용한 실패 금지.
"""

import json
import threading
import time
from datetime import datetime, timedelta

from app.database.database import SessionLocal
from app.database.models import ScheduleInfo
from app.logs.service import log_event
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id
from app.scheduler.run_conditions import (
    has_remaining_today, due_planned_times, expired_planned_times, standby_window,
)
from app.scheduler.executor import execute_schedule, execute_standby, precheck_ready
from app.scheduler import runs
from app.scheduler.runs import (
    RESULT_SUCCESS, RESULT_MISSED, RESULT_SKIPPED_OFFLINE,
    RESULT_TIMEOUT, RESULT_CANCELLED, RESULT_ERROR,
)


# ── 로봇 소유권 ────────────────────────────────────────────────────────────
# 관제가 여러 대(demo/개발) 떠 있어도 로봇 하나는 한 대만 몬다.
# 설계: 06_Planning/IMPL-Robot-Ownership-Across-Instances.md

def _owner_id(schedule_id: int) -> str:
    return f"schedule:{schedule_id}"


def _claim_robot(sched: ScheduleInfo) -> bool:
    """회차 시작 전 로봇 소유권 확보. 실패하면 실행하지 않는다."""
    try:
        from app.robot_control import control_lock as cl
        rid = get_robot_id()
        if rid is None:
            return True     # 대상 로봇을 못 정하면 기존 동작 그대로
        return cl.acquire_system(rid, _owner_id(sched.id), label=sched.WorkName) is not None
    except Exception as e:  # noqa: BLE001
        # 소유권 모듈 장애가 스케줄을 통째로 멈추면 안 된다.
        print(f"[SCHEDULER] 소유권 확보 실패(진행): {str(e)[:80]}")
        return True


def _unclaim_robot(schedule_id: int | None) -> None:
    if schedule_id is None:
        return
    try:
        from app.robot_control import control_lock as cl
        rid = get_robot_id()
        if rid is not None:
            cl.release_system(rid, _owner_id(schedule_id))
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER] 소유권 반납 실패(무시): {str(e)[:80]}")


def _busy_holder() -> str:
    try:
        from app.cluster import db_lock
        h = db_lock.holder(get_robot_id() or 0) or {}
        return h.get("host") or "다른 세션"
    except Exception:  # noqa: BLE001
        return "다른 세션"


def _record_busy_skip(sched: ScheduleInfo, planned: datetime) -> None:
    """로봇을 못 잡아 건너뛴 회차를 기록한다.

    조용히 건너뛰면 "작업이 왜 안 돌았는지"를 또 알 수 없게 되는데,
    그건 이 스케줄러가 정면으로 겨냥한 결함이다.
    """
    reason = f"로봇 사용 중({_busy_holder()})"
    run_id = runs.begin_run(sched, planned, datetime.now())
    if run_id is not None:
        runs.finish_run(run_id, RESULT_SKIPPED_OFFLINE, reason)
    print(f"[SCHEDULER] 회차 건너뜀 — {sched.WorkName}: {reason}")
    log_event("schedule", "schedule_skipped",
              f"작업 건너뜀: {sched.WorkName} — {reason}",
              detail=f"예정 {planned:%Y-%m-%d %H:%M}",
              robot_id=get_robot_id(), robot_name=get_robot_name(),
              business_id=get_robot_business_id())


# 현재 스케줄러에 의해 실행 중인 스케줄 ID
_active_schedule_id: int | None = None
_active_run_id: int | None = None            # 진행 중 회차(ScheduleRun) id
_active_started_at: datetime | None = None   # TTL 판정 기준
_lock = threading.Lock()

# 정지 경로가 회차를 어떤 결과로 마감할지 지정한다(기본은 운영자 취소).
# stop_navigation_internal → cancel_active_schedule 로 흘러들어가므로 호출부에서
# 결과를 직접 넘길 수 없어 모듈 상태로 전달한다.
_forced_run_result: str | None = None

# 실행을 미룬 회차의 사유 — grace 를 넘기는 순간 이 사유로 기록한다.
# {(schedule_id, planned_at): (result, reason, log_action)}
_defer_reasons: dict[tuple[int, datetime], tuple[str, str, str]] = {}

# 스케줄러가 관측을 시작한 시각. 이전 회차는 볼 수 없었으므로 미실행으로 단정하지 않는다.
_watch_since: datetime | None = None

# 진행 중인 상시 대기 근무. 다른 모드와 달리 '도착'이 끝이 아니라 시작이라
# 운영 종료 시각까지 회차를 열어 둔 채 로봇을 붙잡고 있어야 한다.
# {"schedule_id", "run_id", "planned_at", "ends_at", "phase": "moving"|"standby"}
_standby: dict | None = None

POLL_INTERVAL_SEC = 30


def get_active_schedule_id() -> int | None:
    return _active_schedule_id


def set_forced_run_result(result: str) -> None:
    """다음 취소 처리에서 회차를 이 결과로 마감한다(TTL 초과 등)."""
    global _forced_run_result
    _forced_run_result = result


def get_standby_state() -> dict | None:
    """진행 중인 상시 대기 근무 상태 (없으면 None)."""
    return dict(_standby) if _standby else None


def _resolve_return_place(schedule_id: int | None):
    """응대를 마치고 돌아갈 자리. 지정이 없으면 충전소가 대기장소다.

    작업 없이 받은 호출(schedule_id=None)이면 스케줄의 대기 장소 설정이 없다 —
    목적지 사전의 '대기구역' 으로 돌아간다.
    """
    from app.scheduler.executor import resolve_standby_place
    from app.scheduler import standby_session as sess_mod
    db = SessionLocal()
    try:
        if schedule_id is None:
            place = sess_mod.resolve_free_return_place(db, get_robot_id())
        else:
            sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
            place = resolve_standby_place(db, sched) if sched else None
        if place is not None:
            db.expunge(place)   # 세션이 닫혀도 좌표를 읽을 수 있게 분리
        return place
    finally:
        db.close()


def _on_standby_arrival() -> bool:
    """상시 대기 중 주행이 끝났을 때의 분기. 반환: 회차를 닫지 말아야 하면 True.

    도착의 의미가 단계마다 다르다 — 대기장소 도착은 근무 시작, 목적지 도착은
    안내 완료, 대기장소 재도착은 세션 종료다.
    """
    from app.scheduler import standby_session as sess_mod

    with _lock:
        standby = dict(_standby) if _standby else None

    # 응대 중이면 세션 FSM 이 다음 단계를 정한다.
    # **근무(_standby) 없이도 세션은 있을 수 있다** — 작업 없이 받은 음성 호출이다.
    # 여기서 근무를 먼저 요구하면 그 세션의 도착이 아무에게도 안 잡혀, 로봇이
    # 목적지에 선 채로 영영 돌아오지 않는다.
    session = sess_mod.get_session()
    if session:
        schedule_id = standby.get("schedule_id") if standby else session.get("schedule_id")
        if session["phase"] == "guiding":
            sess_mod.on_guide_arrived(_resolve_return_place(schedule_id))
            return True
        if session["phase"] == "returning":
            sess_mod.on_return_arrived()
            return True

    if not standby:
        return False
    first_arrival = standby.get("phase") == "moving"
    if first_arrival:
        with _lock:
            if _standby:
                _standby["phase"] = "standby"
    work_name = standby.get("work_name")
    ends_at = standby.get("ends_at")

    if first_arrival:
        print(f"[SCHEDULER] 상시 대기 진입: {work_name} — 응대 가능 (운영 종료 {ends_at:%H:%M})")
        log_event(
            "schedule", "standby_ready",
            f"대기 장소 도착 — 응대 가능: {work_name}",
            detail=f"운영 종료 {ends_at:%Y-%m-%d %H:%M}",
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    return True


def _clear_active(result: str, reason: str | None = None) -> int | None:
    """활성 스케줄 상태를 비우고 진행 중 회차를 마감한다. 반환: 비우기 전 schedule id."""
    global _active_schedule_id, _active_run_id, _active_started_at, _forced_run_result, _standby

    # 근무가 끊기면 진행 중 응대도 함께 끝난다 — 세션만 살아 있으면 로봇 없는
    # 응대가 화면에 계속 떠 있게 된다.
    if _standby is not None:
        try:
            from app.scheduler import standby_session as sess_mod
            if sess_mod.is_active():
                sess_mod.abort(sess_mod.RESULT_ABORTED_OPERATOR, reason or "근무 종료")
        except Exception as e:  # noqa: BLE001
            print(f"[SCHEDULER] 세션 정리 실패(무시): {e}")

    with _lock:
        _standby = None
        schedule_id = _active_schedule_id
        run_id = _active_run_id
        forced = _forced_run_result
        _active_schedule_id = None
        _active_run_id = None
        _active_started_at = None
        _forced_run_result = None

    if schedule_id is None:
        return None
    runs.finish_run(run_id, forced or result, reason)
    _unclaim_robot(schedule_id)
    return schedule_id


# ── 소유권 훅 ──────────────────────────────────────────────────────────────

def _on_preempted(robot_id: int, preempted_owner: str, by_owner: str) -> None:
    """사람이 자율을 선점했다. 진행 중 회차를 마감하고 상태를 비운다."""
    if not str(preempted_owner).startswith("schedule:"):
        return
    print(f"[SCHEDULER] 운영자 개입으로 회차 중단 — {preempted_owner} → {by_owner}")
    _clear_active(runs.RESULT_ABORTED, f"운영자 개입({by_owner})")


def _on_lock_lost(robot_id: int) -> None:
    """DB 락 상실이 확정됐다. 다른 관제가 로봇을 가져갈 수 있으므로 물러난다."""
    with _lock:
        active = _active_schedule_id
    if active is None:
        return
    print("[SCHEDULER] 로봇 소유권 상실 — 주행 정지 후 회차 마감")
    try:
        from app.navigation.send_move import stop_navigation_internal
        stop_navigation_internal("소유권 상실")
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER] 정지 실패(무시): {str(e)[:80]}")
    _clear_active(runs.RESULT_ABORTED, "로봇 소유권 상실(통신 두절)")


def register_ownership_hooks() -> None:
    """main.py 기동 시 1회. control_lock 이 이 모듈을 import 하지 않도록 여기서 등록한다."""
    from app.robot_control import control_lock as cl
    cl.register_preempt_hook(_on_preempted)
    cl.register_lost_hook(_on_lock_lost)


def cancel_active_schedule(reason: str = "사용자 취소"):
    """진행 중인 스케줄을 취소 상태로 처리한다.
    - once(단일): 원본 row의 TaskStatus를 '취소'로 변경
    - weekly/interval(반복): 원본은 '대기' 유지하고 today를 SeriesExceptions에 추가.
      같은 SeriesGroupId로 "오늘 하루짜리 취소 row"를 별도 생성해 해당 날짜만
      '취소'로 표시되도록 함 (다른 회차는 대기 그대로).
    """
    schedule_id = _clear_active(RESULT_CANCELLED, reason)
    if schedule_id is None:
        return

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
                today = datetime.now().date()
                today_str = today.strftime("%Y-%m-%d")
                # 원본에 오늘 예외 추가
                existing = set()
                if sched.SeriesExceptions:
                    existing = {d.strip() for d in sched.SeriesExceptions.split(",") if d.strip()}
                existing.add(today_str)
                sched.SeriesExceptions = ",".join(sorted(existing))
                sched.TaskStatus = "대기"

                # 오늘 하루짜리 취소 row 생성 (같은 그룹 공유)
                start_dt = sched.StartDate
                # StartDate의 시각 부분을 오늘 날짜와 조합
                hour = start_dt.hour if start_dt else 0
                minute = start_dt.minute if start_dt else 0
                today_dt = datetime.combine(today, datetime.min.time().replace(hour=hour, minute=minute))
                single_day = ScheduleInfo(
                    UserId=sched.UserId,
                    RobotName=sched.RobotName,
                    WorkName=sched.WorkName,
                    TaskType=sched.TaskType,
                    WayName=sched.WayName,
                    TaskStatus="취소",
                    ScheduleMode=mode,
                    StartDate=today_dt,
                    EndDate=today_dt,
                    Repeat=sched.Repeat,
                    Repeat_Day=sched.Repeat_Day,
                    Repeat_End=today_str,
                    ExecutionTime=sched.ExecutionTime,
                    IntervalMinutes=sched.IntervalMinutes,
                    ActiveStartTime=sched.ActiveStartTime,
                    ActiveEndTime=sched.ActiveEndTime,
                    SeriesStartDate=today,
                    SeriesEndDate=today,
                    SeriesExceptions=None,
                    SeriesGroupId=sched.SeriesGroupId,
                    RunCount=1,
                    MaxRunCount=None,
                )
                db.add(single_day)
            db.commit()
            log_event(
                "schedule", "schedule_cancel",
                f"스케줄 취소: {sched.WorkName} (사유: {reason})",
                detail=f"id={schedule_id}, mode={mode}, robot={sched.RobotName}",
                robot_id=get_robot_id(), robot_name=get_robot_name(),
                business_id=get_robot_business_id(),
            )
            print(f"[SCHEDULER] 스케줄 #{schedule_id} → {sched.TaskStatus} ({reason})")
    except Exception as e:
        print(f"[SCHEDULER ERR] 취소 처리 실패: {e}")
        db.rollback()
        _log_state_error(schedule_id, "취소", e)
    finally:
        db.close()


def _log_state_error(schedule_id: int | None, phase: str, exc: Exception) -> None:
    """스케줄 상태 갱신 DB 실패를 알림으로 올린다 (E9).

    현행은 print + rollback 뿐이라 회차가 '진행중'으로 방치되고 후속 회차가
    전부 막히는데도 화면에 아무 흔적이 없다.
    """
    log_event(
        "schedule", "schedule_state_error",
        f"작업 상태 갱신 실패({phase}) — 스케줄 #{schedule_id}",
        detail=str(exc)[:400],
        robot_id=get_robot_id(), robot_name=get_robot_name(),
        business_id=get_robot_business_id(),
    )


# ─── 네비게이션 콜백 ───

def on_navigation_complete():
    """네비게이션 완료 시 호출되는 콜백 — 스케줄 상태 갱신."""
    # 상시 대기는 대기장소 '도착'이 회차의 끝이 아니라 근무의 시작이다.
    # 여기서 회차를 닫으면 로봇이 곧바로 충전소로 돌아가 응대할 수 없다.
    if _on_standby_arrival():
        return

    schedule_id = _clear_active(RESULT_SUCCESS)
    if schedule_id is None:
        return

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
            if series_end:
                if now.date() > series_end:
                    should_continue = False
                elif now.date() == series_end and not has_remaining_today(sched, now):
                    # 종료일 당일이고 오늘 남은 실행 회차 없음 → 시리즈 종료 처리
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
        _log_state_error(schedule_id, "완료", e)
    finally:
        db.close()


def on_navigation_error(error_msg: str = ""):
    """네비게이션 오류 시 호출되는 콜백."""
    schedule_id = _clear_active(RESULT_ERROR, error_msg or "네비게이션 오류")
    if schedule_id is None:
        return

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if sched:
            # 반복 작업은 '대기'로 남는다 — 이 회차의 실패가 다음 회차까지 죽이지 않게.
            sched.TaskStatus = runs.failure_status(sched)
            sched.LastRunDate = datetime.now()
            db.commit()
            print(f"[SCHEDULER] 스케줄 #{schedule_id} 주행 오류 → {sched.TaskStatus}: {error_msg}")
    except Exception as e:
        print(f"[SCHEDULER ERR] 오류 처리 실패: {e}")
        db.rollback()
        _log_state_error(schedule_id, "오류", e)
    finally:
        db.close()


def on_gate_timeout(wp_name: str = "") -> None:
    """확인 게이트 절대 상한 도달 → 회차 중단 (E5).

    arrival_gate 가 hard cap 에서 호출한다. 주행 중단 자체는 게이트가 'abort' 를
    반환해 navigation 이 처리하고, 여기서는 사유를 남긴다.
    """
    log_event(
        "schedule", "schedule_gate_timeout",
        f"확인 무응답으로 중단 — {wp_name or '경유지'}",
        detail=f"schedule={_active_schedule_id}, wp={wp_name}",
        robot_id=get_robot_id(), robot_name=get_robot_name(),
        business_id=get_robot_business_id(),
    )
    set_forced_run_result(runs.RESULT_ABORTED)


# ─── 실행 전 가드: 로봇 오프라인 ───

def _is_target_robot_online(sched: ScheduleInfo) -> bool:
    """스케줄 대상 로봇이 폴링 기준 '온라인 확정' 상태인지 판정.

    polling._was_online[rid] 가 True 인 경우만 True를 반환한다.
    12초(OFFLINE_AFTER_SEC) 이상 응답이 없으면 polling 스레드가 자동으로
    False로 떨구므로, 단발 끊김으로 인한 오판은 없다.
    """
    from app.database.models import RobotInfo
    from app.robot_io import polling

    db = SessionLocal()
    try:
        robot = (
            db.query(RobotInfo)
            .filter(RobotInfo.RobotName == sched.RobotName,
                    RobotInfo.DeletedAt.is_(None))
            .first()
        )
        if not robot:
            return False
        return bool(polling._was_online.get(robot.id, False))
    finally:
        db.close()


def _defer(schedule_id: int, planned_at: datetime, result: str, reason: str, action: str) -> None:
    """이번 틱에는 실행하지 않고 grace 안에서 재시도한다. 사유는 만료 시 기록에 쓰인다."""
    _defer_reasons[(schedule_id, planned_at)] = (result, reason, action)


# ─── 시작 시 복구 ───

def recover_stale_schedules():
    """서버 비정상 종료 등으로 고아 상태가 된 '진행중' 스케줄을 복구한다.

    - once(단일): '취소' (실제로 완료되지 않았으므로)
    - weekly/interval(반복): '대기' (다음 회차 실행 가능)

    비정상 종료 시 _active_schedule_id가 프로세스 메모리에서만 유지되어 DB의
    TaskStatus='진행중'이 그대로 남는 문제를 시작 시점에 일괄 정리한다.
    레거시 '진행' 상태도 동일하게 처리(현재 코드베이스엔 writer 없으나 구 데이터 방어).
    """
    # 'running' 으로 남은 회차부터 마감한다 — 상태만 되돌리면 그 회차는 이력에서 사라진다(E10).
    runs.close_orphan_runs("서버 재시작")
    # 응대 세션도 같이 마감한다. 남으면 이력에 '진행 중'으로 영구히 뜬다.
    from app.scheduler import standby_session as sess_mod
    sess_mod.close_orphan_sessions("서버 재시작")

    db = SessionLocal()
    try:
        stale = (
            db.query(ScheduleInfo)
            .filter(ScheduleInfo.TaskStatus.in_(["진행중", "진행"]))
            .all()
        )
        if not stale:
            return

        interrupted: list[tuple[str, str, str]] = []
        for sched in stale:
            mode = getattr(sched, 'ScheduleMode', None) or (
                "weekly" if sched.Repeat == "Y" else "once"
            )
            # 실패 경로 전체가 같은 규칙을 쓴다(runs.failure_status).
            # - 단일: '취소'로 두면 사람이 누른 취소와 구분되지 않는다 → '오류'
            # - 반복: '대기'. 재기동 한 번으로 다음 회차까지 죽이지 않는다
            # - 상시대기: '오류'. (ScheduleId, PlannedAt) 유니크에 막혀 그날 다시
            #   시작되지 않으므로 '대기'로 두면 화면이 거짓말을 한다 → 사람이 재개
            sched.TaskStatus = runs.failure_status(sched)
            print(f"[SCHEDULER] 고아 '진행중' 복구: #{sched.id} {sched.WorkName} → {sched.TaskStatus} (mode={mode})")
            interrupted.append((sched.id, sched.WorkName, sched.RobotName, sched.TaskStatus))
        db.commit()

        # 끊긴 사실을 알린다. '오류'로 남은 것은 사람이 재개해야 다시 도는데,
        # 알림이 없으면 화면을 들여다볼 때까지 아무도 모른다.
        # scheduleId 를 실어야 알림에서 바로 재개할 수 있다.
        for sched_id, work_name, robot_name, status in interrupted:
            if status != "오류":
                continue    # '대기'로 돌아간 반복 작업은 다음 회차에 알아서 돈다
            log_event(
                "schedule", "schedule_interrupted",
                f"{work_name} — 서버 재시작으로 중단되었습니다. 재개해야 다시 실행됩니다",
                detail=f"로봇: {robot_name}",
                error_json=json.dumps({"scheduleId": sched_id, "workName": work_name},
                                      ensure_ascii=False),
                robot_name=robot_name,
            )
    except Exception as e:
        print(f"[SCHEDULER ERR] 고아 스케줄 복구 실패: {e}")
        db.rollback()
    finally:
        db.close()


# ─── 회차 TTL 감시 (E6) ───

def _ttl_watchdog(now: datetime) -> None:
    """실행 시간이 MaxDurationMin 을 넘긴 회차를 강제 종료하고 복귀시킨다.

    확인 게이트 무한 대기(G3)로 그날 남은 회차가 전부 막히는 상황을 끊는 마지막 장치다.
    """
    with _lock:
        schedule_id = _active_schedule_id
        started_at = _active_started_at
        is_standby = _standby is not None
    # 상시 대기는 종일 근무가 정상이라 TTL 대상이 아니다 — 수명은 운영 시간대가 정한다.
    if schedule_id is None or started_at is None or is_standby:
        return

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if not sched:
            return
        limit_min = runs.max_duration_min(sched)
        elapsed_min = (now - started_at).total_seconds() / 60
        if elapsed_min < limit_min:
            return

        work_name, mode = sched.WorkName, (
            getattr(sched, 'ScheduleMode', None) or ("weekly" if sched.Repeat == "Y" else "once")
        )
        reason = f"작업 시간 초과 — {int(elapsed_min)}분 경과(상한 {limit_min}분)"

        # 회차만 timeout 으로 마감한다. cancel_active_schedule 을 태우면
        # SeriesExceptions 에 오늘이 들어가 남은 회차까지 죽는다(G4와 같은 함정).
        _clear_active(RESULT_TIMEOUT, reason)
        sched.TaskStatus = runs.failure_status(sched)
        sched.LastRunDate = now
        db.commit()
    except Exception as e:
        print(f"[SCHEDULER ERR] TTL 처리 실패: {e}")
        db.rollback()
        _log_state_error(schedule_id, "TTL", e)
        return
    finally:
        db.close()

    log_event(
        "schedule", "schedule_ttl_exceeded",
        f"{work_name} — {reason}",
        detail=f"id={schedule_id}",
        robot_id=get_robot_id(), robot_name=get_robot_name(),
        business_id=get_robot_business_id(),
    )
    print(f"[SCHEDULER] #{schedule_id} {work_name} → {reason}")

    # 주행 강제 종료 후 충전소 복귀. 복귀까지 실패하면 위치가 불확실한 상태이므로
    # 다음 회차를 시작하지 않도록 사람에게 올린다(E7).
    try:
        from app.navigation.send_move import stop_navigation_internal
        stop_navigation_internal("작업 시간 초과")
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER ERR] TTL 정지 실패: {e}")

    try:
        from app.robot_control.charge import _return_to_charge_internal
        result = _return_to_charge_internal(cancel_running=False)
        if not result.get("ok"):
            log_event(
                "schedule", "schedule_return_failed",
                f"{work_name} — 복귀 실패: {result.get('msg')}",
                detail=f"id={schedule_id}",
                robot_id=get_robot_id(), robot_name=get_robot_name(),
                business_id=get_robot_business_id(),
            )
    except Exception as e:  # noqa: BLE001
        log_event(
            "schedule", "schedule_return_failed",
            f"{work_name} — 복귀 시도 중 오류",
            detail=str(e)[:400],
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )


# ─── 상시 대기 (PRD-Schedule-Execution §3) ───

def _end_standby(now: datetime, result: str, reason: str, return_to_charge: bool) -> None:
    """상시 대기 근무를 마감한다. 운영 종료·양보·오류 공통 경로."""
    with _lock:
        state = dict(_standby) if _standby else None
    if not state:
        return

    schedule_id = _clear_active(result, reason)   # _standby 도 함께 비워진다
    if schedule_id is None:
        return

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if sched:
            sched.LastRunDate = now
            if result in runs.SUCCESS_RESULTS:
                sched.RunCount = (sched.RunCount or 0) + 1
            # 시리즈가 남아 있으면 '대기'로 되돌려야 다음 날(또는 양보 후) 다시 들어간다
            series_end = getattr(sched, 'SeriesEndDate', None)
            done = bool(series_end and now.date() >= series_end)
            if sched.MaxRunCount and (sched.RunCount or 0) >= sched.MaxRunCount:
                done = True
            sched.TaskStatus = "완료" if done else "대기"
            db.commit()
        work_name = sched.WorkName if sched else state.get("work_name")
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER ERR] 상시 대기 종료 처리 실패: {e}")
        db.rollback()
        _log_state_error(schedule_id, "상시 대기 종료", e)
        work_name = state.get("work_name")
    finally:
        db.close()

    print(f"[SCHEDULER] 상시 대기 종료: {work_name} ({reason})")
    log_event(
        "schedule", "standby_end",
        f"상시 대기 종료: {work_name} — {reason}",
        detail=f"id={schedule_id}, result={result}",
        robot_id=get_robot_id(), robot_name=get_robot_name(),
        business_id=get_robot_business_id(),
    )

    if return_to_charge:
        try:
            from app.navigation.send_move import stop_navigation_internal
            stop_navigation_internal("상시 대기 운영 종료")
            from app.robot_control.charge import _return_to_charge_internal
            res = _return_to_charge_internal(cancel_running=False)
            if not res.get("ok"):
                log_event(
                    "schedule", "schedule_return_failed",
                    f"{work_name} — 운영 종료 복귀 실패: {res.get('msg')}",
                    detail=f"id={schedule_id}",
                    robot_id=get_robot_id(), robot_name=get_robot_name(),
                    business_id=get_robot_business_id(),
                )
        except Exception as e:  # noqa: BLE001
            print(f"[SCHEDULER ERR] 상시 대기 복귀 실패: {e}")


def _standby_watchdog(now: datetime) -> None:
    """응대 세션 시계를 돌리고, 운영 시간이 끝났으면 근무를 마친다."""
    from app.scheduler import standby_session as sess_mod

    # 세션 상한·진전 판정 (§3.7) + 해산 확인 무응답 만료.
    # **근무 여부와 무관하게 돌린다** — 작업 없이 받은 호출의 세션도 시계가 필요하다.
    # 근무가 있을 때만 돌리면 그 세션은 상한도 무응답 만료도 영영 오지 않는다.
    sess_mod.tick(now, POLL_INTERVAL_SEC)

    with _lock:
        ends_at = _standby.get("ends_at") if _standby else None
    if ends_at is None or now < ends_at:
        return
    # 운영 종료 시점에 응대 중이면 끊지 않고 완료까지 기다린다 (S6)
    if sess_mod.is_active():
        print("[SCHEDULER] 운영 시간 종료 — 진행 중 응대를 마친 뒤 복귀합니다")
        return
    _end_standby(now, RESULT_SUCCESS, f"운영 시간 종료({ends_at:%H:%M})", return_to_charge=True)


def _yield_standby_for(sched: ScheduleInfo, now: datetime) -> None:
    """예약 작업에 로봇을 넘긴다 (S8 — 예약 우선).

    양보해도 회차는 닫지 않는다. 운영 시간대가 남아 있으면 예약 작업이 끝난 뒤
    같은 회차로 다시 들어간다 — 양보를 실패로 세면 실행률이 거짓말을 한다.
    """
    with _lock:
        state = dict(_standby) if _standby else None
    if not state:
        return
    print(f"[SCHEDULER] 상시 대기 양보 → 예약 작업 '{sched.WorkName}'")
    _end_standby(now, runs.RESULT_RUNNING, f"예약 작업 '{sched.WorkName}' 우선", return_to_charge=False)


def _enter_standby(db, sched: ScheduleInfo, now: datetime, window: tuple[datetime, datetime]) -> bool:
    """상시 대기 근무를 시작(또는 양보 후 재개)한다. 반환: 로봇을 잡았으면 True."""
    global _active_schedule_id, _active_run_id, _active_started_at, _standby

    begin, end = window
    if not _is_target_robot_online(sched):
        return False
    ready, _why = precheck_ready()
    if not ready:
        return False

    # 로봇을 먼저 잡는다. find_open_run 폴백이 다른 관제가 돌리고 있는 근무를
    # 주워서 이어가는 것을 막는 지점이기도 하다 — 그 폴백은 "내가 재개"와
    # "남이 실행 중"을 구분하지 못한다.
    if not _claim_robot(sched):
        print(f"[SCHEDULER] 상시 대기 진입 보류 — 로봇 사용 중({_busy_holder()})")
        return False

    # 회차 키는 '오늘 근무' 하나다. 양보 후 재개면 기존 running 회차를 이어 쓴다.
    run_id = runs.begin_run(sched, begin, now)
    if run_id is None:
        run_id = runs.find_open_run(db, sched.id, begin)
        if run_id is None:
            _unclaim_robot(sched.id)
            return False   # 오늘 근무가 이미 마감됨

    with _lock:
        _active_schedule_id = sched.id
        _active_run_id = run_id
        _active_started_at = now
        _standby = {
            "schedule_id": sched.id,
            "run_id": run_id,
            "work_name": sched.WorkName,
            "robot_name": sched.RobotName,
            "planned_at": begin,
            "ends_at": end,
            "phase": "moving",
        }

    ok, reason = execute_standby(sched)
    if not ok:
        _clear_active(RESULT_ERROR, reason)
        return False
    return True


# ─── 회차 처리 ───

def _record_expired(db, sched: ScheduleInfo, now: datetime, grace: int) -> None:
    """grace 를 넘긴 회차를 미실행/오프라인 스킵으로 남긴다 (G1·G4·G9)."""
    expired = expired_planned_times(sched, now, grace, since=_watch_since)
    if not expired:
        return
    recorded = runs.existing_results(db, sched.id, expired)
    for planned in expired:
        if planned in recorded:
            continue
        result, reason, action = _defer_reasons.pop(
            (sched.id, planned),
            (RESULT_MISSED, f"실행 기회를 놓침 — 허용 지연 {grace}분 초과", "schedule_missed"),
        )
        runs.record_terminal(sched, planned, result, reason, action)
        print(f"[SCHEDULER] #{sched.id} {sched.WorkName} {planned:%H:%M} 회차 → {result} ({reason})")


def _try_execute(db, sched: ScheduleInfo, now: datetime, grace: int) -> bool:
    """실행할 회차가 있으면 실행한다. 반환: 실행을 시작했으면 True."""
    global _active_schedule_id, _active_run_id, _active_started_at

    due = due_planned_times(sched, now, grace)
    if not due:
        return False
    recorded = runs.existing_results(db, sched.id, due)

    for planned in due:
        if planned in recorded:
            continue

        # 오프라인은 회차 단위로만 미룬다. 당일 전체를 취소하면 09:00 한 번의
        # 통신 끊김으로 13:00·18:00 회차까지 함께 죽는다(G4).
        if not _is_target_robot_online(sched):
            _defer(sched.id, planned, RESULT_SKIPPED_OFFLINE,
                   f"로봇 오프라인 — 허용 지연 {grace}분 초과", "schedule_skip_offline")
            return False

        ready, why = precheck_ready()
        if not ready:
            _defer(sched.id, planned, RESULT_MISSED,
                   f"{why} — 허용 지연 {grace}분 초과", "schedule_missed")
            return False

        # 로봇을 먼저 잡는다. 다른 관제가 쓰고 있으면 이 회차는 실행하지 않는다.
        if not _claim_robot(sched):
            _record_busy_skip(sched, planned)
            return False

        run_id = runs.begin_run(sched, planned, now)
        if run_id is None:
            _unclaim_robot(sched.id)
            continue  # 경합으로 이미 기록됨 — 다음 회차로
        _defer_reasons.pop((sched.id, planned), None)

        with _lock:
            _active_schedule_id = sched.id
            _active_run_id = run_id
            _active_started_at = now

        ok, reason = execute_schedule(sched)
        if not ok:
            # 여기까지 온 실패는 경로·장소 참조 깨짐 등 재시도해도 같은 결과다(E4).
            _clear_active(RESULT_ERROR, reason)
            return False
        return True

    return False


# ─── 메인 루프 ───

def scheduler_thread():
    """메인 스케줄러 루프 — 30초마다 회차 조건 체크."""
    global _watch_since

    print("[SCHEDULER] 스케줄러 엔진 시작")

    # 서버 시작 후 초기 대기 (DB 연결 안정화)
    time.sleep(5)
    _watch_since = datetime.now()

    while True:
        try:
            now = datetime.now()
            _ttl_watchdog(now)
            _standby_watchdog(now)

            db = SessionLocal()
            try:
                # "대기" 상태 스케줄 조회
                schedules = (
                    db.query(ScheduleInfo)
                    .filter(ScheduleInfo.TaskStatus == "대기")
                    .order_by(ScheduleInfo.StartDate.asc())
                    .all()
                )
                pending = [s for s in schedules if not runs.is_paused(s, now)]

                for sched in pending:
                    grace = runs.grace_minutes(sched)

                    # 놓친 회차 기록은 실행 여부와 무관하게 매 틱 수행한다.
                    _record_expired(db, sched, now, grace)

                    # 예약 작업이 뜨면 상시 대기는 로봇을 넘긴다 (S8 — 예약 우선)
                    if _standby is not None and due_planned_times(sched, now, grace):
                        _yield_standby_for(sched, now)

                    # navigation 전역 상태를 공유하므로 동시 실행은 1건.
                    # 다만 예전처럼 나머지를 '드롭'하지 않는다 — grace 안이면
                    # 다음 틱에 다시 후보로 올라와 사실상 큐로 동작한다(G2).
                    if _active_schedule_id is None:
                        _try_execute(db, sched, now, grace)

                # 예약 작업이 로봇을 쓰지 않을 때만 상시 대기에 들어간다
                if _active_schedule_id is None:
                    for sched in pending:
                        window = standby_window(sched, now)
                        if window and _enter_standby(db, sched, now, window):
                            break

            finally:
                db.close()

            _prune_defer_reasons(now)

        except Exception as e:
            print(f"[SCHEDULER ERR] 루프 오류: {e}")

        time.sleep(POLL_INTERVAL_SEC)


def _prune_defer_reasons(now: datetime) -> None:
    """하루가 지난 미룸 사유는 버린다 (메모리 누수 방지)."""
    if not _defer_reasons:
        return
    cutoff = now - timedelta(days=1)
    for key in [k for k, _ in list(_defer_reasons.items()) if k[1] < cutoff]:
        _defer_reasons.pop(key, None)
