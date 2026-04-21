from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, date, time, timedelta

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
        ScheduleInfo.TaskStatus.in_(["대기", "진행중", "진행"]),
    )
    if exclude_id is not None:
        q = q.filter(ScheduleInfo.id != exclude_id)
    existing_all = q.all()

    # 이미 실행 불가(과거)인 스케줄은 충돌 대상에서 제외
    now = datetime.now()
    today = now.date()
    existing: list = []
    for ex in existing_all:
        ex_mode_tmp = ex.ScheduleMode or ("weekly" if ex.Repeat == "Y" else "once")
        if ex_mode_tmp == "once":
            # once는 StartDate가 과거면 실행 안 됨 (스케줄러 _should_run_once와 동일 규칙)
            if ex.StartDate and ex.StartDate < now - timedelta(minutes=1):
                continue
        else:
            # weekly/interval: SeriesEndDate가 있고 오늘보다 과거면 만료
            if ex.SeriesEndDate and ex.SeriesEndDate < today:
                continue
        existing.append(ex)

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
    import uuid as _uuid

    _check_schedule_conflict(db, req.RobotName, req.ScheduleMode, req)

    schedule = ScheduleInfo(
        UserId=current_user.id,
        RobotName=req.RobotName,
        WorkName=req.TaskName,
        TaskType=req.TaskType,
        WayName=req.WayName,
        TaskStatus=req.WorkStatus,
        ScheduleMode=req.ScheduleMode,
        SeriesGroupId=str(_uuid.uuid4()),
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
            "SeriesExceptions": s.SeriesExceptions,
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
        "SeriesExceptions": schedule.SeriesExceptions,

        "LastRunDate": schedule.LastRunDate.isoformat() if schedule.LastRunDate else None,
        "RunCount": schedule.RunCount or 0,
        "MaxRunCount": schedule.MaxRunCount,
    }


class ScheduleUpdateReq(BaseModel):
    TaskStatus: str | None = None
    ScheduleMode: str | None = None
    StartTime: datetime | None = None
    PathName: str | None = None
    PathOrder: str | None = None

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

    # 반복 시리즈 편집 범위
    # "all" (기본) | "thisAndFuture" | "this"
    RepeatScope: str | None = None
    # "this"/"thisAndFuture" 기준 날짜 (YYYY-MM-DD, 생략 시 오늘)
    TargetDate: str | None = None


def _apply_edit_fields(sched: ScheduleInfo, req: ScheduleUpdateReq) -> None:
    """req의 값들을 sched에 반영. 공통 로직.

    SeriesStartDate/SeriesEndDate는 `null 명시`를 "무기한/초기화"로 해석해야 하므로
    model_fields_set으로 "필드 미전송"과 "null로 명시 설정"을 구분한다.
    """
    fields_set = req.model_fields_set

    if req.TaskStatus is not None:
        sched.TaskStatus = req.TaskStatus
    if req.PathName is not None:
        sched.WayName = req.PathName

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

    # SeriesStartDate — null은 "초기화"
    if "SeriesStartDate" in fields_set:
        if req.SeriesStartDate is None:
            sched.SeriesStartDate = None
        else:
            sched.SeriesStartDate = datetime.strptime(req.SeriesStartDate, "%Y-%m-%d").date()
            if sched.ScheduleMode in ("weekly", "interval"):
                exec_time = sched.ExecutionTime or sched.ActiveStartTime or "00:00"
                first_time = exec_time.split(",")[0].strip()
                h, m = first_time.split(":")
                sched.StartDate = datetime.combine(sched.SeriesStartDate, datetime.min.time().replace(hour=int(h), minute=int(m)))
                sched.EndDate = sched.StartDate

    # SeriesEndDate — null은 "무기한"
    if "SeriesEndDate" in fields_set:
        if req.SeriesEndDate is None:
            sched.SeriesEndDate = None
            sched.Repeat_End = None
        else:
            sched.SeriesEndDate = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
            sched.Repeat_End = req.SeriesEndDate


