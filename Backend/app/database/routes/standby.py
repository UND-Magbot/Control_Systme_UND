"""상시 대기 응대 — 호출 트리거 · 실시간 세션 · 세션 이력 (PRD-Schedule-Execution §3.5).

경로를 `/standby-*` 로 둔 이유는 schedule.py 의 `GET /schedule/{schedule_id}` 가
하위 경로를 선점하기 때문이다(schedule_run.py 와 같은 규칙).
"""

from datetime import datetime, timedelta

from fastapi import Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.models import (
    ScheduleInfo, ServiceSession, RobotInfo, VoiceSlotValue, UserInfo,
)
from app.auth.dependencies import require_permission, is_admin, get_business_robot_names
from app.auth.audit import write_audit, get_client_ip
from app.database.routes import database, get_db
from app.scheduler import standby_session as sess_mod
from app.scheduler.loop import get_standby_state

# 세션 결과 표기 — 코드는 PRD §3.3(b) 그대로 쓴다
RESULT_LABELS = {
    sess_mod.RESULT_RUNNING: "진행 중",
    sess_mod.RESULT_COMPLETED: "안내 완료",
    sess_mod.RESULT_COMPLETED_DELAYED: "안내 완료(지연)",
    sess_mod.RESULT_NO_MATCH: "미인식",
    sess_mod.RESULT_UNKNOWN_DEST: "목적지 없음",
    sess_mod.RESULT_NAV_FAILED: "이동 실패",
    sess_mod.RESULT_ABORTED_NO_PROGRESS: "중단(무진전)",
    sess_mod.RESULT_ABORTED_OPERATOR: "중단(정지)",
    sess_mod.RESULT_ABORTED_OFFLINE: "중단(오프라인)",
}

# 실시간 패널의 6단계 (§3.4 FSM)
STEP_LABELS = ["대기 중", "호출 감지", "응답", "안내 이동", "도착·안내 완료", "대기장소 복귀"]


class StandbyCallReq(BaseModel):
    scheduleId: int
    destinationId: int | None = None    # 버튼 호출: 목적지 사전 id
    heard: str | None = None            # 마이크 호출: STT 원문
    retryCount: int = 0                 # 되묻기 후 재시도면 그 횟수


def _scope_ok(db: Session, current_user: UserInfo, robot_name: str | None) -> bool:
    if is_admin(current_user) or not current_user.BusinessId:
        return True
    return robot_name in get_business_robot_names(db, current_user.BusinessId)


def _summarize(rows: list[ServiceSession]) -> dict:
    """응대 집계 — 실시간 패널과 이력 탭이 같은 규칙으로 세게 한다.

    두 화면이 각자 세면 '중단'에 무엇을 넣는지 같은 판단이 갈라진다.
    """
    done = [r for r in rows if r.Result in sess_mod.SUCCESS_RESULTS]
    durations = [
        int((r.EndedAt - r.StartedAt).total_seconds())
        for r in done if r.StartedAt and r.EndedAt
    ]
    return {
        "total": len(rows),
        "completed": len(done),
        "noMatch": len([r for r in rows if r.Result == sess_mod.RESULT_NO_MATCH]),
        "unknownDest": len([r for r in rows if r.Result == sess_mod.RESULT_UNKNOWN_DEST]),
        "aborted": len([
            r for r in rows
            if str(r.Result).startswith("aborted") or r.Result == sess_mod.RESULT_NAV_FAILED
        ]),
        "avgSec": round(sum(durations) / len(durations)) if durations else None,
    }


def _serialize(s: ServiceSession) -> dict:
    dur = None
    if s.StartedAt and s.EndedAt:
        dur = int((s.EndedAt - s.StartedAt).total_seconds())
    return {
        "id": s.id,
        "ScheduleId": s.ScheduleId,
        "RobotName": s.RobotName,
        "StartedAt": s.StartedAt.isoformat() if s.StartedAt else None,
        "EndedAt": s.EndedAt.isoformat() if s.EndedAt else None,
        "ReturnedAt": s.ReturnedAt.isoformat() if s.ReturnedAt else None,
        "Heard": s.Heard,
        "MatchedSlot": s.MatchedSlot,
        "Confidence": s.Confidence,
        "RetryCount": s.RetryCount,
        "DestinationId": s.DestinationId,
        "DestinationName": s.DestinationName,
        "Result": s.Result,
        "ResultLabel": RESULT_LABELS.get(s.Result, s.Result),
        "ExtendedCount": s.ExtendedCount,
        "Reason": s.Reason,
        "DurationSec": dur,
    }


@database.post("/standby-call")
def standby_call(
    req: StandbyCallReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """호출 트리거 — 관제/태블릿 버튼 또는 STT 결과로 응대를 시작한다.

    마이크가 붙기 전에도 전체 시퀀스가 성립하도록 버튼 경로를 먼저 연다
    (PRD-Waypoint 가 '버튼 확인부터' 간 것과 같은 전략).
    """
    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == req.scheduleId).first()
    if not sched:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    if not _scope_ok(db, current_user, sched.RobotName):
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    state = get_standby_state()
    if not state or state.get("schedule_id") != req.scheduleId:
        raise HTTPException(status_code=409, detail="이 작업은 지금 대기 근무 중이 아닙니다.")
    if state.get("phase") != "standby":
        raise HTTPException(status_code=409, detail="대기 장소로 이동 중입니다. 잠시 후 다시 시도하세요.")

    result = sess_mod.start_session(
        schedule_id=req.scheduleId,
        run_id=state.get("run_id"),
        heard=req.heard,
        destination_id=req.destinationId,
        retry_count=req.retryCount,
    )
    write_audit(db, current_user.id, "standby_call", "schedule", req.scheduleId,
                detail=f"목적지={result.get('destination') or req.destinationId or req.heard}, 결과={result.get('result')}",
                ip_address=get_client_ip(request))
    return result


