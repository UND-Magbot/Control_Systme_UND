from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime

from app.database.models import ScheduleInfo, UserInfo
from app.auth.dependencies import require_permission, is_admin, get_business_robot_names
from app.auth.audit import write_audit, get_client_ip

from app.database.routes import database, get_db


class ScheduleInsertReq(BaseModel):
    RobotName: str
    TaskName: str
    TaskType: str
    WayName: str
    WorkStatus: str

    ScheduleMode: str = "once"              # "once" | "weekly" | "interval"

    # once 모드
    StartTime: datetime | None = None       # 실행 일시

    # weekly 모드
    ExecutionTime: str | None = None        # "HH:MM"
    RepeatDays: str | None = None           # "월,수,금"

    # interval 모드
    ActiveStartTime: str | None = None      # "HH:MM"
    ActiveEndTime: str | None = None        # "HH:MM"
    IntervalMinutes: int | None = None      # 반복 간격(분)

    # weekly + interval 공통
    SeriesStartDate: str | None = None      # "YYYY-MM-DD"
    SeriesEndDate: str | None = None        # "YYYY-MM-DD" or null


def _check_schedule_conflict(
    db: Session,
    robot_name: str,
    mode: str,
    req,
    exclude_id: int | None = None,
):
    """
    같은 로봇에 시간이 겹치는 스케줄이 있는지 검사. 충돌 시 HTTPException 발생.

    차단 대상 (interval 활성 시간대 충돌만):
    - interval 시간대 안에 once/weekly 시각이 포함되는 경우
    - interval 시간대끼리 겹치는 경우
    once↔once, once↔weekly, weekly↔weekly 는 스케줄러가 런타임에 직렬 처리하므로 차단하지 않음.
    """

    def _parse_hm(s: str) -> int:
        h, m = s.strip().split(":")
        return int(h) * 60 + int(m)

    def _point_in_range(point: int, rng: tuple[int, int]) -> bool:
        return rng[0] <= point < rng[1]

    def _ranges_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
        return a[0] < b[1] and b[0] < a[1]

    q = db.query(ScheduleInfo).filter(
        ScheduleInfo.RobotName == robot_name,
        ScheduleInfo.TaskStatus != "완료",
    )
    if exclude_id is not None:
        q = q.filter(ScheduleInfo.id != exclude_id)
    existing = q.all()

    if not existing:
        return

    DAY_MAP = {0: "월", 1: "화", 2: "수", 3: "목", 4: "금", 5: "토", 6: "일"}

    new_days: set[str] | None = None
    new_date: str | None = None

    if mode == "once":
        st = getattr(req, 'StartTime', None)
        if st:
            if isinstance(st, str):
                st = datetime.strptime(st, "%Y-%m-%d %H:%M:%S")
            new_date = st.strftime("%Y-%m-%d")
    elif mode in ("weekly", "interval"):
        days_str = getattr(req, 'RepeatDays', '') or ''
        new_days = set(d.strip() for d in days_str.split(",") if d.strip())

    for ex in existing:
        ex_mode = ex.ScheduleMode or ("weekly" if ex.Repeat == "Y" else "once")

        if mode != "interval" and ex_mode != "interval":
            continue

        ex_days: set[str] | None = None
        if ex.Repeat_Day:
            ex_days = set(d.strip() for d in ex.Repeat_Day.split(","))

        if new_days and ex_days:
            if not new_days & ex_days:
                continue

        if mode == "once" and ex_mode == "interval" and new_date:
            once_dt = datetime.strptime(new_date, "%Y-%m-%d")
            once_day = DAY_MAP[once_dt.weekday()]
            if ex_days and once_day not in ex_days:
                continue
        if mode == "interval" and ex_mode == "once":
            if ex.StartDate and new_days:
                ex_day = DAY_MAP[ex.StartDate.weekday()]
                if ex_day not in new_days:
                    continue

        if mode == "interval":
            new_start = _parse_hm(getattr(req, 'ActiveStartTime', None) or "00:00")
            new_end = _parse_hm(getattr(req, 'ActiveEndTime', None) or "23:59")
            new_interval_range = (new_start, new_end)
        if ex_mode == "interval":
            ex_start = _parse_hm(ex.ActiveStartTime or "00:00")
            ex_end = _parse_hm(ex.ActiveEndTime or "23:59")
            ex_interval_range = (ex_start, ex_end)

        conflict_name = ex.WorkName

        # Case 1: 새 interval vs 기존 interval → 시간대 겹침
        if mode == "interval" and ex_mode == "interval":
            if _ranges_overlap(new_interval_range, ex_interval_range):
                raise HTTPException(
                    status_code=409,
                    detail=f"같은 로봇({robot_name})의 주기반복 시간대가 겹칩니다: {conflict_name}"
                )

        # Case 2: 새 once/weekly → 기존 interval 시간대 안에 포함되는지
        if mode != "interval" and ex_mode == "interval":
            points: list[int] = []
            if mode == "once":
                st = getattr(req, 'StartTime', None)
                if st:
                    if isinstance(st, str):
                        st = datetime.strptime(st, "%Y-%m-%d %H:%M:%S")
                    points.append(st.hour * 60 + st.minute)
            elif mode == "weekly":
                exec_time = getattr(req, 'ExecutionTime', None)
                if exec_time:
                    points = [_parse_hm(t) for t in exec_time.split(",")]
            for p in points:
                if _point_in_range(p, ex_interval_range):
                    raise HTTPException(
                        status_code=409,
                        detail=f"같은 로봇({robot_name})의 주기반복({ex.ActiveStartTime}~{ex.ActiveEndTime}) 시간대와 겹칩니다: {conflict_name}"
                    )

        # Case 3: 새 interval → 기존 once/weekly 시각이 시간대 안에 포함되는지
        if mode == "interval" and ex_mode != "interval":
            points: list[int] = []
            if ex_mode == "once" and ex.StartDate:
                points.append(ex.StartDate.hour * 60 + ex.StartDate.minute)
            elif ex_mode == "weekly" and ex.ExecutionTime:
                points = [_parse_hm(t) for t in ex.ExecutionTime.split(",")]
            for p in points:
                if _point_in_range(p, new_interval_range):
                    raise HTTPException(
                        status_code=409,
                        detail=f"주기반복 시간대({getattr(req, 'ActiveStartTime', '')}~{getattr(req, 'ActiveEndTime', '')}) 안에 기존 작업이 있습니다: {conflict_name}"
                    )


