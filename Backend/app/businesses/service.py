from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from fastapi import HTTPException

from app.Database.models import BusinessInfo, FloorInfo, RobotInfo, RobotMapInfo


class BusinessService:
    def __init__(self, db: Session):
        self.db = db

    # ─── 목록 조회 (페이지네이션 + 검색) ───

    def get_list(self, search: str = None, page: int = 1, size: int = 20):
        query = self.db.query(BusinessInfo).order_by(BusinessInfo.id.asc())

        if search:
            keyword = f"%{search}%"
            query = query.filter(
                BusinessInfo.BusinessName.like(keyword)
                | BusinessInfo.Address.like(keyword)
            )

        total = query.count()
        rows = query.offset((page - 1) * size).limit(size).all()

        floor_counts = dict(
            self.db.query(RobotMapInfo.BusinessId, sql_func.count(RobotMapInfo.id))
            .group_by(RobotMapInfo.BusinessId)
            .all()
        )
        robot_counts = dict(
            self.db.query(RobotInfo.BusinessId, sql_func.count(RobotInfo.id))
            .filter(RobotInfo.BusinessId.isnot(None))
            .group_by(RobotInfo.BusinessId)
            .all()
        )

        items = [
            {
                "id": b.id,
                "BusinessName": b.BusinessName,
                "ZipCode": b.ZipCode,
                "Address": b.Address,
                "AddressDetail": b.AddressDetail,
                "RepresentName": b.RepresentName,
                "Contact": b.Contact,
                "Description": b.Description,
                "CreatedAt": b.CreatedAt,
                "UpdatedAt": b.UpdatedAt,
                "FloorCount": floor_counts.get(b.id, 0),
                "RobotCount": robot_counts.get(b.id, 0),
            }
            for b in rows
        ]

        return {"items": items, "total": total, "page": page, "size": size}

    # ─── 단건 조회 ───

    def get_one(self, biz_id: int):
        biz = self.db.query(BusinessInfo).filter(BusinessInfo.id == biz_id).first()
        if not biz:
            raise HTTPException(status_code=404, detail="사업자를 찾을 수 없습니다")

        floor_count = (
            self.db.query(sql_func.count(RobotMapInfo.id))
            .filter(RobotMapInfo.BusinessId == biz_id)
            .scalar()
        )
        robot_count = (
            self.db.query(sql_func.count(RobotInfo.id))
            .filter(RobotInfo.BusinessId == biz_id)
            .scalar()
        )

        return {
            "id": biz.id,
            "BusinessName": biz.BusinessName,
            "ZipCode": biz.ZipCode,
            "Address": biz.Address,
            "AddressDetail": biz.AddressDetail,
            "RepresentName": biz.RepresentName,
            "Contact": biz.Contact,
            "Description": biz.Description,
            "CreatedAt": biz.CreatedAt,
            "UpdatedAt": biz.UpdatedAt,
            "FloorCount": floor_count,
            "RobotCount": robot_count,
        }

    # ─── 등록 ───

    def create(self, name: str, zip_code: str = None, address: str = None,
               address_detail: str = None, represent_name: str = None,
               contact: str = None, description: str = None):
        if not name or not name.strip():
            raise HTTPException(status_code=400, detail="사업자명을 입력해주세요")
        name = name.strip()

        if len(name) > 100:
            raise HTTPException(status_code=400, detail="사업자명은 100자 이내로 입력해주세요")
        if address and len(address) > 200:
            raise HTTPException(status_code=400, detail="주소는 200자 이내로 입력해주세요")

        # 중복 검증
        exists = (
            self.db.query(BusinessInfo)
            .filter(BusinessInfo.BusinessName == name)
            .first()
        )
        if exists:
            raise HTTPException(status_code=409, detail="이미 등록된 사업자명입니다")

        biz = BusinessInfo(
            BusinessName=name, ZipCode=zip_code, Address=address,
            AddressDetail=address_detail, RepresentName=represent_name,
            Contact=contact, Description=description,
        )
        self.db.add(biz)
        self.db.commit()
        self.db.refresh(biz)
        return biz

    # ─── 수정 ───

    def update(self, biz_id: int, name: str = None, zip_code: str = None,
               address: str = None, address_detail: str = None,
               represent_name: str = None, contact: str = None, description: str = None):
        biz = self.db.query(BusinessInfo).filter(BusinessInfo.id == biz_id).first()
        if not biz:
            raise HTTPException(status_code=404, detail="사업자를 찾을 수 없습니다")

        changes = []
        field_map = {
            "사업자명": ("BusinessName", name),
            "우편번호": ("ZipCode", zip_code),
            "주소": ("Address", address),
            "상세주소": ("AddressDetail", address_detail),
            "대표자명": ("RepresentName", represent_name),
            "연락처": ("Contact", contact),
            "비고": ("Description", description),
        }

        for label, (attr, new_val) in field_map.items():
            if new_val is None:
                continue
            if attr == "BusinessName":
                new_val = new_val.strip()
                if not new_val:
                    raise HTTPException(status_code=400, detail="사업자명을 입력해주세요")
                if len(new_val) > 100:
                    raise HTTPException(status_code=400, detail="사업자명은 100자 이내로 입력해주세요")
                exists = (
                    self.db.query(BusinessInfo)
                    .filter(BusinessInfo.BusinessName == new_val, BusinessInfo.id != biz_id)
                    .first()
                )
                if exists:
                    raise HTTPException(status_code=409, detail="이미 등록된 사업자명입니다")
            old_val = getattr(biz, attr)
            if old_val != new_val:
                changes.append(f"{label}: {old_val or ''} → {new_val or ''}")
                setattr(biz, attr, new_val)

        self.db.commit()
        self.db.refresh(biz)
        return biz, changes

    # ─── 삭제 ───

    def delete(self, biz_id: int):
        biz = self.db.query(BusinessInfo).filter(BusinessInfo.id == biz_id).first()
        if not biz:
            raise HTTPException(status_code=404, detail="사업자를 찾을 수 없습니다")

        # 1) 하위 층에 매핑된 맵 삭제
        floor_ids = [
            a.id for a in
            self.db.query(FloorInfo.id).filter(FloorInfo.BusinessId == biz_id).all()
        ]
        if floor_ids:
            self.db.query(RobotMapInfo).filter(RobotMapInfo.FloorId.in_(floor_ids)).delete(synchronize_session=False)

        # 2) 사업장에 직접 연결된 맵도 삭제
        self.db.query(RobotMapInfo).filter(RobotMapInfo.BusinessId == biz_id).delete(synchronize_session=False)

        # 3) 하위 층 삭제
        self.db.query(FloorInfo).filter(FloorInfo.BusinessId == biz_id).delete(synchronize_session=False)

        # 4) 연결된 로봇의 BusinessId를 NULL로 변경 (로봇 자체는 삭제하지 않음)
        self.db.query(RobotInfo).filter(RobotInfo.BusinessId == biz_id).update(
            {RobotInfo.BusinessId: None}, synchronize_session=False
        )

        # 5) 사업자 삭제
        self.db.delete(biz)
        self.db.commit()