@database.get("/standby-destinations")
def standby_destinations(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """호출 버튼에 띄울 목적지 목록 — 목적지 사전이 단일 출처다."""
    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.RobotName == sched.RobotName, RobotInfo.DeletedAt.is_(None))
        .first()
    )
    if not robot:
        return []

    allow_raw = (getattr(sched, "StandbyDestinations", None) or "").strip()
    allowed = {x.strip() for x in allow_raw.split(",") if x.strip()} if allow_raw else None

    rows = (
        db.query(VoiceSlotValue)
        .filter(VoiceSlotValue.RobotId == robot.id, VoiceSlotValue.SlotName == "목적지")
        .order_by(VoiceSlotValue.Value.asc())
        .all()
    )
    return [
        {"id": s.id, "name": s.Value, "linked": s.LocationId is not None}
        for s in rows
        if allowed is None or str(s.id) in allowed
    ]


@database.get("/standby-live")
def standby_live(
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """실시간 응대 세션 패널 — 지금 무슨 단계인지가 한 화면에서 읽혀야 한다.

    오늘 요약은 **이 패널 안에서만** 계산된다. 통계 메뉴의 「작업 건수」와는
    집계 단위가 달라(회차 vs 응대) 수치가 다를 수 있다(§3.8).
    """
    state = get_standby_state()
    if not state:
        return {"active": False}
    if not _scope_ok(db, current_user, state.get("robot_name")):
        return {"active": False}

    session = sess_mod.get_session()
    phase = state.get("phase")
    # FSM 6단계 중 지금 어디인가. 호출 감지·응답(1·2)은 수 초짜리 전이라
    # 폴링 간격에 잡히지 않으므로 단계로 노출하지 않는다.
    if session:
        step = 3 if session["phase"] == "guiding" else 5
    else:
        step = 0

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    rows = (
        db.query(ServiceSession)
        .filter(ServiceSession.ScheduleId == state["schedule_id"],
                ServiceSession.StartedAt >= today)
        .all()
    )
    return {
        "active": True,
        "scheduleId": state["schedule_id"],
        "workName": state.get("work_name"),
        "robotName": state.get("robot_name"),
        "phase": phase,
        "phaseLabel": "응대 중" if session else ("대기 중(응대 가능)" if phase == "standby" else "대기 장소로 이동 중"),
        "endsAt": state["ends_at"].isoformat() if state.get("ends_at") else None,
        "step": step,
        "steps": STEP_LABELS,
        "session": None if not session else {
            "id": session["id"],
            "phase": session["phase"],
            "heard": session.get("heard"),
            "destination": session.get("destination_name"),
            "confidence": session.get("confidence"),
            "startedAt": session["started_at"].isoformat(),
            "elapsedSec": session.get("elapsed_sec", 0),
            "frozenSec": session.get("frozen_sec", 0),
            "limitMin": session.get("limit_min"),
            "extended": session.get("extended", 0),
            "retryCount": session.get("retry_count", 0),
        },
        "todaySummary": _summarize(rows),
    }


@database.get("/standby-sessions")
def standby_sessions(
    days: int = Query(1, ge=1, le=90),
    result: str | None = None,
    schedule_id: int | None = None,
    robot: str | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """응대 세션 이력 — 미인식·목적지 없음을 학습으로 되돌리는 루프의 입구."""
    since = datetime.now() - timedelta(days=days)
    q = db.query(ServiceSession).filter(ServiceSession.StartedAt >= since)

    if not is_admin(current_user) and current_user.BusinessId:
        q = q.filter(ServiceSession.RobotName.in_(get_business_robot_names(db, current_user.BusinessId)))
    if schedule_id:
        q = q.filter(ServiceSession.ScheduleId == schedule_id)
    if robot:
        q = q.filter(ServiceSession.RobotName == robot)
    if search:
        q = q.filter(ServiceSession.Heard.like(f"%{search}%"))

    population = q.all()
    if result:
        q = q.filter(ServiceSession.Result == result)

    total = q.count()
    rows = (
        q.order_by(ServiceSession.StartedAt.desc())
        .offset((page - 1) * size).limit(size).all()
    )

    ok = [r for r in population if r.Result in sess_mod.SUCCESS_RESULTS]
    closed = [r for r in population if r.Result != sess_mod.RESULT_RUNNING]
    first_try = [r for r in ok if (r.RetryCount or 0) == 0]
    return {
        "items": [_serialize(r) for r in rows],
        "total": total,
        "page": page,
        "size": size,
        "summary": {
            # 건수·평균은 실시간 패널과 같은 규칙으로 센다(_summarize).
            # 근무가 끝나면 그 패널이 사라지므로, 그날을 돌아볼 자리는 여기다.
            **_summarize(population),
            "closed": len(closed),
            # 되묻고 성공한 건은 성공에 잡히지만 품질은 나빠지고 있다 — 선행 지표다
            "firstTryRate": round(len(first_try) / len(ok) * 100, 1) if ok else None,
            "successRate": round(len(ok) / len(closed) * 100, 1) if closed else None,
            "extendedRate": round(len([r for r in ok if (r.ExtendedCount or 0) > 0]) / len(ok) * 100, 1) if ok else None,
            "byResult": {r.Result: len([x for x in population if x.Result == r.Result]) for r in population},
        },
    }
