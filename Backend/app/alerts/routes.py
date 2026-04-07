from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.Database.database import SessionLocal
from app.Database.models import UserInfo
from app.alerts.schemas import AlertListResponse, UnreadCountResponse
from app.alerts.service import AlertService
from app.auth.dependencies import get_current_user, require_any_permission
from app.current_user import get_user_id

router = APIRouter(prefix="/DB", tags=["alerts"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _resolve_user(UserId: int = None) -> int:
    return UserId or get_user_id() or 0


@router.get("/alerts", response_model=AlertListResponse)
def get_alerts(
    type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    is_read: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    UserId: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("alert-total", "alert-schedule", "alert-robot", "alert-notice")),
):
    return AlertService(db).get_list(
        alert_type=type,
        status=status,
        is_read=is_read,
        search=search,
        UserId=_resolve_user(UserId),
        page=page,
        size=size,
    )


@router.put("/alerts/{alert_id}/read")
def mark_alert_read(
    alert_id: int,
    UserId: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("alert-total", "alert-schedule", "alert-robot", "alert-notice")),
):
    AlertService(db).mark_read(alert_id, _resolve_user(UserId))
    return {"status": "ok"}


@router.put("/alerts/read-all")
def mark_all_alerts_read(
    UserId: Optional[int] = Query(None),
    type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("alert-total", "alert-schedule", "alert-robot", "alert-notice")),
):
    AlertService(db).mark_all_read(_resolve_user(UserId), alert_type=type)
    return {"status": "ok"}


@router.get("/alerts/unread-count", response_model=UnreadCountResponse)
def get_unread_count(
    UserId: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
):
    return AlertService(db).get_unread_count(_resolve_user(UserId))
