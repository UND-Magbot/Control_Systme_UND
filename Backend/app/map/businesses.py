from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from pydantic import BaseModel
from typing import Optional

from app.database.database import get_db
from app.database.models import BusinessInfo, FloorInfo, UserInfo
from app.auth.dependencies import require_permission, get_current_user, is_admin
from app.auth.audit import write_audit, get_client_ip

router = APIRouter()


class BusinessReq(BaseModel):
    BusinessName: str
    Address: Optional[str] = None


@router.get("/businesses")
def get_businesses(
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),  # 맵 뷰는 어느 탭에서든 표시 가능
):
    q = db.query(BusinessInfo)
    if not is_admin(current_user) and current_user.BusinessId:
        q = q.filter(BusinessInfo.id == current_user.BusinessId)
    rows = q.order_by(BusinessInfo.id.asc()).all()
    floor_counts = dict(
        db.query(FloorInfo.BusinessId, sql_func.count(FloorInfo.id))
        .group_by(FloorInfo.BusinessId)
        .all()
    )
    return [
        {
            "id": b.id,
            "BusinessName": b.BusinessName,
            "Address": b.Address,
            "CreatedAt": b.CreatedAt,
            "FloorCount": floor_counts.get(b.id, 0),
        }
        for b in rows
    ]


@router.post("/businesses")
def create_business(req: BusinessReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    biz = BusinessInfo(BusinessName=req.BusinessName, Address=req.Address)
    db.add(biz)
    db.commit()
    db.refresh(biz)
    write_audit(db, current_user.id, "business_created", "business", biz.id,
                detail=f"사업장명: {req.BusinessName}",
                ip_address=get_client_ip(request))
    return biz


@router.put("/businesses/{biz_id}")
def update_business(biz_id: int, req: BusinessReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    biz = db.query(BusinessInfo).filter(BusinessInfo.id == biz_id).first()
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")

    changes = []
    if req.BusinessName != biz.BusinessName:
        changes.append(f"사업장명: {biz.BusinessName} → {req.BusinessName}")
        biz.BusinessName = req.BusinessName
    if req.Address is not None and req.Address != biz.Address:
        changes.append(f"주소: {biz.Address or ''} → {req.Address}")
        biz.Address = req.Address

    db.commit()
    db.refresh(biz)
    detail = ", ".join(changes) if changes else None
    write_audit(db, current_user.id, "business_updated", "business", biz_id, detail=detail,
                ip_address=get_client_ip(request))
    return biz


@router.delete("/businesses/{biz_id}")
def delete_business(biz_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    biz = db.query(BusinessInfo).filter(BusinessInfo.id == biz_id).first()
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    biz_name = biz.BusinessName
    db.query(FloorInfo).filter(FloorInfo.BusinessId == biz_id).delete()
    db.delete(biz)
    db.commit()
    write_audit(db, current_user.id, "business_deleted", "business", biz_id,
                detail=f"사업장명: {biz_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}
