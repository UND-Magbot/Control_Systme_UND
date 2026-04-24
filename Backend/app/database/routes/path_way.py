from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from fastapi.encoders import jsonable_encoder

from app.database.models import WayInfo, RouteInfo, UserInfo, LocationInfo
from app.auth.dependencies import require_any_permission, is_admin, get_business_robot_names
from app.auth.audit import write_audit, get_client_ip

from app.database.routes import database, get_db


def _derive_path_floor_ids(db: Session, paths) -> dict[int, int | None]:
    """경로 ID → FloorId 매핑.

    WayInfo 에는 FloorId 가 없으므로, 각 경로의 첫 번째 웨이포인트(LocationInfo)의
    FloorId 를 경로의 층으로 본다. 배치 쿼리로 N+1 방지.
    경로에 웨이포인트가 없거나 매칭 장소를 못 찾으면 해당 경로의 FloorId 는 None.
    """
    first_name_by_pid: dict[int, str] = {}
    for p in paths:
        if not p.WayPoints:
            continue
        parts = [n.strip() for n in p.WayPoints.split(" - ") if n and n.strip()]
        if parts:
            first_name_by_pid[p.id] = parts[0]
    if not first_name_by_pid:
        return {p.id: None for p in paths}

    names = set(first_name_by_pid.values())
    rows = (
        db.query(LocationInfo.LacationName, LocationInfo.FloorId)
        .filter(LocationInfo.LacationName.in_(names))
        .all()
    )
    name_to_floor: dict[str, int | None] = {}
    for r in rows:
        # 같은 이름의 장소가 여러 층에 있을 일은 드물지만, 먼저 매칭된 것을 사용
        if r.LacationName not in name_to_floor:
            name_to_floor[r.LacationName] = r.FloorId

    return {p.id: name_to_floor.get(first_name_by_pid.get(p.id, "")) for p in paths}


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
    paths = q.order_by(WayInfo.id.desc()).all()
    floor_map = _derive_path_floor_ids(db, paths)
    result = []
    for p in paths:
        data = jsonable_encoder(p)
        data["FloorId"] = floor_map.get(p.id)
        result.append(data)
    return result


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
    paths = q.all()
    floor_map = _derive_path_floor_ids(db, paths)
    result = []
    for p in paths:
        data = jsonable_encoder(p)
        data["FloorId"] = floor_map.get(p.id)
        result.append(data)
    return result


@database.get("/way-names")
def get_way_names(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("path-list", "map-edit", "schedule-list"))):
    # FloorId 계산을 위해 WayPoints 까지 포함해 조회 (경량 필드만)
    q = db.query(WayInfo.id, WayInfo.WayName, WayInfo.RobotName, WayInfo.TaskType, WayInfo.WayPoints)
    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        q = q.filter(WayInfo.RobotName.in_(biz_names) | (WayInfo.RobotName == "") | (WayInfo.RobotName.is_(None)))
    paths = q.order_by(WayInfo.id.desc()).all()
    floor_map = _derive_path_floor_ids(db, paths)

    return [
        {
            "id": p.id,
            "WayName": p.WayName,
            "RobotName": p.RobotName,
            "TaskType": p.TaskType,
            "FloorId": floor_map.get(p.id),
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
