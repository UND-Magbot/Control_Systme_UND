from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database.database import get_db
from app.database.models import FloorInfo, UserInfo
from app.auth.dependencies import require_permission
from app.auth.audit import write_audit, get_client_ip

router = APIRouter()


class FloorReq(BaseModel):
    BusinessId: int
    FloorName: str


@router.get("/floors")
def get_floors(business_id: Optional[int] = None, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    q = db.query(FloorInfo)
    if business_id is not None:
        q = q.filter(FloorInfo.BusinessId == business_id)
    return q.order_by(FloorInfo.id.asc()).all()


@router.post("/floors")
def create_floor(req: FloorReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    floor = FloorInfo(BusinessId=req.BusinessId, FloorName=req.FloorName)
    db.add(floor)
    db.commit()
    db.refresh(floor)
    write_audit(db, current_user.id, "floor_created", "floor", floor.id,
                detail=f"층명: {req.FloorName}",
                ip_address=get_client_ip(request))
    return floor


@router.delete("/floors/{floor_id}")
def delete_floor(floor_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    floor = db.query(FloorInfo).filter(FloorInfo.id == floor_id).first()
    if not floor:
        raise HTTPException(status_code=404, detail="Floor not found")
    floor_name = floor.FloorName
    db.delete(floor)
    db.commit()
    write_audit(db, current_user.id, "floor_deleted", "floor", floor_id,
                detail=f"층명: {floor_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}
