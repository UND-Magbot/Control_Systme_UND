"""회차 실행 이력 조회 (PRD-Schedule-Execution §2.2 · G9).

경로를 `/schedule/...` 이 아니라 `/schedule-runs` 로 둔 이유: schedule.py 가 먼저
등록하는 `GET /schedule/{schedule_id}` 가 하위 경로를 선점해 `runs` 를 id 로 읽는다.
"""

from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database.models import ScheduleInfo, ScheduleRun, UserInfo
from app.auth.dependencies import require_permission, is_admin, get_business_robot_names
from app.auth.audit import write_audit, get_client_ip
from app.database.routes import database, get_db
from app.scheduler import runs as run_svc

# 화면 표기용 라벨 — 결과 코드는 PRD §2.2 그대로 쓴다
RESULT_LABELS = {
    run_svc.RESULT_RUNNING: "진행 중",
    run_svc.RESULT_SUCCESS: "성공",
    run_svc.RESULT_DELAYED: "성공(지연)",
    run_svc.RESULT_MISSED: "미실행",
    run_svc.RESULT_SKIPPED_OFFLINE: "오프라인 스킵",
    run_svc.RESULT_TIMEOUT: "시간 초과",
    run_svc.RESULT_ABORTED: "중단",
    run_svc.RESULT_CANCELLED: "취소",
    run_svc.RESULT_ERROR: "오류",
}


def _serialize(r: ScheduleRun) -> dict:
    return {
        "id": r.id,
        "ScheduleId": r.ScheduleId,
        "WorkName": r.WorkName,
        "RobotName": r.RobotName,
        "PlannedAt": r.PlannedAt.isoformat() if r.PlannedAt else None,
        "StartedAt": r.StartedAt.isoformat() if r.StartedAt else None,
        "EndedAt": r.EndedAt.isoformat() if r.EndedAt else None,
        "Result": r.Result,
        "ResultLabel": RESULT_LABELS.get(r.Result, r.Result),
        "Reason": r.Reason,
        "DelaySec": r.DelaySec,
    }


@database.get("/schedule-runs")
def get_schedule_runs(
    days: int = Query(7, ge=1, le=90),
    robot: str | None = None,
    result: str | None = None,
    schedule_id: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """회차 실행 이력 + 실행률 요약.

    미실행·오프라인 스킵을 **눈에 보이게 하는 것**이 이 화면의 목적이다.
    """
    since = datetime.now() - timedelta(days=days)
    q = db.query(ScheduleRun).filter(ScheduleRun.PlannedAt >= since)

    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        q = q.filter(ScheduleRun.RobotName.in_(biz_names))
    if robot:
        q = q.filter(ScheduleRun.RobotName == robot)
    if schedule_id:
        q = q.filter(ScheduleRun.ScheduleId == schedule_id)

    # 요약은 결과 필터를 걸기 전 모집단으로 낸다 — 필터를 바꿔도 실행률은 그대로여야 한다
    population = q.all()
    if result:
        q = q.filter(ScheduleRun.Result == result)

    total = q.count()
    rows = (
        q.order_by(ScheduleRun.PlannedAt.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    # 운영자 취소와 진행 중은 실행률 분모에서 뺀다 (실행 보장 실패가 아니다)
    counted = [r for r in population
               if r.Result not in (run_svc.RESULT_CANCELLED, run_svc.RESULT_RUNNING)]
    executed = [r for r in counted if r.Result in run_svc.SUCCESS_RESULTS]
    by_result: dict[str, int] = {}
    for r in population:
        by_result[r.Result] = by_result.get(r.Result, 0) + 1

    return {
        "items": [_serialize(r) for r in rows],
        "total": total,
        "page": page,
        "size": size,
        "summary": {
            "planned": len(counted),
            "executed": len(executed),
            "rate": round(len(executed) / len(counted) * 100, 1) if counted else None,
            "byResult": by_result,
        },
    }


@database.get("/schedule-runs/paused")
def get_paused_schedules(
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """연속 실패로 자동 일시정지된 작업 — 화면 상단 배너용."""
    now = datetime.now()
    q = db.query(ScheduleInfo).filter(ScheduleInfo.PausedUntil > now)
    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        q = q.filter(ScheduleInfo.RobotName.in_(biz_names))
    return [
        {
            "id": s.id,
            "WorkName": s.WorkName,
            "RobotName": s.RobotName,
            "PausedUntil": s.PausedUntil.isoformat() if s.PausedUntil else None,
        }
        for s in q.order_by(ScheduleInfo.PausedUntil.asc()).all()
    ]


@database.post("/schedule-runs/{schedule_id}/resume")
def resume_paused_schedule(
    schedule_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """자동 일시정지 해제. 원인을 고쳤다는 판단은 사람이 한다(§4.2 원칙 3)."""
    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        if sched.RobotName not in biz_names:
            raise HTTPException(status_code=403, detail="권한이 없습니다.")

    sched.PausedUntil = None
    db.commit()

    write_audit(db, current_user.id, "schedule_resumed", "schedule", schedule_id,
                detail=f"작업명: {sched.WorkName}, 로봇: {sched.RobotName} — 자동 일시정지 해제",
                ip_address=get_client_ip(request))
    return {"status": "ok", "id": schedule_id}