@database.post("/schedule")
def insert_schedule(
    req: ScheduleInsertReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    from datetime import date as date_type

    _check_schedule_conflict(db, req.RobotName, req.ScheduleMode, req)

    schedule = ScheduleInfo(
        UserId=current_user.id,
        RobotName=req.RobotName,
        WorkName=req.TaskName,
        TaskType=req.TaskType,
        WayName=req.WayName,
        TaskStatus=req.WorkStatus,
        ScheduleMode=req.ScheduleMode,
    )

    if req.ScheduleMode == "once":
        schedule.StartDate = req.StartTime
        schedule.EndDate = req.StartTime
        schedule.Repeat = "N"

    elif req.ScheduleMode == "weekly":
        series_start = datetime.strptime(req.SeriesStartDate, "%Y-%m-%d").date() if req.SeriesStartDate else date_type.today()
        first_time = (req.ExecutionTime or "00:00").split(",")[0].strip()
        exec_h, exec_m = first_time.split(":")
        schedule.StartDate = datetime.combine(series_start, datetime.min.time().replace(hour=int(exec_h), minute=int(exec_m)))
        schedule.EndDate = schedule.StartDate
        schedule.Repeat = "Y"
        schedule.Repeat_Day = req.RepeatDays
        schedule.ExecutionTime = req.ExecutionTime
        schedule.SeriesStartDate = series_start
        if req.SeriesEndDate:
            schedule.SeriesEndDate = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
            schedule.Repeat_End = req.SeriesEndDate

    elif req.ScheduleMode == "interval":
        series_start = datetime.strptime(req.SeriesStartDate, "%Y-%m-%d").date() if req.SeriesStartDate else date_type.today()
        start_h, start_m = (req.ActiveStartTime or "00:00").split(":")
        schedule.StartDate = datetime.combine(series_start, datetime.min.time().replace(hour=int(start_h), minute=int(start_m)))
        schedule.EndDate = schedule.StartDate
        schedule.Repeat = "Y"
        schedule.Repeat_Day = req.RepeatDays
        schedule.IntervalMinutes = req.IntervalMinutes
        schedule.ActiveStartTime = req.ActiveStartTime
        schedule.ActiveEndTime = req.ActiveEndTime
        schedule.SeriesStartDate = series_start
        if req.SeriesEndDate:
            schedule.SeriesEndDate = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
            schedule.Repeat_End = req.SeriesEndDate

    db.add(schedule)
    db.commit()
    db.refresh(schedule)

    write_audit(db, current_user.id, "schedule_created", "schedule", schedule.id,
                detail=f"작업명: {req.TaskName}, 로봇: {req.RobotName}, 유형: {req.TaskType}, 경로: {req.WayName}, 모드: {req.ScheduleMode}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "id": schedule.id}


@database.get("/schedule")
def get_schedules(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("schedule-list"))):
    q = db.query(ScheduleInfo)
    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        q = q.filter(ScheduleInfo.RobotName.in_(biz_names))
    schedules = q.order_by(ScheduleInfo.StartDate.asc()).all()
    return [
        {
            "id": s.id,
            "RobotName": s.RobotName,
            "WorkName": s.WorkName,
            "TaskType": s.TaskType,
            "TaskStatus": s.TaskStatus,
            "StartDate": s.StartDate.isoformat() if s.StartDate else None,
            "EndDate": s.EndDate.isoformat() if s.EndDate else None,
            "WayName": s.WayName,
            "Repeat": s.Repeat,
            "Repeat_Day": s.Repeat_Day,
            "Repeat_End": s.Repeat_End,
            "ScheduleMode": s.ScheduleMode or "once",
            "ExecutionTime": s.ExecutionTime,
            "IntervalMinutes": s.IntervalMinutes,
            "ActiveStartTime": s.ActiveStartTime,
            "ActiveEndTime": s.ActiveEndTime,
            "SeriesStartDate": s.SeriesStartDate.isoformat() if s.SeriesStartDate else None,
            "SeriesEndDate": s.SeriesEndDate.isoformat() if s.SeriesEndDate else None,
            "RunCount": s.RunCount or 0,
            "MaxRunCount": s.MaxRunCount,
            "LastRunDate": s.LastRunDate.isoformat() if s.LastRunDate else None,
        }
        for s in schedules
    ]


@database.get("/schedule/active")
def get_active_schedule():
    """현재 스케줄러에 의해 실행 중인 스케줄 ID 반환"""
    from app.scheduler.loop import get_active_schedule_id
    active_id = get_active_schedule_id()
    return {"active_schedule_id": active_id}


@database.get("/schedule/{schedule_id}")
def get_schedule_detail(schedule_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("schedule-list"))):
    schedule = (
        db.query(ScheduleInfo)
        .filter(ScheduleInfo.id == schedule_id)
        .first()
    )

    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    return {
        "id": schedule.id,
        "RobotName": schedule.RobotName,
        "TaskName": schedule.WorkName,
        "TaskType": schedule.TaskType,
        "TaskStatus": schedule.TaskStatus,

        "StartDate": schedule.StartDate.isoformat() if schedule.StartDate else None,
        "EndDate": schedule.EndDate.isoformat() if schedule.EndDate else None,

        "Repeat": schedule.Repeat,
        "Repeat_Day": schedule.Repeat_Day,
        "Repeat_End": schedule.Repeat_End,

        "WayName": schedule.WayName,

        "ScheduleMode": schedule.ScheduleMode or "once",
        "ExecutionTime": schedule.ExecutionTime,
        "IntervalMinutes": schedule.IntervalMinutes,
        "ActiveStartTime": schedule.ActiveStartTime,
        "ActiveEndTime": schedule.ActiveEndTime,
        "SeriesStartDate": schedule.SeriesStartDate.isoformat() if schedule.SeriesStartDate else None,
        "SeriesEndDate": schedule.SeriesEndDate.isoformat() if schedule.SeriesEndDate else None,

        "LastRunDate": schedule.LastRunDate.isoformat() if schedule.LastRunDate else None,
        "RunCount": schedule.RunCount or 0,
        "MaxRunCount": schedule.MaxRunCount,
    }


