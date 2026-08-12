"""자동문 CRUD + 시설 장치 합본 조회 (E5 D1).

맵관리 '시설 장치' 탭의 자동문 유형이 사용한다. 엘리베이터(map/elevator.py)와
같은 권한·감사 규약을 쓰되, 층 이동이 없어 모델은 층 1개 × POI 2종으로 끝난다.

권한: 조회는 로그인, 변경은 map-edit(엘리베이터와 동일 — 자동문 전용 메뉴 권한 없음).
통과 런타임 상태(op/state)는 navigation/door_op.py 소관.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.database.models import DoorInfo, ElevatorInfo, UserInfo
from app.auth.dependencies import get_current_user, require_permission
from app.auth.audit import write_audit, get_client_ip

router = APIRouter(prefix="/door", tags=["Door"])
facility_router = APIRouter(prefix="/facility", tags=["Door"])

CONTROL_TYPES = {"auto_sensor", "gpio", "ble", "rm_vision", "manual"}
DETECT_TYPES = {"none", "vision"}


def door_complete(d: DoorInfo) -> bool:
    """자율 통과 대상 여부. 엘리베이터 정차의 complete(_stop_dict)와 같은 의미를 갖는다."""
    return bool(d.MapId and d.NearLocationId and d.FarLocationId and d.ControlType)


def _door_dict(d: DoorInfo) -> dict:
    return {
        "id": d.id,
        "businessId": d.BusinessId,
        "name": d.Name,
        "floorId": d.FloorId,
        "mapId": d.MapId,
        "nearLocationId": d.NearLocationId,
        "farLocationId": d.FarLocationId,
        "controlType": d.ControlType,
        "controlConfig": d.ControlConfig or {},
        "detectType": d.DetectType or "none",
        "openTimeoutSec": d.OpenTimeoutSec if d.OpenTimeoutSec is not None else 20,
        "passTimeoutSec": d.PassTimeoutSec if d.PassTimeoutSec is not None else 30,
        "complete": door_complete(d),
    }


@router.get("")
def list_doors(
    business_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
) -> list[dict]:
    rows = (
        db.query(DoorInfo)
        .filter(DoorInfo.BusinessId == business_id)
        .order_by(DoorInfo.id)
        .all()
    )
    return [_door_dict(d) for d in rows]


class DoorCreateReq(BaseModel):
    business_id: int
    name: str


@router.post("")
def create_door(
    req: DoorCreateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("map-edit")),
) -> dict:
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="이름을 입력하세요.")
    d = DoorInfo(BusinessId=req.business_id, Name=req.name.strip(),
                 DetectType="none", OpenTimeoutSec=20, PassTimeoutSec=30)
    db.add(d)
    db.commit()
    write_audit(db, current_user.id, "door_created", "door", d.id,
                detail=f"자동문 생성: {d.Name} (사업장: {req.business_id})",
                ip_address=get_client_ip(request))
    return _door_dict(d)


class DoorUpdateReq(BaseModel):
    """부분 갱신. 미지정(None) 필드는 건드리지 않고, 지운 값은 명시적으로 null 로 보낸다."""
    name: Optional[str] = None
    floor_id: Optional[int] = None
    map_id: Optional[int] = None
    near_location_id: Optional[int] = None
    far_location_id: Optional[int] = None
    control_type: Optional[str] = None
    control_config: Optional[dict] = None
    detect_type: Optional[str] = None
    open_timeout_sec: Optional[int] = None
    pass_timeout_sec: Optional[int] = None


@router.put("/{door_id}")
def update_door(
    door_id: int,
    req: DoorUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("map-edit")),
) -> dict:
    d = db.query(DoorInfo).filter(DoorInfo.id == door_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="자동문을 찾을 수 없습니다.")

    fields = req.model_dump(exclude_unset=True)

    if "control_type" in fields and fields["control_type"] not in (None, *CONTROL_TYPES):
        raise HTTPException(status_code=400, detail="지원하지 않는 개폐 방식입니다.")
    if "detect_type" in fields and fields["detect_type"] not in (None, *DETECT_TYPES):
        raise HTTPException(status_code=400, detail="지원하지 않는 열림 판독 방식입니다.")
    for key in ("open_timeout_sec", "pass_timeout_sec"):
        v = fields.get(key)
        if v is not None and not (1 <= v <= 600):
            raise HTTPException(status_code=400, detail="타임아웃은 1~600초 사이여야 합니다.")

    if "name" in fields:
        name = (fields["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="이름을 입력하세요.")
        d.Name = name
    if "floor_id" in fields:
        # 층이 바뀌면 그 층의 맵/POI 는 무효 → 함께 비운다(엉뚱한 층 좌표로 통과 시도 방지)
        if fields["floor_id"] != d.FloorId:
            d.MapId = None
            d.NearLocationId = None
            d.FarLocationId = None
        d.FloorId = fields["floor_id"]
    if "map_id" in fields:
        if fields["map_id"] != d.MapId:
            d.NearLocationId = None
            d.FarLocationId = None
        d.MapId = fields["map_id"]
    if "near_location_id" in fields:
        d.NearLocationId = fields["near_location_id"]
    if "far_location_id" in fields:
        d.FarLocationId = fields["far_location_id"]
    if "control_type" in fields:
        d.ControlType = fields["control_type"]
    if "control_config" in fields:
        d.ControlConfig = fields["control_config"]
    if "detect_type" in fields:
        d.DetectType = fields["detect_type"] or "none"
    if "open_timeout_sec" in fields and fields["open_timeout_sec"] is not None:
        d.OpenTimeoutSec = fields["open_timeout_sec"]
    if "pass_timeout_sec" in fields and fields["pass_timeout_sec"] is not None:
        d.PassTimeoutSec = fields["pass_timeout_sec"]

    if d.NearLocationId and d.NearLocationId == d.FarLocationId:
        raise HTTPException(status_code=400, detail="안쪽·바깥쪽 통과 POI는 서로 달라야 합니다.")

    db.commit()
    write_audit(db, current_user.id, "door_updated", "door", d.id,
                detail=f"자동문 수정: {d.Name}", ip_address=get_client_ip(request))
    db.refresh(d)
    return _door_dict(d)


@router.delete("/{door_id}")
def delete_door(
    door_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("map-edit")),
) -> dict:
    d = db.query(DoorInfo).filter(DoorInfo.id == door_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="자동문을 찾을 수 없습니다.")
    name = d.Name
    db.delete(d)
    db.commit()
    write_audit(db, current_user.id, "door_deleted", "door", door_id,
                detail=f"자동문 삭제: {name}", ip_address=get_client_ip(request))
    return {"status": "ok"}


@facility_router.get("")
def list_facilities(
    business_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
) -> list[dict]:
    """시설 장치 합본(읽기 전용) — 층 스택 뱃지·대시보드가 유형 구분 없이 쓴다.

    설비 유형이 늘어도(스피드게이트 등) 소비자는 이 한 곳만 읽으면 된다.
    """
    items: list[dict] = []

    elevators = (
        db.query(ElevatorInfo)
        .filter(ElevatorInfo.BusinessId == business_id)
        .order_by(ElevatorInfo.id)
        .all()
    )
    for e in elevators:
        stops = sorted(e.stops, key=lambda s: s.FloorId)
        complete_floor_ids = [
            s.FloorId for s in stops
            if s.MapId and s.LobbyLocationId and s.PanelLocationId and s.InsideLocationId
        ]
        items.append({
            "kind": "elevator",
            "id": e.id,
            "name": e.Name,
            "floorIds": [s.FloorId for s in stops],
            "completeFloorIds": complete_floor_ids,
            "complete": bool(stops) and len(complete_floor_ids) == len(stops),
        })

    doors = (
        db.query(DoorInfo)
        .filter(DoorInfo.BusinessId == business_id)
        .order_by(DoorInfo.id)
        .all()
    )
    for d in doors:
        floor_ids = [d.FloorId] if d.FloorId is not None else []
        complete = door_complete(d)
        items.append({
            "kind": "door",
            "id": d.id,
            "name": d.Name,
            "floorIds": floor_ids,
            "completeFloorIds": floor_ids if complete else [],
            "complete": complete,
        })

    return items
