from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.Database.database import SessionLocal
from app.Database.models import RobotInfo, LocationInfo, WayInfo, ScheduleInfo, UserInfo, RobotModule, ModuleCameraInfo, RouteInfo, RobotLastStatus, BusinessInfo
from fastapi.encoders import jsonable_encoder

from datetime import datetime
from app.auth.dependencies import get_current_user, require_permission, require_any_permission
from app.auth.audit import write_audit, get_client_ip

database = APIRouter(prefix="/DB")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# =========================
# Robot INSERT
# =========================
class RobotInsertReq(BaseModel):
    robot_id: str
    robot_name: str
    robot_model: str
    robot_type: Optional[str] = None
    robot_ip: Optional[str] = None
    robot_port: Optional[int] = 30000
    limit_battery: int = 30
    business_id: Optional[int] = None
    sw_version: Optional[str] = None

@database.post("/RobotInsert")
def insert_Robot(req: RobotInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
    exists = (
        db.query(RobotInfo)
        .filter(RobotInfo.SerialNumber == req.robot_id)
        .first()
    )

    if exists:
        raise HTTPException(
            status_code=409,
            detail="이미 등록된 시리얼 넘버입니다."
        )

    robot = RobotInfo(
        UserId=current_user.id,
        RobotName=req.robot_name,
        RobotType=req.robot_type,
        RobotIP=req.robot_ip,
        RobotPort=req.robot_port,
        ModelName=req.robot_model,
        LimitBattery=req.limit_battery,
        SerialNumber=req.robot_id,
        BusinessId=req.business_id,
        SWversion=req.sw_version,
    )

    db.add(robot)
    db.flush()

    # 로봇 타입별 내장 카메라 자동 생성
    DEFAULT_BUILT_IN_CAMERAS = {
        "QUADRUPED": [("전방", "/video1"), ("후방", "/video2")],
        "AMR":       [("전방", "/video1")],
        "HUMANOID":  [("전방", "/video1"), ("후방", "/video2")],
        "COBOT":     [],
    }
    for idx, (label, path) in enumerate(DEFAULT_BUILT_IN_CAMERAS.get(req.robot_type or "", [])):
        module = RobotModule(
            RobotId=robot.id, ModuleType="camera", Label=label,
            IsBuiltIn=1, SortOrder=idx,
        )
        db.add(module)
        db.flush()
        db.add(ModuleCameraInfo(ModuleId=module.id, StreamType="rtsp", Port=8554, Path=path))

    db.commit()
    db.refresh(robot)

    write_audit(db, current_user.id, "robot_created", "robot", robot.id,
                detail=f"로봇명: {req.robot_name}, 시리얼: {req.robot_id}, 모델: {req.robot_model}",
                ip_address=get_client_ip(request))

    return {"status": "ok"}

@database.get("/robots")
def get_robots(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list", "schedule-list"))):
    rows = (
        db.query(RobotInfo, RobotLastStatus, BusinessInfo.BusinessName)
        .outerjoin(RobotLastStatus, RobotInfo.id == RobotLastStatus.RobotId)
        .outerjoin(BusinessInfo, RobotInfo.BusinessId == BusinessInfo.id)
        .order_by(RobotInfo.id.asc())
        .all()
    )
    result = []
    for robot, status, biz_name in rows:
        data = jsonable_encoder(robot)
        data["ProductCompany"] = biz_name or robot.ProductCompany
        if status:
            data["BatteryLevel1"] = status.BatteryLevel1
            data["BatteryLevel2"] = status.BatteryLevel2
            data["Voltage1"] = status.Voltage1
            data["Voltage2"] = status.Voltage2
            data["BatteryTemp1"] = status.BatteryTemp1
            data["BatteryTemp2"] = status.BatteryTemp2
            data["IsCharging1"] = status.IsCharging1
            data["IsCharging2"] = status.IsCharging2
            data["PosX"] = status.PosX
            data["PosY"] = status.PosY
            data["PosYaw"] = status.PosYaw
            data["LastHeartbeat"] = status.LastHeartbeat.isoformat() if status.LastHeartbeat else None
        result.append(data)
    return result

@database.get("/robots/{robot_id}")
def get_robot_by_id(robot_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list"))):
    row = (
        db.query(RobotInfo, BusinessInfo.BusinessName)
        .outerjoin(BusinessInfo, RobotInfo.BusinessId == BusinessInfo.id)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not row:
        raise HTTPException(status_code=404, detail="Robot not found")

    robot, biz_name = row
    data = jsonable_encoder(robot)
    data["ProductCompany"] = biz_name or robot.ProductCompany
    return data


class RobotPlaceInsertReq(BaseModel):
    RobotName: str
    LacationName: str
    Floor: str
    LocationX: float
    LocationY: float
    Yaw: float = 0.0
    MapId: int | None = None
    Imformation: str | None = None

@database.post("/places")
def insert_robot_place(
    req: RobotPlaceInsertReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit")),
):
    place = LocationInfo(
        UserId=current_user.id,
        RobotName=req.RobotName,
        LacationName=req.LacationName,
        Floor=req.Floor,
        LocationX=req.LocationX,
        LocationY=req.LocationY,
        Yaw=req.Yaw,
        MapId=req.MapId,
        Imformation=req.Imformation,
    )

    db.add(place)
    db.commit()
    db.refresh(place)

    write_audit(db, current_user.id, "place_created", "place", place.id,
                detail=f"장소명: {req.LacationName}, 로봇: {req.RobotName}, 층: {req.Floor}",
                ip_address=get_client_ip(request))

    return place

@database.get("/places")
def get_places(map_id: int | None = None, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit", "schedule-list"))):
    q = db.query(LocationInfo)
    if map_id is not None:
        q = q.filter(LocationInfo.MapId == map_id)
    return q.order_by(LocationInfo.id.desc()).all()


class PathInsertReq(BaseModel):
    RobotName: str
    TaskType: str
    WayName: str
    WayPoints: str

@database.post("/path")
def insert_path(req: PathInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit"))):
    path = WayInfo(
        UserId=current_user.id,
        RobotName=req.RobotName,
        TaskType=req.TaskType,
        WayName=req.WayName,
        WayPoints=req.WayPoints,
    )
    db.add(path)
    db.commit()
    db.refresh(path)
    write_audit(db, current_user.id, "path_created", "path", path.id,
                detail=f"경로명: {req.WayName}, 로봇: {req.RobotName}, 유형: {req.TaskType}",
                ip_address=get_client_ip(request))
    return {"status": "ok"}

# =========================
# 경로 목록 조회
# =========================
@database.get("/paths")
def get_paths(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit", "schedule-list"))):
    paths = (
        db.query(WayInfo)
        .order_by(WayInfo.id.desc())
        .all()
    )
    return paths


class PathRes(BaseModel):
    id: int
    UserId: str | None
    RobotName: str | None
    TaskType: str | None
    WayName: str | None
    WayPoints: str | None
    UpdateTime: datetime | None   # ⭐ NULL 대비

    class Config:
        from_attributes = True
        
@database.get("/getpath")
def get_paths_legacy(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit", "schedule-list"))):
    paths = db.query(WayInfo).all()
    return jsonable_encoder(paths)


@database.get("/way-names")
def get_way_names(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit", "schedule-list"))):
    paths = (
        db.query(
            WayInfo.id,
            WayInfo.WayName,
            WayInfo.RobotName
        )
        .order_by(WayInfo.id.desc())
        .all()
    )

    return [
        {
            "id": p.id,
            "WayName": p.WayName,
            "RobotName": p.RobotName,
        }
        for p in paths
    ]


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

    # 한쪽이라도 interval이 아니면 검사할 필요 없음
    # (once/weekly 간 충돌은 스케줄러가 _active_schedule_id로 직렬 처리)

    # 같은 로봇의 활성 스케줄 (완료 제외)
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

    # 등록하려는 스케줄 정보 추출
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

        # 한쪽이라도 interval이어야 충돌 검사 의미 있음
        if mode != "interval" and ex_mode != "interval":
            continue

        # 요일 겹침 확인
        ex_days: set[str] | None = None
        if ex.Repeat_Day:
            ex_days = set(d.strip() for d in ex.Repeat_Day.split(","))

        if new_days and ex_days:
            if not new_days & ex_days:
                continue

        # once vs 반복: once 날짜 요일이 반복 요일에 포함되는지
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

        # interval 시간대 추출
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

    # 시간 충돌 검사
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
    schedules = (
        db.query(ScheduleInfo)
        .order_by(ScheduleInfo.StartDate.asc())
        .all()
    )
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
    from app.scheduler.engine import get_active_schedule_id
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

        # 3모드 스케줄 필드
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

    # 시간 관련 필드 변경 시 충돌 검사
    if any(getattr(req, f, None) is not None for f in (
        'ScheduleMode', 'StartTime', 'ExecutionTime', 'ActiveStartTime',
        'ActiveEndTime', 'RepeatDays',
    )):
        check_mode = req.ScheduleMode or sched.ScheduleMode or ("weekly" if sched.Repeat == "Y" else "once")
        # 변경될 값을 반영한 임시 객체 생성
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

    # 모드 변경 시 불필요 필드 정리
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
        # 레거시 호환
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


class RobotUpdateReq(BaseModel):
    robotName: str | None = None
    operator: str | None = None
    serialNumber: str | None = None
    model: str | None = None
    group: str | None = None
    softwareVersion: str | None = None
    site: str | None = None
    limit_battery: int | None = None
    business_id: int | None = None

@database.put("/robots/{robot_id}")
def update_robot(
    robot_id: int,
    req: RobotUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    changes = []
    field_map = {
        "로봇명": ("RobotName", req.robotName),
        "제조사": ("ProductCompany", req.operator),
        "시리얼번호": ("SerialNumber", req.serialNumber),
        "모델": ("ModelName", req.model),
        "그룹": ("Group", req.group),
        "SW버전": ("SWversion", req.softwareVersion),
        "사이트": ("Site", req.site),
        "배터리제한": ("LimitBattery", req.limit_battery),
        "사업장": ("BusinessId", req.business_id),
    }

    for label, (attr, new_val) in field_map.items():
        if new_val is None:
            continue
        old_val = getattr(robot, attr)
        if old_val != new_val:
            changes.append(f"{label}: {old_val or ''} → {new_val}")
            setattr(robot, attr, new_val)

    db.commit()
    db.refresh(robot)

    detail = ", ".join(changes) if changes else None
    write_audit(db, current_user.id, "robot_updated", "robot", robot_id, detail=detail,
                ip_address=get_client_ip(request))

    return {"status": "ok"}

@database.delete("/robots/{robot_id}")
def delete_robot(robot_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    robot_name = robot.RobotName
    db.delete(robot)
    db.commit()

    write_audit(db, current_user.id, "robot_deleted", "robot", robot_id,
                detail=f"로봇명: {robot_name}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "deleted_id": robot_id}


@database.put("/places/{place_id}")
def update_place(place_id: int, req: RobotPlaceInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit"))):
    place = db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    changes = []
    field_map = {
        "로봇": ("RobotName", req.RobotName),
        "장소명": ("LacationName", req.LacationName),
        "층": ("Floor", req.Floor),
        "X좌표": ("LocationX", req.LocationX),
        "Y좌표": ("LocationY", req.LocationY),
        "방향": ("Yaw", req.Yaw),
        "맵ID": ("MapId", req.MapId),
        "정보": ("Imformation", req.Imformation),
    }

    for label, (attr, new_val) in field_map.items():
        old_val = getattr(place, attr)
        if old_val != new_val:
            changes.append(f"{label}: {old_val or ''} → {new_val or ''}")
            setattr(place, attr, new_val)

    db.commit()
    db.refresh(place)

    detail = ", ".join(changes) if changes else None
    write_audit(db, current_user.id, "place_updated", "place", place_id, detail=detail,
                ip_address=get_client_ip(request))

    return place


@database.delete("/places/{place_id}")
def delete_place(place_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit"))):
    place = (
        db.query(LocationInfo)
        .filter(LocationInfo.id == place_id)
        .first()
    )

    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    place_name = place.LacationName
    db.delete(place)
    db.commit()

    write_audit(db, current_user.id, "place_deleted", "place", place_id,
                detail=f"장소명: {place_name}",
                ip_address=get_client_ip(request))

    return {"status": "deleted"}


@database.delete("/path/{path_id}")
def delete_path(path_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit"))):
    path = (
        db.query(WayInfo)
        .filter(WayInfo.id == path_id)
        .first()
    )

    if not path:
        raise HTTPException(status_code=404, detail="Path not found")

    path_name = path.WayName
    db.delete(path)
    db.commit()

    write_audit(db, current_user.id, "path_deleted", "path", path_id,
                detail=f"경로명: {path_name}",
                ip_address=get_client_ip(request))

    return {"status": "deleted"}


# =========================
# 모듈 API
# =========================

def _build_module_tree(modules: list[RobotModule], robot: RobotInfo) -> list[dict]:
    """flat 모듈 목록을 트리 구조로 변환"""
    by_id = {}
    roots = []

    for m in modules:
        node = {
            "id": m.id,
            "type": m.ModuleType,
            "label": m.Label,
            "parentModuleId": m.ParentModuleId,
            "isBuiltIn": bool(m.IsBuiltIn),
            "isActive": bool(m.IsActive),
            "sortOrder": m.SortOrder,
            "createdAt": m.CreatedAt.strftime("%Y-%m-%d %H:%M") if m.CreatedAt else None,
            "config": None,
            "children": [],
        }

        if m.ModuleType == "camera" and m.camera_info:
            ci = m.camera_info
            ip = ci.CameraIP or robot.RobotIP
            if ci.StreamType == "ws":
                stream_url = f"ws://{ip}:{ci.Port}"
            else:
                stream_url = f"/Video/{m.id}"
            node["config"] = {
                "streamType": ci.StreamType,
                "streamUrl": stream_url,
                "cameraIP": ip,
                "port": ci.Port,
                "path": ci.Path,
            }

        by_id[m.id] = node

    for node in by_id.values():
        pid = node["parentModuleId"]
        if pid and pid in by_id:
            by_id[pid]["children"].append(node)
        else:
            roots.append(node)

    return roots


@database.get("/robots/{robot_id}/modules")
def get_robot_modules(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    modules = (
        db.query(RobotModule)
        .filter(RobotModule.RobotId == robot_id)
        .order_by(RobotModule.SortOrder)
        .all()
    )

    return {"modules": _build_module_tree(modules, robot)}


class ModuleCreateReq(BaseModel):
    moduleType: str                     # "camera", "arm", "gripper", "sensor"
    label: str
    parentModuleId: Optional[int] = None
    sortOrder: int = 0
    # 카메라 전용
    streamType: Optional[str] = None    # "rtsp" | "ws"
    cameraIP: Optional[str] = None
    port: Optional[int] = None
    path: Optional[str] = None


@database.post("/robots/{robot_id}/modules")
def create_module(
    robot_id: int,
    req: ModuleCreateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    if req.parentModuleId:
        parent = db.query(RobotModule).filter(
            RobotModule.id == req.parentModuleId,
            RobotModule.RobotId == robot_id,
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent module not found")

    module = RobotModule(
        RobotId=robot_id,
        ParentModuleId=req.parentModuleId,
        ModuleType=req.moduleType,
        Label=req.label,
        IsBuiltIn=0,
        SortOrder=req.sortOrder,
    )
    db.add(module)
    db.flush()

    if req.moduleType == "camera" and req.streamType:
        db.add(ModuleCameraInfo(
            ModuleId=module.id,
            StreamType=req.streamType,
            CameraIP=req.cameraIP,
            Port=req.port,
            Path=req.path,
        ))

    db.commit()

    write_audit(db, current_user.id, "module_created", "module", module.id,
                detail=f"타입: {req.moduleType}, 라벨: {req.label}, 로봇ID: {robot_id}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "id": module.id}


class ModuleUpdateReq(BaseModel):
    label: Optional[str] = None
    sortOrder: Optional[int] = None
    isActive: Optional[int] = None
    # 카메라 전용
    streamType: Optional[str] = None
    cameraIP: Optional[str] = None
    port: Optional[int] = None
    path: Optional[str] = None


@database.put("/modules/{module_id}")
def update_module(
    module_id: int,
    req: ModuleUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    module = db.query(RobotModule).filter(RobotModule.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    if req.label is not None:
        module.Label = req.label
    if req.sortOrder is not None:
        module.SortOrder = req.sortOrder
    if req.isActive is not None:
        module.IsActive = req.isActive

    if module.ModuleType == "camera" and module.camera_info:
        ci = module.camera_info
        if req.streamType is not None:
            ci.StreamType = req.streamType
        if req.cameraIP is not None:
            ci.CameraIP = req.cameraIP or None
        if req.port is not None:
            ci.Port = req.port
        if req.path is not None:
            ci.Path = req.path

    db.commit()

    write_audit(db, current_user.id, "module_updated", "module", module_id,
                ip_address=get_client_ip(request))

    return {"status": "ok"}


@database.delete("/modules/{module_id}")
def delete_module(
    module_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    module = db.query(RobotModule).filter(RobotModule.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    if module.IsBuiltIn:
        raise HTTPException(status_code=400, detail="내장 모듈은 삭제할 수 없습니다")

    label = module.Label
    db.delete(module)
    db.commit()

    write_audit(db, current_user.id, "module_deleted", "module", module_id,
                detail=f"라벨: {label}",
                ip_address=get_client_ip(request))

    return {"status": "ok"}


# =========================
# 경로(구간) CRUD
# =========================
class RouteInsertReq(BaseModel):
    MapId: int
    StartPlaceName: str
    EndPlaceName: str
    Direction: str  # forward, reverse, bidirectional


@database.get("/routes")
def get_routes(map_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(RouteInfo)
    if map_id is not None:
        q = q.filter(RouteInfo.MapId == map_id)
    return q.all()


@database.post("/routes")
def insert_route(req: RouteInsertReq, db: Session = Depends(get_db)):
    route = RouteInfo(
        MapId=req.MapId,
        StartPlaceName=req.StartPlaceName,
        EndPlaceName=req.EndPlaceName,
        Direction=req.Direction,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    return route


@database.delete("/routes/{route_id}")
def delete_route(route_id: int, db: Session = Depends(get_db)):
    route = db.query(RouteInfo).filter(RouteInfo.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    db.delete(route)
    db.commit()
    return {"status": "deleted"}