class FloorService:
    def __init__(self, db: Session):
        self.db = db

    def get_list(self, business_id: int):
        return (
            self.db.query(FloorInfo)
            .filter(FloorInfo.BusinessId == business_id)
            .order_by(FloorInfo.id.asc())
            .all()
        )

    def create(self, business_id: int, floor_name: str):
        biz = self.db.query(BusinessInfo).filter(BusinessInfo.id == business_id).first()
        if not biz:
            raise HTTPException(status_code=404, detail="사업자를 찾을 수 없습니다")

        if not floor_name or not floor_name.strip():
            raise HTTPException(status_code=400, detail="층 이름을 입력해주세요")
        floor_name = floor_name.strip()

        if len(floor_name) > 50:
            raise HTTPException(status_code=400, detail="층 이름은 50자 이내로 입력해주세요")

        exists = (
            self.db.query(FloorInfo)
            .filter(FloorInfo.BusinessId == business_id, FloorInfo.FloorName == floor_name)
            .first()
        )
        if exists:
            raise HTTPException(status_code=409, detail="이미 등록된 층 이름입니다")

        floor = FloorInfo(BusinessId=business_id, FloorName=floor_name)
        self.db.add(floor)
        self.db.commit()
        self.db.refresh(floor)
        return floor

    def delete(self, floor_id: int):
        floor = self.db.query(FloorInfo).filter(FloorInfo.id == floor_id).first()
        if not floor:
            raise HTTPException(status_code=404, detail="층을 찾을 수 없습니다")

        self.db.query(RobotMapInfo).filter(RobotMapInfo.FloorId == floor_id).delete(synchronize_session=False)

        self.db.delete(floor)
        self.db.commit()
