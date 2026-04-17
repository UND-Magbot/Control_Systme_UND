from sqlalchemy.orm import Session


def get_floor_name(db: Session, floor_id: int | None) -> str:
    """FloorId로 FloorName 조회"""
    if not floor_id:
        return ""
    from app.database.models import FloorInfo
    fi = db.query(FloorInfo).filter(FloorInfo.id == floor_id).first()
    return fi.FloorName if fi else ""
