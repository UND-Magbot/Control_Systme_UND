from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import os
import re

from app.Database.database import SessionLocal
from app.Database.models import BusinessInfo, AreaInfo, RobotMapInfo

map_manage = APIRouter(prefix="/map")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =========================
# 사업장 CRUD
# =========================
class BusinessReq(BaseModel):
    BusinessName: str
    Address: Optional[str] = None

@map_manage.get("/businesses")
def get_businesses(db: Session = Depends(get_db)):
    return db.query(BusinessInfo).order_by(BusinessInfo.id.asc()).all()

@map_manage.post("/businesses")
def create_business(req: BusinessReq, db: Session = Depends(get_db)):
    biz = BusinessInfo(BusinessName=req.BusinessName, Address=req.Address)
    db.add(biz)
    db.commit()
    db.refresh(biz)
    return biz

# =========================
# 영역(층) CRUD
# =========================
class AreaReq(BaseModel):
    BusinessId: int
    FloorName: str

@map_manage.get("/areas")
def get_areas(business_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(AreaInfo)
    if business_id is not None:
        q = q.filter(AreaInfo.BusinessId == business_id)
    return q.order_by(AreaInfo.id.asc()).all()

@map_manage.post("/areas")
def create_area(req: AreaReq, db: Session = Depends(get_db)):
    area = AreaInfo(BusinessId=req.BusinessId, FloorName=req.FloorName)
    db.add(area)
    db.commit()
    db.refresh(area)
    return area

# =========================
# 로봇 맵 CRUD
# =========================
class MapSaveReq(BaseModel):
    BusinessId: int
    AreaId: int
    AreaName: str

@map_manage.get("/maps")
def get_maps(area_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(RobotMapInfo)
    if area_id is not None:
        q = q.filter(RobotMapInfo.AreaId == area_id)
    return q.order_by(RobotMapInfo.id.desc()).all()

@map_manage.post("/maps")
def save_map(req: MapSaveReq, db: Session = Depends(get_db)):
    # 파일 경로 생성 (매핑 완료 후 저장될 경로)
    pgm_path = f"./static/maps/{req.AreaName}.pgm"
    yaml_path = f"./static/maps/{req.AreaName}.yaml"

    robot_map = RobotMapInfo(
        BusinessId=req.BusinessId,
        AreaId=req.AreaId,
        AreaName=req.AreaName,
        PgmFilePath=pgm_path,
        YamlFilePath=yaml_path,
    )
    db.add(robot_map)
    db.commit()
    db.refresh(robot_map)
    return robot_map

@map_manage.get("/maps/{map_id}/meta")
def get_map_meta(map_id: int, db: Session = Depends(get_db)):
    """맵의 yaml 파싱해서 origin, resolution 반환"""
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")

    yaml_path = m.YamlFilePath
    if not yaml_path:
        raise HTTPException(status_code=404, detail="No yaml file")

    # ./static/maps/xxx.yaml → 실제 경로
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    full_path = os.path.join(base_dir, yaml_path.replace("./", ""))

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"Yaml file not found: {full_path}")

    with open(full_path, "r") as f:
        content = f.read()

    # 간단 파싱 (pyyaml 없이)
    resolution = 0.1
    origin_x, origin_y = 0.0, 0.0

    res_match = re.search(r"resolution:\s*([\d.]+)", content)
    if res_match:
        resolution = float(res_match.group(1))

    origin_match = re.search(r"origin:\s*\[([-\d.]+),\s*([-\d.]+)", content)
    if origin_match:
        origin_x = float(origin_match.group(1))
        origin_y = float(origin_match.group(2))

    return {
        "resolution": resolution,
        "originX": origin_x,
        "originY": origin_y,
    }

@map_manage.delete("/maps/{map_id}")
def delete_map(map_id: int, db: Session = Depends(get_db)):
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    db.delete(m)
    db.commit()
    return {"status": "deleted"}
