from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database.database import get_db
from app.database.models import UserInfo
from app.alerts.schemas import AlertListResponse, UnreadCountResponse
from app.alerts.service import AlertService
from app.auth.dependencies import get_current_user, require_any_permission, is_admin

router = APIRouter(prefix="/DB", tags=["alerts"])


@router.get("/alerts", response_model=AlertListResponse)
def get_alerts(
    type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    is_read: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("alert-total", "alert-schedule", "alert-robot", "alert-notice")),
):
    business_id = None if is_admin(current_user) else current_user.BusinessId
    return AlertService(db).get_list(
        alert_type=type,
        status=status,
        is_read=is_read,
        search=search,
        UserId=current_user.id,
        page=page,
        size=size,
        business_id=business_id,
    )


@router.get("/alerts/{alert_id}")
def get_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("alert-total", "alert-schedule", "alert-robot", "alert-notice")),
):
    """페이지에 없는 알림도 직접 로드 가능 — 상세 패널 열기용."""
    item = AlertService(db).get_one(alert_id, UserId=current_user.id)
    if item is None:
        raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다")
    return item


@router.put("/alerts/{alert_id}/read")
def mark_alert_read(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("alert-total", "alert-schedule", "alert-robot", "alert-notice")),
):
    AlertService(db).mark_read(alert_id, current_user.id)
    return {"status": "ok"}


@router.put("/alerts/read-all")
def mark_all_alerts_read(
    type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("alert-total", "alert-schedule", "alert-robot", "alert-notice")),
):
    business_id = None if is_admin(current_user) else current_user.BusinessId
    AlertService(db).mark_all_read(current_user.id, alert_type=type, business_id=business_id)
    return {"status": "ok"}


@router.get("/alerts/unread-count", response_model=UnreadCountResponse)
def get_unread_count(
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
):
    business_id = None if is_admin(current_user) else current_user.BusinessId
    return AlertService(db).get_unread_count(current_user.id, business_id=business_id)
