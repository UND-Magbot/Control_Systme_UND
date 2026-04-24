from fastapi import Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database.models import LocationInfo, UserInfo, FloorInfo
from app.auth.dependencies import require_any_permission, get_current_user, is_admin, get_business_map_ids
from app.auth.audit import write_audit, get_client_ip

from app.database.routes import database, get_db
from app.database.routes._helpers import get_floor_name


def _place_name_conflict(db: Session, map_id: int | None, name: str, category: str | None, exclude_id: int | None = None):
    """같은 MapId 내에 동일 장소명이 이미 존재하는지 검사 (대소문자·공백 무시, 위험지역 제외)."""
    if map_id is None or category == "danger":
        return False
    trimmed = (name or "").strip().lower()
    if not trimmed:
        return False
    q = (
        db.query(LocationInfo)
        .filter(LocationInfo.MapId == map_id)
        .filter((LocationInfo.Category != "danger") | (LocationInfo.Category.is_(None)))
        .filter(func.lower(func.trim(LocationInfo.LacationName)) == trimmed)
    )
    if exclude_id is not None:
        q = q.filter(LocationInfo.id != exclude_id)
    return db.query(q.exists()).scalar()


class RobotPlaceInsertReq(BaseModel):
    RobotName: str
    LacationName: str
    FloorId: int | None = None
    LocationX: float
    LocationY: float
    Yaw: float = 0.0
    MapId: int | None = None
    Category: str = "waypoint"
    Imformation: str | None = None


@database.post("/places")
def insert_robot_place(
    req: RobotPlaceInsertReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit")),
):
    if _place_name_conflict(db, req.MapId, req.LacationName, req.Category):
        raise HTTPException(status_code=409, detail="같은 맵에 동일한 장소명이 이미 존재합니다.")

    place = LocationInfo(
        UserId=current_user.id,
        RobotName=req.RobotName,
        LacationName=req.LacationName,
        FloorId=req.FloorId,
        LocationX=req.LocationX,
        LocationY=req.LocationY,
        Yaw=req.Yaw,
        MapId=req.MapId,
        Category=req.Category,
        Imformation=req.Imformation,
    )

    db.add(place)
    db.commit()
    db.refresh(place)

    floor_name = get_floor_name(db, req.FloorId)
    write_audit(db, current_user.id, "place_created", "place", place.id,
                detail=f"장소명: {req.LacationName}, 로봇: {req.RobotName}, 층: {floor_name}",
                ip_address=get_client_ip(request))

    return place


@database.get("/places")
def get_places(
    map_id: int | None = None,
    include_danger: bool = False,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),  # 맵 뷰는 어느 탭에서든 표시 가능
):
    q = db.query(LocationInfo)
    # 위험지역 꼭짓점은 장소 목록에서 숨김 (include_danger=true로 명시할 때만 포함)
    if not include_danger:
        q = q.filter((LocationInfo.Category != "danger") | (LocationInfo.Category.is_(None)))
    if map_id is not None:
        q = q.filter(LocationInfo.MapId == map_id)
    elif not is_admin(current_user) and current_user.BusinessId:
        biz_map_ids = get_business_map_ids(db, current_user.BusinessId)
        q = q.filter(LocationInfo.MapId.in_(biz_map_ids))
    places = q.order_by(LocationInfo.id.desc()).all()

    floor_ids = {p.FloorId for p in places if p.FloorId}
    floor_map = {}
    if floor_ids:
        rows = db.query(FloorInfo).filter(FloorInfo.id.in_(floor_ids)).all()
        floor_map = {f.id: f.FloorName for f in rows}

    return [
        {
            "id": p.id,
            "UserId": p.UserId,
            "RobotName": p.RobotName,
            "LacationName": p.LacationName,
            "FloorId": p.FloorId,
            "Floor": floor_map.get(p.FloorId, ""),
            "LocationX": p.LocationX,
            "LocationY": p.LocationY,
            "Yaw": p.Yaw,
            "MapId": p.MapId,
            "Category": p.Category,
            "Imformation": p.Imformation,
        }
        for p in places
    ]


@database.put("/places/{place_id}")
def update_place(place_id: int, req: RobotPlaceInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit"))):
    place = db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    if _place_name_conflict(db, req.MapId, req.LacationName, req.Category, exclude_id=place_id):
        raise HTTPException(status_code=409, detail="같은 맵에 동일한 장소명이 이미 존재합니다.")

    changes = []
    field_map = {
        "로봇": ("RobotName", req.RobotName),
        "장소명": ("LacationName", req.LacationName),
        "층ID": ("FloorId", req.FloorId),
        "X좌표": ("LocationX", req.LocationX),
        "Y좌표": ("LocationY", req.LocationY),
        "방향": ("Yaw", req.Yaw),
        "맵ID": ("MapId", req.MapId),
        "카테고리": ("Category", req.Category),
        "정보": ("Imformation", req.Imformation),
    }

    for label, (attr, new_val) in field_map.items():
        old_val = getattr(place, attr)
        if old_val != new_val:
            if attr == "FloorId":
                old_name = get_floor_name(db, old_val)
                new_name = get_floor_name(db, new_val)
                changes.append(f"층: {old_name} → {new_name}")
            else:
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
