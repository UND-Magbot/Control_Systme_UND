from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from fastapi.encoders import jsonable_encoder

from app.database.models import WayInfo, RouteInfo, UserInfo
from app.auth.dependencies import require_any_permission, is_admin, get_business_robot_names
from app.auth.audit import write_audit, get_client_ip

from app.database.routes import database, get_db


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


@database.get("/paths")
def get_paths(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit", "schedule-list"))):
    q = db.query(WayInfo)
    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        q = q.filter(WayInfo.RobotName.in_(biz_names) | (WayInfo.RobotName == "") | (WayInfo.RobotName.is_(None)))
    return q.order_by(WayInfo.id.desc()).all()


class PathRes(BaseModel):
    id: int
    UserId: str | None
    RobotName: str | None
    TaskType: str | None
    WayName: str | None
    WayPoints: str | None
    UpdateTime: datetime | None

    class Config:
        from_attributes = True


@database.get("/getpath")
def get_paths_legacy(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit", "schedule-list"))):
    q = db.query(WayInfo)
    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        q = q.filter(WayInfo.RobotName.in_(biz_names) | (WayInfo.RobotName == "") | (WayInfo.RobotName.is_(None)))
    return jsonable_encoder(q.all())


@database.get("/way-names")
def get_way_names(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit", "schedule-list"))):
    q = db.query(WayInfo.id, WayInfo.WayName, WayInfo.RobotName)
    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        q = q.filter(WayInfo.RobotName.in_(biz_names) | (WayInfo.RobotName == "") | (WayInfo.RobotName.is_(None)))
    paths = q.order_by(WayInfo.id.desc()).all()

    return [
        {
            "id": p.id,
            "WayName": p.WayName,
            "RobotName": p.RobotName,
        }
        for p in paths
    ]


@database.put("/path/{path_id}")
def update_path(path_id: int, req: PathInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit"))):
    path = db.query(WayInfo).filter(WayInfo.id == path_id).first()
    if not path:
        raise HTTPException(status_code=404, detail="Path not found")

    changes = []
    if path.RobotName != req.RobotName:
        changes.append(f"로봇: {path.RobotName} → {req.RobotName}")
        path.RobotName = req.RobotName
    if path.TaskType != req.TaskType:
        changes.append(f"유형: {path.TaskType} → {req.TaskType}")
        path.TaskType = req.TaskType
    if path.WayName != req.WayName:
        changes.append(f"경로명: {path.WayName} → {req.WayName}")
        path.WayName = req.WayName
    if path.WayPoints != req.WayPoints:
        changes.append(f"경유지 변경")
        path.WayPoints = req.WayPoints

    db.commit()
    db.refresh(path)

    detail = ", ".join(changes) if changes else None
    write_audit(db, current_user.id, "path_updated", "path", path_id, detail=detail,
                ip_address=get_client_ip(request))

    return {"status": "ok"}


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
