from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database.models import LocationInfo, UserInfo, FloorInfo
from app.auth.dependencies import require_any_permission, get_current_user, is_admin, get_business_map_ids
from app.auth.audit import write_audit, get_client_ip

from app.database.routes import database, get_db
from app.database.routes._helpers import get_floor_name


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
    # 위험구역(Category="danger") 폴리곤 꼭짓점 [[x,y], ...] (월드 좌표). 일반 장소는 None.
    Polygon: list[list[float]] | None = None


def _assert_unique_place_name(db: Session, name: str, category: str | None,
                              current_user: UserInfo, exclude_id: int | None = None) -> None:
    """경로(WayInfo.WayPoints)가 장소를 '이름'으로 참조·조회(.first())하므로,
    waypoint 계열 장소명은 사업장 내에서 유일해야 한다. 중복이면 경로가 항상 첫 번째
    장소로만 해석돼 다층 경로·전환 등이 깨진다.
    위험구역(Category='danger')은 폴리곤이며 경로 waypoint로 참조되지 않으므로 검사 제외."""
    if (category or "waypoint") == "danger":
        return
    name = (name or "").strip()
    if not name:
        return
    q = db.query(LocationInfo.id).filter(
        LocationInfo.LacationName == name,
        (LocationInfo.Category != "danger") | (LocationInfo.Category.is_(None)),
    )
    if exclude_id is not None:
        q = q.filter(LocationInfo.id != exclude_id)
    # 사업장 스코프(경로가 참조하는 범위와 동일). 관리자/무사업장은 전역 검사.
    if not is_admin(current_user) and current_user.BusinessId:
        biz_map_ids = get_business_map_ids(db, current_user.BusinessId)
        q = q.filter(LocationInfo.MapId.in_(biz_map_ids))
    if q.first():
        raise HTTPException(
            status_code=409,
            detail=f"이미 '{name}' 이름의 장소가 있습니다. 경로가 이름으로 장소를 찾으므로 층이 달라도 이름은 다르게 지정하세요.",
        )


@database.post("/places")
def insert_robot_place(
    req: RobotPlaceInsertReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit")),
):
    _assert_unique_place_name(db, req.LacationName, req.Category, current_user)

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
        Polygon=req.Polygon,
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
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),  # 맵 뷰는 어느 탭에서든 표시 가능
):
    q = db.query(LocationInfo)
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
            "Polygon": p.Polygon,
        }
        for p in places
    ]


@database.put("/places/{place_id}")
def update_place(place_id: int, req: RobotPlaceInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit"))):
    place = db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    # 이름 변경 시 사업장 내 중복 차단(경로가 이름으로 참조하므로). 자기 자신 제외.
    _assert_unique_place_name(db, req.LacationName, req.Category, current_user, exclude_id=place_id)

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
        "폴리곤": ("Polygon", req.Polygon),
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
