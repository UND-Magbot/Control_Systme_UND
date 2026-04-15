from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from typing import Optional, List

from app.database.database import get_db
from app.database.models import UserInfo
from app.businesses.schemas import (
    BusinessCreateReq, BusinessUpdateReq, BusinessResponse, BusinessListResponse,
    FloorCreateReq, FloorResponse,
)
from app.businesses.service import BusinessService, FloorService
from app.auth.dependencies import require_permission
from app.auth.audit import write_audit, get_client_ip

router = APIRouter(prefix="/DB", tags=["businesses"])


# ─── 사업자 CRUD ───

@router.get("/businesses", response_model=BusinessListResponse)
def get_businesses(
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("business-list")),
):
    return BusinessService(db).get_list(search=search, page=page, size=size)


@router.get("/businesses/{biz_id}", response_model=BusinessResponse)
def get_business(biz_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("business-list"))):
    return BusinessService(db).get_one(biz_id)


@router.post("/businesses")
def create_business(req: BusinessCreateReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("business-list"))):
    biz = BusinessService(db).create(
        name=req.BusinessName, zip_code=req.ZipCode, address=req.Address,
        address_detail=req.AddressDetail, represent_name=req.RepresentName,
        contact=req.Contact, description=req.Description,
    )
    write_audit(db, current_user.id, "business_created", "business", biz.id,
                detail=f"사업장명: {req.BusinessName}",
                ip_address=get_client_ip(request))
    return {"status": "created", "id": biz.id}


@router.put("/businesses/{biz_id}")
def update_business(biz_id: int, req: BusinessUpdateReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("business-list"))):
    _, changes = BusinessService(db).update(
        biz_id, name=req.BusinessName, zip_code=req.ZipCode, address=req.Address,
        address_detail=req.AddressDetail, represent_name=req.RepresentName,
        contact=req.Contact, description=req.Description,
    )
    detail = ", ".join(changes) if changes else None
    write_audit(db, current_user.id, "business_updated", "business", biz_id, detail=detail,
                ip_address=get_client_ip(request))
    return {"status": "updated"}


@router.delete("/businesses/{biz_id}")
def delete_business(biz_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("business-list"))):
    svc = BusinessService(db)
    biz = svc.get_one(biz_id)
    biz_name = biz["BusinessName"]
    svc.delete(biz_id)
    write_audit(db, current_user.id, "business_deleted", "business", biz_id,
                detail=f"사업장명: {biz_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}


# ─── 층 CRUD ───

@router.get("/businesses/{biz_id}/floors", response_model=List[FloorResponse])
def get_floors(biz_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("business-list"))):
    return FloorService(db).get_list(business_id=biz_id)


@router.post("/businesses/{biz_id}/floors")
def create_floor(biz_id: int, req: FloorCreateReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("business-list"))):
    floor = FloorService(db).create(business_id=biz_id, floor_name=req.FloorName)
    write_audit(db, current_user.id, "floor_created", "floor", floor.id,
                detail=f"층명: {req.FloorName}",
                ip_address=get_client_ip(request))
    return {"status": "created", "id": floor.id}


@router.delete("/floors/{floor_id}")
def delete_floor(floor_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("business-list"))):
    from app.database.models import FloorInfo
    floor = db.query(FloorInfo).filter(FloorInfo.id == floor_id).first()
    floor_name = floor.FloorName if floor else None
    FloorService(db).delete(floor_id)
    write_audit(db, current_user.id, "floor_deleted", "floor", floor_id,
                detail=f"층명: {floor_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}
