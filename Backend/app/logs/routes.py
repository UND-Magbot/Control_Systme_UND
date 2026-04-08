from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.Database.database import SessionLocal
from app.Database.models import UserInfo
from app.logs.schemas import LogCreateReq, LogListResponse
from app.logs.service import LogService
from app.auth.dependencies import require_permission

router = APIRouter(prefix="/DB", tags=["logs"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/logs", response_model=LogListResponse)
def get_logs(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("log")),
):
    return LogService(db).get_list(
        category=category,
        search=search,
        start_date=start_date,
        end_date=end_date,
        page=page,
        size=size,
    )


@router.post("/logs")
def create_log(req: LogCreateReq, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("log"))):
    log = LogService(db).create(
        category=req.Category,
        action=req.Action,
        message=req.Message,
        detail=req.Detail,
        robot_id=req.RobotId,
        robot_name=req.RobotName,
    )
    return {"status": "ok", "id": log.id}
