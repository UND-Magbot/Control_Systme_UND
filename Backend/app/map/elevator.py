"""엘리베이터 / 층 정차·POI 매핑 CRUD (E1).

맵관리 '엘리베이터' 탭이 사용한다. 엘리베이터별 서비스 층과 각 층의 좌표 3종
(로비진입/패널정위치/내부정지 = 기존 LocationInfo 참조)을 등록한다.

권한: 조회는 로그인, 변경은 map-edit(맵 편집과 동일 도메인).
런타임 조작 상태(op/state)는 navigation/elevator_op.py 소관(별도 라우터, 같은 /elevator prefix).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.database.models import ElevatorInfo, ElevatorFloorStop, UserInfo
from app.auth.dependencies import get_current_user, require_permission
from app.auth.audit import write_audit, get_client_ip

router = APIRouter(prefix="/elevator", tags=["Elevator"])


def _stop_dict(s: ElevatorFloorStop) -> dict:
    complete = bool(s.MapId and s.LobbyLocationId and s.PanelLocationId and s.InsideLocationId)
    return {
        "floorId": s.FloorId,
        "mapId": s.MapId,
        "lobbyLocationId": s.LobbyLocationId,
        "panelLocationId": s.PanelLocationId,
        "insideLocationId": s.InsideLocationId,
        "complete": complete,   # 자율 전환 대상 여부(3종 POI + 맵 모두 지정)
    }


def _elevator_dict(e: ElevatorInfo) -> dict:
    stops = sorted(e.stops, key=lambda s: s.FloorId)
    return {
        "id": e.id,
        "businessId": e.BusinessId,
        "name": e.Name,
        "serviceFloorIds": [s.FloorId for s in stops],
        "stops": [_stop_dict(s) for s in stops],
    }


@router.get("")
def list_elevators(
    business_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
) -> list[dict]:
    rows = (
        db.query(ElevatorInfo)
        .filter(ElevatorInfo.BusinessId == business_id)
        .order_by(ElevatorInfo.id)
        .all()
    )
    return [_elevator_dict(e) for e in rows]


class ElevatorCreateReq(BaseModel):
    business_id: int
    name: str


@router.post("")
def create_elevator(
    req: ElevatorCreateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("map-edit")),
) -> dict:
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="이름을 입력하세요.")
    e = ElevatorInfo(BusinessId=req.business_id, Name=req.name.strip())
    db.add(e)
    db.commit()
    write_audit(db, current_user.id, "elevator_created", "elevator", e.id,
                detail=f"엘리베이터 생성: {e.Name} (사업장: {req.business_id})",
                ip_address=get_client_ip(request))
    return _elevator_dict(e)


class ElevatorUpdateReq(BaseModel):
    name: str


@router.put("/{elevator_id}")
def update_elevator(
    elevator_id: int,
    req: ElevatorUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("map-edit")),
) -> dict:
    e = db.query(ElevatorInfo).filter(ElevatorInfo.id == elevator_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="엘리베이터를 찾을 수 없습니다.")
    if req.name.strip():
        e.Name = req.name.strip()
    db.commit()
    write_audit(db, current_user.id, "elevator_updated", "elevator", e.id,
                ip_address=get_client_ip(request))
    return _elevator_dict(e)


@router.delete("/{elevator_id}")
def delete_elevator(
    elevator_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("map-edit")),
) -> dict:
    e = db.query(ElevatorInfo).filter(ElevatorInfo.id == elevator_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="엘리베이터를 찾을 수 없습니다.")
    name = e.Name
    db.delete(e)
    db.commit()
    write_audit(db, current_user.id, "elevator_deleted", "elevator", elevator_id,
                detail=f"엘리베이터 삭제: {name}", ip_address=get_client_ip(request))
    return {"status": "ok"}


class StopItem(BaseModel):
    floor_id: int
    map_id: Optional[int] = None
    lobby_location_id: Optional[int] = None
    panel_location_id: Optional[int] = None
    inside_location_id: Optional[int] = None


class StopsReplaceReq(BaseModel):
    stops: list[StopItem]


@router.put("/{elevator_id}/stops")
def replace_stops(
    elevator_id: int,
    req: StopsReplaceReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("map-edit")),
) -> dict:
    """엘리베이터의 층별 정차·POI 매핑을 통째로 교체한다(서비스 층 = 넘어온 stops의 층)."""
    e = db.query(ElevatorInfo).filter(ElevatorInfo.id == elevator_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="엘리베이터를 찾을 수 없습니다.")

    # 기존 정차 전부 삭제 후 재삽입(멱등)
    db.query(ElevatorFloorStop).filter(ElevatorFloorStop.ElevatorId == elevator_id).delete()
    seen = set()
    for it in req.stops:
        if it.floor_id in seen:
            continue  # 층 중복 방지
        seen.add(it.floor_id)
        db.add(ElevatorFloorStop(
            ElevatorId=elevator_id,
            FloorId=it.floor_id,
            MapId=it.map_id,
            LobbyLocationId=it.lobby_location_id,
            PanelLocationId=it.panel_location_id,
            InsideLocationId=it.inside_location_id,
        ))
    db.commit()
    write_audit(db, current_user.id, "elevator_stops_updated", "elevator", elevator_id,
                detail=f"정차·POI 매핑 갱신: {len(seen)}개 층", ip_address=get_client_ip(request))
    db.refresh(e)
    return _elevator_dict(e)