def _clone_schedule_for_split(source: ScheduleInfo) -> ScheduleInfo:
    """시리즈 분할 시 새 ScheduleInfo를 source 기준으로 복제한다.
    대기 상태로 초기화하고 RunCount/LastRunDate/SeriesExceptions는 리셋.
    SeriesGroupId는 부모와 동일 (split 된 row들은 하나의 시리즈 그룹)."""
    return ScheduleInfo(
        UserId=source.UserId,
        RobotName=source.RobotName,
        WorkName=source.WorkName,
        TaskType=source.TaskType,
        WayName=source.WayName,
        TaskStatus="대기",
        StartDate=source.StartDate,
        EndDate=source.EndDate,
        Repeat=source.Repeat,
        Repeat_Day=source.Repeat_Day,
        Repeat_End=source.Repeat_End,
        ScheduleMode=source.ScheduleMode,
        ExecutionTime=source.ExecutionTime,
        IntervalMinutes=source.IntervalMinutes,
        ActiveStartTime=source.ActiveStartTime,
        ActiveEndTime=source.ActiveEndTime,
        SeriesStartDate=source.SeriesStartDate,
        SeriesEndDate=source.SeriesEndDate,
        SeriesExceptions=None,
        SeriesGroupId=source.SeriesGroupId,
        RunCount=0,
        MaxRunCount=source.MaxRunCount,
    )


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

    # ─── 반복 시리즈 편집 범위 결정 ───
    scope = (req.RepeatScope or "all").strip()
    is_series = (sched.ScheduleMode in ("weekly", "interval")) or (sched.Repeat == "Y")
    # 시리즈가 아닌 once 스케줄엔 범위 의미 없음 → all로 강제
    if not is_series:
        scope = "all"

    try:
        target_date = (
            datetime.strptime(req.TargetDate, "%Y-%m-%d").date()
            if req.TargetDate else date.today()
        )
    except ValueError:
        target_date = date.today()

    # 충돌 체크 — all 범위에서만 기존 로직 적용(분할 시엔 신규 row로 별도 체크)
    if scope == "all" and any(getattr(req, f, None) is not None for f in (
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

    created_id = None

    if scope == "all":
        # 같은 시리즈 그룹의 다른 row(이전 split 산물)는 전체 수정 의미상 제거
        purged_ids: list[int] = []
        group_min_start = sched.SeriesStartDate
        group_any_null_end = sched.SeriesEndDate is None
        group_max_end = sched.SeriesEndDate
        if sched.SeriesGroupId:
            siblings = (
                db.query(ScheduleInfo)
                .filter(
                    ScheduleInfo.SeriesGroupId == sched.SeriesGroupId,
                    ScheduleInfo.id != sched.id,
                )
                .all()
            )
            for s in siblings:
                # 그룹 전체 범위 집계 (과거까지 포괄하려면 최소 Start / 최대 End)
                if s.SeriesStartDate and (group_min_start is None or s.SeriesStartDate < group_min_start):
                    group_min_start = s.SeriesStartDate
                if s.SeriesEndDate is None:
                    group_any_null_end = True
                elif group_max_end is None or s.SeriesEndDate > group_max_end:
                    if not group_any_null_end:
                        group_max_end = s.SeriesEndDate
                purged_ids.append(s.id)
                db.delete(s)
        _apply_edit_fields(sched, req)
        # 그룹이 통합되었으므로 기존 예외 날짜 초기화
        sched.SeriesExceptions = None
        # 전체 범위 의미: 과거·미래 포괄하도록 그룹의 최광역 범위로 보정
        if group_min_start is not None and (sched.SeriesStartDate is None or sched.SeriesStartDate > group_min_start):
            sched.SeriesStartDate = group_min_start
            if sched.ScheduleMode in ("weekly", "interval"):
                exec_time = sched.ExecutionTime or sched.ActiveStartTime or "00:00"
                first_time = exec_time.split(",")[0].strip()
                try:
                    h, m = first_time.split(":")
                    sched.StartDate = datetime.combine(group_min_start, time(int(h), int(m)))
                    sched.EndDate = sched.StartDate
                except ValueError:
                    pass
        if group_any_null_end:
            sched.SeriesEndDate = None
            sched.Repeat_End = None
        elif group_max_end is not None and sched.SeriesEndDate is not None and sched.SeriesEndDate < group_max_end:
            sched.SeriesEndDate = group_max_end
            sched.Repeat_End = group_max_end.strftime("%Y-%m-%d")
        audit_detail = (
            f"스케줄 수정(전체): {sched.WorkName}"
            + (f" / 병합 삭제 id={purged_ids}" if purged_ids else "")
        )

    elif scope == "thisAndFuture":
        # 새 시리즈의 유효기간 종료일이 target_date보다 과거면 빈 범위가 되어 무의미
        if "SeriesEndDate" in req.model_fields_set and req.SeriesEndDate is not None:
            try:
                new_end = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
                if new_end < target_date:
                    raise HTTPException(
                        status_code=400,
                        detail=f"유효기간 종료일({req.SeriesEndDate})이 수정 기준일({target_date}) 이전입니다. 종료일을 기준일 이후로 지정하거나 무기한으로 설정해 주세요.",
                    )
            except ValueError:
                pass

        # 원본 시리즈는 target_date 전일까지만 유지, 새 시리즈로 분할
        new_sched = _clone_schedule_for_split(sched)
        _apply_edit_fields(new_sched, req)
        new_sched.SeriesStartDate = target_date
        # 새 시리즈 StartDate를 target_date 기반으로 재계산
        exec_time = new_sched.ExecutionTime or new_sched.ActiveStartTime or "00:00"
        first_time = exec_time.split(",")[0].strip()
        try:
            h, m = first_time.split(":")
            new_sched.StartDate = datetime.combine(target_date, time(int(h), int(m)))
            new_sched.EndDate = new_sched.StartDate
        except ValueError:
            pass
        db.add(new_sched)

        # 원본 종료일 = target_date - 1
        sched.SeriesEndDate = target_date - timedelta(days=1)
        sched.Repeat_End = sched.SeriesEndDate.strftime("%Y-%m-%d") if sched.SeriesEndDate else sched.Repeat_End

        db.flush()
        created_id = new_sched.id
        audit_detail = f"스케줄 수정(현재+이후): {sched.WorkName} → 새 시리즈 #{created_id}"

    elif scope == "this":
        # 원본 시리즈의 target_date를 예외로 등록 (그 날은 스킵)
        existing = set()
        if sched.SeriesExceptions:
            existing = {d.strip() for d in sched.SeriesExceptions.split(",") if d.strip()}
        existing.add(target_date.strftime("%Y-%m-%d"))
        sched.SeriesExceptions = ",".join(sorted(existing))

        # 새 weekly row 1건 생성 — SeriesStartDate=SeriesEndDate=target_date (하루짜리 weekly)
        # 기존 데이터 모델(ExecutionTime 콤마 구분, weekly 단일 row) 유지
        new_sched = _clone_schedule_for_split(sched)
        _apply_edit_fields(new_sched, req)
        # target_date 하루로 제한
        new_sched.SeriesStartDate = target_date
        new_sched.SeriesEndDate = target_date
        new_sched.Repeat_End = target_date.strftime("%Y-%m-%d")
        new_sched.SeriesExceptions = None
        # StartDate는 target_date + 첫 실행시각으로 재설정
        exec_time = new_sched.ExecutionTime or new_sched.ActiveStartTime or "00:00"
        first_time = exec_time.split(",")[0].strip()
        try:
            h, m = first_time.split(":")
            new_sched.StartDate = datetime.combine(target_date, time(int(h), int(m)))
            new_sched.EndDate = new_sched.StartDate
        except ValueError:
            pass
        db.add(new_sched)

        db.flush()
        created_id = new_sched.id
        audit_detail = f"스케줄 수정(현재만): {sched.WorkName} → weekly #{created_id} ({target_date})"

    else:
        raise HTTPException(status_code=400, detail=f"알 수 없는 RepeatScope: {scope}")

    db.commit()
    db.refresh(sched)

    write_audit(db, current_user.id, "schedule_updated", "schedule", sched.id,
                detail=audit_detail,
                ip_address=get_client_ip(request))

    return {"status": "ok", "id": sched.id, "scope": scope, "created_id": created_id}


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
