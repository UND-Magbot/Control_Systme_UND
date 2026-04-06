from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from pydantic import BaseModel
from typing import Optional
import os
import re

from app.Database.database import SessionLocal
from app.Database.models import BusinessInfo, AreaInfo, RobotMapInfo, UserInfo, LocationInfo, RouteInfo, WayInfo
from app.auth.dependencies import get_current_user
from app.auth.audit import write_audit, get_client_ip

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
def get_businesses(db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    rows = db.query(BusinessInfo).order_by(BusinessInfo.id.asc()).all()
    # 영역 수 / 로봇 수를 한 번에 조회
    area_counts = dict(
        db.query(AreaInfo.BusinessId, sql_func.count(AreaInfo.id))
        .group_by(AreaInfo.BusinessId)
        .all()
    )
    return [
        {
            "id": b.id,
            "BusinessName": b.BusinessName,
            "Address": b.Address,
            "CreatedAt": b.CreatedAt,
            "AreaCount": area_counts.get(b.id, 0),
        }
        for b in rows
    ]

@map_manage.post("/businesses")
def create_business(req: BusinessReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    biz = BusinessInfo(BusinessName=req.BusinessName, Address=req.Address)
    db.add(biz)
    db.commit()
    db.refresh(biz)
    write_audit(db, current_user.id, "business_created", "business", biz.id,
                detail=f"사업장명: {req.BusinessName}",
                ip_address=get_client_ip(request))
    return biz

@map_manage.put("/businesses/{biz_id}")
def update_business(biz_id: int, req: BusinessReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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

@map_manage.delete("/businesses/{biz_id}")
def delete_business(biz_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    biz = db.query(BusinessInfo).filter(BusinessInfo.id == biz_id).first()
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    biz_name = biz.BusinessName
    # 하위 영역도 함께 삭제
    db.query(AreaInfo).filter(AreaInfo.BusinessId == biz_id).delete()
    db.delete(biz)
    db.commit()
    write_audit(db, current_user.id, "business_deleted", "business", biz_id,
                detail=f"사업장명: {biz_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}

# =========================
# 영역(층) CRUD
# =========================
class AreaReq(BaseModel):
    BusinessId: int
    FloorName: str

@map_manage.get("/areas")
def get_areas(business_id: Optional[int] = None, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    q = db.query(AreaInfo)
    if business_id is not None:
        q = q.filter(AreaInfo.BusinessId == business_id)
    return q.order_by(AreaInfo.id.asc()).all()

@map_manage.post("/areas")
def create_area(req: AreaReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    area = AreaInfo(BusinessId=req.BusinessId, FloorName=req.FloorName)
    db.add(area)
    db.commit()
    db.refresh(area)
    write_audit(db, current_user.id, "area_created", "area", area.id,
                detail=f"영역명: {req.FloorName}",
                ip_address=get_client_ip(request))
    return area

@map_manage.delete("/areas/{area_id}")
def delete_area(area_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    area = db.query(AreaInfo).filter(AreaInfo.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    area_name = area.FloorName
    db.delete(area)
    db.commit()
    write_audit(db, current_user.id, "area_deleted", "area", area_id,
                detail=f"영역명: {area_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}

# =========================
# 로봇 맵 CRUD
# =========================
class MapSaveReq(BaseModel):
    BusinessId: int
    AreaId: int
    AreaName: str

@map_manage.get("/maps")
def get_maps(area_id: Optional[int] = None, business_id: Optional[int] = None, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    q = db.query(RobotMapInfo)
    if area_id is not None:
        q = q.filter(RobotMapInfo.AreaId == area_id)
    if business_id is not None:
        q = q.filter(RobotMapInfo.BusinessId == business_id)
    return q.order_by(RobotMapInfo.id.desc()).all()

@map_manage.post("/maps")
def save_map(req: MapSaveReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
    write_audit(db, current_user.id, "map_created", "map", robot_map.id,
                detail=f"맵명: {req.AreaName}",
                ip_address=get_client_ip(request))
    return robot_map

@map_manage.get("/maps/{map_id}/meta")
def get_map_meta(map_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
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
def delete_map(map_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    map_name = m.AreaName

    # 해당 맵의 장소명 수집 (경로 정리용)
    places = db.query(LocationInfo).filter(LocationInfo.MapId == map_id).all()
    place_names = {p.LacationName for p in places}

    # 장소명이 포함된 경로(WayInfo) 삭제
    if place_names:
        all_ways = db.query(WayInfo).all()
        for way in all_ways:
            wp_names = {n.strip() for n in (way.WayPoints or "").split(" - ")}
            if wp_names & place_names:
                db.delete(way)

    # 해당 맵의 구간 삭제
    db.query(RouteInfo).filter(RouteInfo.MapId == map_id).delete()

    # 해당 맵의 장소 삭제
    db.query(LocationInfo).filter(LocationInfo.MapId == map_id).delete()

    # 맵 파일 삭제 (pgm, yaml, png)
    for path in [m.PgmFilePath, m.YamlFilePath, m.ImgFilePath]:
        if path:
            try:
                full = os.path.join(".", path) if not os.path.isabs(path) else path
                if os.path.exists(full):
                    os.remove(full)
            except Exception as e:
                print(f"[WARN] 맵 파일 삭제 실패: {path} — {e}")
    db.delete(m)
    db.commit()
    write_audit(db, current_user.id, "map_deleted", "map", map_id,
                detail=f"맵명: {map_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}