class ScheduleUpdateReq(BaseModel):
    TaskStatus: str | None = None
    ScheduleMode: str | None = None
    StartTime: datetime | None = None

    # weekly
    ExecutionTime: str | None = None
    RepeatDays: str | None = None

    # interval
    ActiveStartTime: str | None = None
    ActiveEndTime: str | None = None
    IntervalMinutes: int | None = None

    # 공통
    SeriesStartDate: str | None = None
    SeriesEndDate: str | None = None


@database.put("/schedule/{schedule_id}")
def update_schedule(
    schedule_id: int,
    req: ScheduleUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if any(getattr(req, f, None) is not None for f in (
        'ScheduleMode', 'StartTime', 'ExecutionTime', 'ActiveStartTime',
        'ActiveEndTime', 'RepeatDays',
    )):
        check_mode = req.ScheduleMode or sched.ScheduleMode or ("weekly" if sched.Repeat == "Y" else "once")
        class _MergedReq:
            pass
        merged = _MergedReq()
        merged.StartTime = req.StartTime or sched.StartDate
        merged.ExecutionTime = req.ExecutionTime if req.ExecutionTime is not None else sched.ExecutionTime
        merged.RepeatDays = req.RepeatDays if req.RepeatDays is not None else sched.Repeat_Day
        merged.ActiveStartTime = req.ActiveStartTime if req.ActiveStartTime is not None else sched.ActiveStartTime
        merged.ActiveEndTime = req.ActiveEndTime if req.ActiveEndTime is not None else sched.ActiveEndTime
        _check_schedule_conflict(db, sched.RobotName, check_mode, merged, exclude_id=schedule_id)

    if req.TaskStatus is not None:
        sched.TaskStatus = req.TaskStatus

    if req.ScheduleMode is not None:
        sched.ScheduleMode = req.ScheduleMode
        if req.ScheduleMode == "once":
            sched.Repeat = "N"
            sched.Repeat_Day = None
            sched.Repeat_End = None
            sched.ExecutionTime = None
            sched.IntervalMinutes = None
            sched.ActiveStartTime = None
            sched.ActiveEndTime = None
            sched.SeriesStartDate = None
            sched.SeriesEndDate = None
        elif req.ScheduleMode == "weekly":
            sched.Repeat = "Y"
            sched.IntervalMinutes = None
            sched.ActiveStartTime = None
            sched.ActiveEndTime = None
        elif req.ScheduleMode == "interval":
            sched.Repeat = "Y"
            sched.ExecutionTime = None

    if req.StartTime is not None:
        sched.StartDate = req.StartTime
        sched.EndDate = req.StartTime
    if req.ExecutionTime is not None:
        sched.ExecutionTime = req.ExecutionTime
    if req.RepeatDays is not None:
        sched.Repeat_Day = req.RepeatDays
    if req.ActiveStartTime is not None:
        sched.ActiveStartTime = req.ActiveStartTime
    if req.ActiveEndTime is not None:
        sched.ActiveEndTime = req.ActiveEndTime
    if req.IntervalMinutes is not None:
        sched.IntervalMinutes = req.IntervalMinutes
    if req.SeriesStartDate is not None:
        sched.SeriesStartDate = datetime.strptime(req.SeriesStartDate, "%Y-%m-%d").date()
        if sched.ScheduleMode in ("weekly", "interval"):
            exec_time = sched.ExecutionTime or sched.ActiveStartTime or "00:00"
            first_time = exec_time.split(",")[0].strip()
            h, m = first_time.split(":")
            sched.StartDate = datetime.combine(sched.SeriesStartDate, datetime.min.time().replace(hour=int(h), minute=int(m)))
            sched.EndDate = sched.StartDate
    if req.SeriesEndDate is not None:
        sched.SeriesEndDate = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
        sched.Repeat_End = req.SeriesEndDate

    db.commit()
    db.refresh(sched)

    write_audit(db, current_user.id, "schedule_updated", "schedule", sched.id,
                detail=f"스케줄 수정: {sched.WorkName}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "id": sched.id}


@database.delete("/schedule/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")

    work_name = sched.WorkName
    db.delete(sched)
    db.commit()

    write_audit(db, current_user.id, "schedule_deleted", "schedule", schedule_id,
                detail=f"스케줄 삭제: {work_name}",
                ip_address=get_client_ip(request))

    return {"status": "deleted", "id": schedule_id}
