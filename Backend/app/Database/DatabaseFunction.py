from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.Database.database import SessionLocal
from app.Database.models import RobotInfo, LocationInfo, WayInfo, ScheduleInfo, UserInfo, RobotModule, ModuleCameraInfo
from fastapi.encoders import jsonable_encoder

from datetime import datetime
from app.auth.dependencies import get_current_user
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

@database.post("/RobotInsert")
def insert_Robot(req: RobotInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def get_robots(db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    robots = (
        db.query(RobotInfo)
        .order_by(RobotInfo.id.asc())   # ⭐ 중요 (순서 고정)
        .all()                          # ⭐ 핵심
    )
    return robots

@database.get("/robots/{robot_id}")
def get_robot_by_id(robot_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    print("✅ robot fetched from DB:", robot.id)  # 확인용
    return robot


class RobotPlaceInsertReq(BaseModel):
    RobotName: str
    LacationName : str
    Floor: str
    LocationX: float
    LocationY: float
    Yaw: float = 0.0
    Imformation: str | None = None

@database.post("/places")
def insert_robot_place(
    req: RobotPlaceInsertReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
):
    place = LocationInfo(
        UserId=current_user.id,
        RobotName=req.RobotName,
        LacationName = req.LacationName,
        Floor=req.Floor,
        LocationX=req.LocationX,
        LocationY=req.LocationY,
        Yaw=req.Yaw,
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
def get_places(db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    return db.query(LocationInfo).order_by(LocationInfo.id.desc()).all()


class PathInsertReq(BaseModel):
    RobotName: str
    TaskType: str
    WayName: str
    WayPoints: str

@database.post("/path")
def insert_path(req: PathInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def get_paths(db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def get_paths_legacy(db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    paths = db.query(WayInfo).all()
    return jsonable_encoder(paths)


@database.get("/way-names")
def get_way_names(db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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

    StartTime: datetime
    EndTime: datetime

    Repeat: bool
    RepeatDays: str | None = None
    RepeatEndDate: datetime | None = None

@database.post("/schedule")
def insert_schedule(
    req: ScheduleInsertReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
):
    schedule = ScheduleInfo(
        UserId=current_user.id,
        RobotName=req.RobotName,
        WorkName=req.TaskName,            
        TaskType=req.TaskType,
        WayName=req.WayName,
        TaskStatus=req.WorkStatus,       
        StartDate=req.StartTime,         
        EndDate=req.EndTime,             
        Repeat="Y" if req.Repeat else "N",
        Repeat_Day=req.RepeatDays,
        Repeat_End=req.RepeatEndDate
    )

    db.add(schedule)
    db.commit()
    db.refresh(schedule)

    write_audit(db, current_user.id, "schedule_created", "schedule", schedule.id,
                detail=f"작업명: {req.TaskName}, 로봇: {req.RobotName}, 유형: {req.TaskType}, 경로: {req.WayName}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "id": schedule.id}

@database.get("/schedule")
def get_schedules(db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    schedules = (
        db.query(ScheduleInfo)
        .order_by(ScheduleInfo.StartDate.asc())
        .all()
    )
    return schedules

@database.get("/schedule/{schedule_id}")
def get_schedule_detail(schedule_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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

        "StartDate": schedule.StartDate.isoformat(),
        "EndDate": schedule.EndDate.isoformat(),

        "Repeat": schedule.Repeat,
        "Repeat_Day": schedule.Repeat_Day,      # "월,화,수"
        "Repeat_End": schedule.Repeat_End,      # "2025-12-13" or null

        "WayName": schedule.WayName,
    }

class RobotUpdateReq(BaseModel):
    robotName: str | None = None
    operator: str | None = None
    serialNumber: str | None = None
    model: str | None = None
    group: str | None = None
    softwareVersion: str | None = None
    site: str | None = None
    limit_battery: int | None = None

@database.put("/robots/{robot_id}")
def update_robot(
    robot_id: int,
    req: RobotUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
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
def delete_robot(robot_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def update_place(place_id: int, req: RobotPlaceInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def delete_place(place_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def delete_path(path_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
                "cameraIP": ci.CameraIP,
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
    current_user: UserInfo = Depends(get_current_user),
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
    current_user: UserInfo = Depends(get_current_user),
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
    current_user: UserInfo = Depends(get_current_user),
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
    current_user: UserInfo = Depends(get_current_user),
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