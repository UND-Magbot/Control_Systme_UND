from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from app.Database.database import SessionLocal
from app.businesses.schemas import (
    BusinessCreateReq, BusinessUpdateReq, BusinessResponse, BusinessListResponse,
    AreaCreateReq, AreaResponse,
)
from app.businesses.service import BusinessService, AreaService

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
):
    return BusinessService(db).get_list(search=search, page=page, size=size)


@router.get("/businesses/{biz_id}", response_model=BusinessResponse)
def get_business(biz_id: int, db: Session = Depends(get_db)):
    return BusinessService(db).get_one(biz_id)


@router.post("/businesses")
def create_business(req: BusinessCreateReq, db: Session = Depends(get_db)):
    biz = BusinessService(db).create(
        name=req.BusinessName, zip_code=req.ZipCode, address=req.Address,
        address_detail=req.AddressDetail, represent_name=req.RepresentName,
        contact=req.Contact, description=req.Description,
    )
    return {"status": "created", "id": biz.id}


@router.put("/businesses/{biz_id}")
def update_business(biz_id: int, req: BusinessUpdateReq, db: Session = Depends(get_db)):
    BusinessService(db).update(
        biz_id, name=req.BusinessName, zip_code=req.ZipCode, address=req.Address,
        address_detail=req.AddressDetail, represent_name=req.RepresentName,
        contact=req.Contact, description=req.Description,
    )
    return {"status": "updated"}


@router.delete("/businesses/{biz_id}")
def delete_business(biz_id: int, db: Session = Depends(get_db)):
    BusinessService(db).delete(biz_id)
    return {"status": "deleted"}


# ─── 영역(층) CRUD ───

@router.get("/businesses/{biz_id}/areas", response_model=List[AreaResponse])
def get_areas(biz_id: int, db: Session = Depends(get_db)):
    return AreaService(db).get_list(business_id=biz_id)


@router.post("/businesses/{biz_id}/areas")
def create_area(biz_id: int, req: AreaCreateReq, db: Session = Depends(get_db)):
    area = AreaService(db).create(business_id=biz_id, floor_name=req.FloorName)
    return {"status": "created", "id": area.id}


@router.delete("/areas/{area_id}")
def delete_area(area_id: int, db: Session = Depends(get_db)):
    AreaService(db).delete(area_id)
    return {"status": "deleted"}
