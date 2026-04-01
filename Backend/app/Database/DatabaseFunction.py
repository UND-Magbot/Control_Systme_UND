from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.Database.database import SessionLocal
from app.Database.models import RobotInfo
from app.Database.models import LocationInfo
from app.Database.models import WayInfo
from app.Database.models import ScheduleInfo
from app.Database.models import RouteInfo
from fastapi.encoders import jsonable_encoder

from datetime import datetime

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
    limit_battery: int

@database.post("/RobotInsert")
def insert_Robot(req: RobotInsertReq, db: Session = Depends(get_db)):
    # 1️⃣ SerialNumber 중복 체크
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

    # 2️⃣ INSERT
    robot = RobotInfo(
        UserId=1,
        RobotName=req.robot_name,
        ModelName=req.robot_model,
        LimitBattery=req.limit_battery,
        SerialNumber=req.robot_id
    )

    db.add(robot)
    db.commit()

    return {"status": "ok"}

@database.get("/robots")
def get_robots(db: Session = Depends(get_db)):
    robots = (
        db.query(RobotInfo)
        .order_by(RobotInfo.id.asc())   # ⭐ 중요 (순서 고정)
        .all()                          # ⭐ 핵심
    )
    return robots

@database.get("/robots/{robot_id}")
def get_robot_by_id(robot_id: int, db: Session = Depends(get_db)):
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
    db: Session = Depends(get_db)
):
    place = LocationInfo(
        UserId=1,              # 🔹 임시 (로그인 연동 전)
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

    return place

@database.get("/places")
def get_places(map_id: int | None = None, db: Session = Depends(get_db)):
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
def insert_path(req: PathInsertReq, db: Session = Depends(get_db)):
    path = WayInfo(
        UserId=1,
        RobotName=req.RobotName,
        TaskType=req.TaskType,
        WayName=req.WayName,
        WayPoints=req.WayPoints,
    )
    print("path: ",path)
    db.add(path)
    db.commit()
    return {"status": "ok"}

# =========================
# 경로 목록 조회
# =========================
@database.get("/paths")
def get_paths(db: Session = Depends(get_db)):
    paths = (
        db.query(WayInfo)
        .order_by(WayInfo.id.desc())
        .all()
    )
    return paths


class PathRes(BaseModel):
    id: int
    UserId: int | None
    RobotName: str | None
    TaskType: str | None
    WayName: str | None
    WayPoints: str | None
    UpdateTime: datetime | None   # ⭐ NULL 대비

    class Config:
        from_attributes = True
        
@database.get("/getpath")
def get_paths(db: Session = Depends(get_db)):
    paths = db.query(WayInfo).all()
    return jsonable_encoder(paths)


@database.get("/way-names")
def get_way_names(db: Session = Depends(get_db)):
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
    db: Session = Depends(get_db)
):
    schedule = ScheduleInfo(
        UserId=1,
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

    return {"status": "ok", "id": schedule.id}

@database.get("/schedule")
def get_schedules(db: Session = Depends(get_db)):
    schedules = (
        db.query(ScheduleInfo)
        .order_by(ScheduleInfo.StartDate.asc())
        .all()
    )
    return schedules

@database.get("/schedule/{schedule_id}")
def get_schedule_detail(schedule_id: int, db: Session = Depends(get_db)):
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
    db: Session = Depends(get_db)
):
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    # 필요한 것만 업데이트
    if req.operator is not None:
        robot.ProductCompany = req.operator
    if req.serialNumber is not None:
        robot.SerialNumber = req.serialNumber
    if req.model is not None:
        robot.ModelName = req.model
    if req.group is not None:
        robot.Group = req.group
    if req.softwareVersion is not None:
        robot.SWversion = req.softwareVersion
    if req.site is not None:
        robot.Site = req.site
    if req.limit_battery is not None:
        robot.LimitBattery = req.limit_battery

    db.commit()
    db.refresh(robot)

    return {"status": "ok"}

class RobotUpdateReq(BaseModel):
    Operator: str | None = None
    SerialNumber: str | None = None
    ModelName: str | None = None
    Group: str | None = None
    SWversion: str | None = None
    Site: str | None = None
    LimitBattery: int | None = None

@database.put("/robots/{robot_id}")
def update_robot(
    robot_id: int,
    req: RobotUpdateReq,
    db: Session = Depends(get_db)
):
    robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()

    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    if req.Operator is not None:
        robot.ProductCompany = req.Operator
    if req.SerialNumber is not None:
        robot.SerialNumber = req.SerialNumber
    if req.ModelName is not None:
        robot.ModelName = req.ModelName
    if req.Group is not None:
        robot.Group = req.Group
    if req.SWversion is not None:
        robot.SWversion = req.SWversion
    if req.Site is not None:
        robot.Site = req.Site
    if req.LimitBattery is not None:
        robot.LimitBattery = req.LimitBattery

    db.commit()
    db.refresh(robot)

    return robot

@database.delete("/robots/{robot_id}")
def delete_robot(robot_id: int, db: Session = Depends(get_db)):
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    db.delete(robot)
    db.commit()

    return {"status": "ok", "deleted_id": robot_id}


@database.put("/places/{place_id}")
def update_place(place_id: int, req: RobotPlaceInsertReq, db: Session = Depends(get_db)):
    place = db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    place.RobotName = req.RobotName
    place.LacationName = req.LacationName
    place.Floor = req.Floor
    place.LocationX = req.LocationX
    place.LocationY = req.LocationY
    place.Yaw = req.Yaw
    place.MapId = req.MapId
    place.Imformation = req.Imformation

    db.commit()
    db.refresh(place)

    return place


@database.delete("/places/{place_id}")
def delete_place(place_id: int, db: Session = Depends(get_db)):
    place = (
        db.query(LocationInfo)
        .filter(LocationInfo.id == place_id)
        .first()
    )

    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    db.delete(place)
    db.commit()

    return {"status": "deleted"}


@database.delete("/path/{path_id}")
def delete_path(path_id: int, db: Session = Depends(get_db)):
    path = (
        db.query(WayInfo)
        .filter(WayInfo.id == path_id)
        .first()
    )

    if not path:
        raise HTTPException(status_code=404, detail="Path not found")

    db.delete(path)
    db.commit()

    return {"status": "deleted"}


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