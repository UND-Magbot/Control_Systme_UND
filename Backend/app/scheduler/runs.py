"""회차 실행 이력(ScheduleRun) 기록 (PRD-Schedule-Execution §2.2, §4.2).

스케줄러의 모든 실패는 이 테이블에 사유와 함께 남는다 — "조용한 실패 금지"가
이 모듈의 유일한 목적이다. 알림은 log_event 가 ALERT_TRIGGER_RULES 를 통해
자동 생성하므로 여기서는 로그 액션만 부른다.
"""

from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError

from app.database.database import SessionLocal
from app.database.models import ScheduleInfo, ScheduleRun
from app.logs.service import log_event
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id

# ScheduleRun.Result 값
RESULT_RUNNING = "running"                    # 진행 중 (종료 시 갱신)
RESULT_SUCCESS = "success"
RESULT_DELAYED = "completed_delayed"          # grace 안에서 지연 실행 후 성공 — 성공으로 집계
RESULT_MISSED = "missed"                      # grace 초과로 실행 못 함
RESULT_SKIPPED_OFFLINE = "skipped_offline"    # 로봇 오프라인
RESULT_TIMEOUT = "timeout"                    # 회차 TTL 초과
RESULT_ABORTED = "aborted"                    # 중단(게이트 무응답·서버 재시작 등)
RESULT_CANCELLED = "cancelled"                # 운영자 취소
RESULT_ERROR = "error"                        # 실행 오류

# 서킷 브레이커 판정 대상 (E11)
FAILURE_RESULTS = {
    RESULT_MISSED, RESULT_SKIPPED_OFFLINE, RESULT_TIMEOUT,
    RESULT_ABORTED, RESULT_ERROR,
}
SUCCESS_RESULTS = {RESULT_SUCCESS, RESULT_DELAYED}

# 연속 실패가 이 횟수에 도달하면 작업을 자동 일시정지한다 (§4.2 원칙 3)
CIRCUIT_BREAKER_FAILURES = 3
CIRCUIT_BREAKER_PAUSE_HOURS = 24

DEFAULT_GRACE_MINUTES = 10
DEFAULT_MAX_DURATION_MIN = 60


def grace_minutes(sched: ScheduleInfo) -> int:
    """허용 지연(분). 기존 row 는 NULL 이므로 기본값으로 흡수한다."""
    v = getattr(sched, "GraceMinutes", None)
    return int(v) if v and v > 0 else DEFAULT_GRACE_MINUTES


def max_duration_min(sched: ScheduleInfo) -> int:
    """회차 TTL(분). 0 이하/NULL 이면 기본값."""
    v = getattr(sched, "MaxDurationMin", None)
    return int(v) if v and v > 0 else DEFAULT_MAX_DURATION_MIN


def is_paused(sched: ScheduleInfo, now: datetime) -> bool:
    paused_until = getattr(sched, "PausedUntil", None)
    return bool(paused_until and paused_until > now)


def failure_status(sched: ScheduleInfo, now: datetime | None = None) -> str:
    """회차가 실패한 뒤 작업을 어떤 상태로 둘 것인가 — 실패 경로 전체의 단일 출처.

    회차의 실패와 작업의 수명은 다르다. 기준은 **오늘 할 일이 남았는가**다.

    - 단일: 다음 회차가 없다 → '오류'
    - 상시 대기: 회차 하나가 하루 근무 전체라 그날이 통째로 죽는다 → '오류'
    - 반복(요일·주기):
      · 오늘 남은 회차가 있다 → '오류'. 오늘 하던 일이 도중에 끊긴 것이므로
        남은 시간을 이어갈지 사람이 정한다(로봇이 어디 서 있는지 모른다)
      · 오늘 남은 회차가 없다 → '대기'. 밤중 재기동 한 번으로 다음 날 작업
        전체가 죽으면 안 된다

    '오류'는 스케줄러가 집어가지 않는다(메인 루프는 '대기'만 조회) → 사람이
    재개해야 다시 돈다. 반복이 '대기'로 계속 실패하는 경우는 아래 서킷
    브레이커가 PausedUntil 로 잡는다.
    """
    mode = getattr(sched, "ScheduleMode", None) or ("weekly" if sched.Repeat == "Y" else "once")
    if mode not in ("weekly", "interval"):
        return "오류"

    now = now or datetime.now()
    try:
        from app.scheduler.run_conditions import planned_times
        if any(p > now for p in planned_times(sched, now)):
            return "오류"
    except Exception as e:  # noqa: BLE001 — 판정 실패로 상태를 잃지 않는다
        print(f"[SCHEDULER-RUN] 잔여 회차 판정 실패(대기로 둠): {e}")
    return "대기"


