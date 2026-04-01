from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from typing import Optional, List

from app.Database.database import SessionLocal
from app.Database.models import UserInfo
from app.businesses.schemas import (
    BusinessCreateReq, BusinessUpdateReq, BusinessResponse, BusinessListResponse,
    AreaCreateReq, AreaResponse,
)
from app.businesses.service import BusinessService, AreaService
from app.auth.dependencies import get_current_user
from app.auth.audit import write_audit, get_client_ip

router = APIRouter(prefix="/DB", tags=["businesses"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── 사업자 CRUD ───

@router.get("/businesses", response_model=BusinessListResponse)
def get_businesses(
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
):
    return BusinessService(db).get_list(search=search, page=page, size=size)


@router.get("/businesses/{biz_id}", response_model=BusinessResponse)
def get_business(biz_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    return BusinessService(db).get_one(biz_id)


@router.post("/businesses")
def create_business(req: BusinessCreateReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def update_business(biz_id: int, req: BusinessUpdateReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def delete_business(biz_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    svc = BusinessService(db)
    biz = svc.get_one(biz_id)
    biz_name = biz["BusinessName"]
    svc.delete(biz_id)
    write_audit(db, current_user.id, "business_deleted", "business", biz_id,
                detail=f"사업장명: {biz_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}


# ─── 영역(층) CRUD ───

@router.get("/businesses/{biz_id}/areas", response_model=List[AreaResponse])
def get_areas(biz_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    return AreaService(db).get_list(business_id=biz_id)


@router.post("/businesses/{biz_id}/areas")
def create_area(biz_id: int, req: AreaCreateReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    area = AreaService(db).create(business_id=biz_id, floor_name=req.FloorName)
    write_audit(db, current_user.id, "area_created", "area", area.id,
                detail=f"영역명: {req.FloorName}",
                ip_address=get_client_ip(request))
    return {"status": "created", "id": area.id}


@router.delete("/areas/{area_id}")
def delete_area(area_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    from app.Database.models import AreaInfo
    area = db.query(AreaInfo).filter(AreaInfo.id == area_id).first()
    area_name = area.FloorName if area else None
    AreaService(db).delete(area_id)
    write_audit(db, current_user.id, "area_deleted", "area", area_id,
                detail=f"영역명: {area_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}