# ─── 조회 ───

def existing_results(db, schedule_id: int, planned_times: list[datetime]) -> dict[datetime, str]:
    """주어진 예정 시각들 중 이미 기록된 회차의 결과를 반환. 중복 실행 방지 키."""
    if not planned_times:
        return {}
    rows = (
        db.query(ScheduleRun.PlannedAt, ScheduleRun.Result)
        .filter(ScheduleRun.ScheduleId == schedule_id,
                ScheduleRun.PlannedAt.in_(planned_times))
        .all()
    )
    return {r[0]: r[1] for r in rows}


def find_open_run(db, schedule_id: int, planned_at: datetime) -> int | None:
    """아직 마감되지 않은(running) 회차 id. 상시 대기가 양보 후 재개할 때 이어 쓴다."""
    row = (
        db.query(ScheduleRun.id)
        .filter(ScheduleRun.ScheduleId == schedule_id,
                ScheduleRun.PlannedAt == planned_at,
                ScheduleRun.Result == RESULT_RUNNING)
        .first()
    )
    return row[0] if row else None


def _new_run(sched: ScheduleInfo, planned_at: datetime, result: str, **kw) -> ScheduleRun:
    return ScheduleRun(
        ScheduleId=sched.id,
        SeriesGroupId=getattr(sched, "SeriesGroupId", None),
        WorkName=sched.WorkName,
        RobotName=sched.RobotName,
        PlannedAt=planned_at,
        Result=result,
        **kw,
    )


# ─── 기록 ───

def begin_run(sched: ScheduleInfo, planned_at: datetime, now: datetime) -> int | None:
    """회차 시작을 선점 기록한다. 반환: run id (유니크 충돌 시 None = 이미 실행됨).

    유니크 키가 중복 실행을 막으므로, 판정 시점과 기록 시점 사이의 경합에서도
    같은 회차가 두 번 돌지 않는다.
    """
    db = SessionLocal()
    try:
        run = _new_run(
            sched, planned_at, RESULT_RUNNING,
            StartedAt=now,
            DelaySec=max(0, int((now - planned_at).total_seconds())),
        )
        db.add(run)
        db.commit()
        return run.id
    except IntegrityError:
        db.rollback()
        return None
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER-RUN ERR] 회차 시작 기록 실패: {e}")
        db.rollback()
        return None
    finally:
        db.close()


def finish_run(run_id: int | None, result: str, reason: str | None = None) -> None:
    """진행 중 회차를 종료 결과로 마감한다."""
    if run_id is None:
        return
    db = SessionLocal()
    try:
        run = db.query(ScheduleRun).filter(ScheduleRun.id == run_id).first()
        if not run:
            return
        # 지연 실행이 정상 완료되면 '지연 완료' — 실패가 아니라 성공으로 집계한다.
        if result == RESULT_SUCCESS and (run.DelaySec or 0) > 0:
            result = RESULT_DELAYED
        run.Result = result
        run.Reason = (reason or None) and reason[:200]
        run.EndedAt = datetime.now()
        db.commit()
        if result in FAILURE_RESULTS:
            _check_circuit_breaker(db, run.ScheduleId, run.WorkName)
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER-RUN ERR] 회차 종료 기록 실패: {e}")
        db.rollback()
    finally:
        db.close()


def record_terminal(sched: ScheduleInfo, planned_at: datetime, result: str,
                    reason: str, log_action: str | None = None) -> bool:
    """시작조차 못 한 회차(missed/skipped_offline)를 이력에 남긴다.

    반환: 새로 기록했으면 True (이미 있으면 False — 중복 알림 방지).
    """
    db = SessionLocal()
    try:
        run = _new_run(
            sched, planned_at, result,
            Reason=reason[:200],
            EndedAt=datetime.now(),
            DelaySec=None,
        )
        db.add(run)
        db.commit()
    except IntegrityError:
        db.rollback()
        db.close()
        return False   # 이미 기록된 회차 — 중복 알림을 내지 않는다
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER-RUN ERR] 회차 종료 기록 실패: {e}")
        db.rollback()
        db.close()
        return False

    try:
        if log_action:
            log_event(
                "schedule", log_action,
                f"{sched.WorkName} {planned_at.strftime('%H:%M')} 회차 — {reason}",
                detail=f"id={sched.id}, robot={sched.RobotName}, planned={planned_at:%Y-%m-%d %H:%M}",
                robot_id=get_robot_id(), robot_name=get_robot_name(),
                business_id=get_robot_business_id(),
            )
        _check_circuit_breaker(db, sched.id, sched.WorkName)
    finally:
        db.close()
    return True


# ─── 서킷 브레이커 (E11) ───

def _check_circuit_breaker(db, schedule_id: int, work_name: str | None) -> None:
    """연속 3회 실패면 작업을 자동 일시정지하고 요약 알림 1건만 낸다.

    경로가 삭제된 작업이 매일 3회씩 알림을 쏘는 상황을 막는다(§4.2 원칙 3).
    """
    try:
        recent = (
            db.query(ScheduleRun)
            .filter(ScheduleRun.ScheduleId == schedule_id,
                    ScheduleRun.Result != RESULT_RUNNING)
            .order_by(ScheduleRun.PlannedAt.desc())
            .limit(CIRCUIT_BREAKER_FAILURES)
            .all()
        )
        if len(recent) < CIRCUIT_BREAKER_FAILURES:
            return
        if any(r.Result not in FAILURE_RESULTS for r in recent):
            return

        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if not sched:
            return
        now = datetime.now()
        if is_paused(sched, now):
            return  # 이미 정지됨 — 알림 중복 방지

        sched.PausedUntil = now + timedelta(hours=CIRCUIT_BREAKER_PAUSE_HOURS)
        db.commit()

        last_reason = recent[0].Reason or "사유 미기록"
        log_event(
            "schedule", "schedule_auto_paused",
            f"{work_name} — {CIRCUIT_BREAKER_FAILURES}회 연속 실패({last_reason}). 작업을 일시정지했습니다",
            detail=f"id={schedule_id}, 해제 예정={sched.PausedUntil:%Y-%m-%d %H:%M}",
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
        print(f"[SCHEDULER] #{schedule_id} {work_name} → 연속 실패로 자동 일시정지")
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER-RUN ERR] 서킷 브레이커 판정 실패: {e}")
        db.rollback()


# ─── 서버 재시작 복구 (E10) ───

def close_orphan_runs(reason: str = "서버 재시작") -> int:
    """프로세스가 죽어 'running' 으로 남은 회차를 aborted 로 마감한다.

    현행 recover_stale_schedules 는 TaskStatus 만 되돌리고 이력을 남기지 않아
    그 회차가 흔적 없이 사라진다.
    """
    db = SessionLocal()
    try:
        orphans = db.query(ScheduleRun).filter(ScheduleRun.Result == RESULT_RUNNING).all()
        if not orphans:
            return 0
        now = datetime.now()
        for run in orphans:
            run.Result = RESULT_ABORTED
            run.Reason = reason[:200]
            run.EndedAt = now
        db.commit()
        print(f"[SCHEDULER] 고아 회차 {len(orphans)}건 → aborted ({reason})")
        return len(orphans)
    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER-RUN ERR] 고아 회차 정리 실패: {e}")
        db.rollback()
        return 0
    finally:
        db.close()
