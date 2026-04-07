import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.auth.dependencies import get_db, require_permission
from app.Database.models import UserInfo
from app.statistics.schemas import StatisticsResponse
from app.statistics.service import StatisticsService

router = APIRouter(prefix="/DB", tags=["statistics"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_VALID_ROBOT_TYPES = {"QUADRUPED", "COBOT", "AMR", "HUMANOID"}


@router.get("/statistics", response_model=StatisticsResponse)
def get_statistics(
    start_date: Optional[str] = Query(None, description="시작일 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="종료일 (YYYY-MM-DD)"),
    robot_type: Optional[str] = Query(None, description="로봇 타입 (QUADRUPED/COBOT/AMR/HUMANOID)"),
    robot_name: Optional[str] = Query(None, description="로봇 이름"),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("statistics")),
):
    # ── 입력 검증 ──
    if start_date and not _DATE_RE.match(start_date):
        raise HTTPException(422, "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)")
    if end_date and not _DATE_RE.match(end_date):
        raise HTTPException(422, "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, "시작일이 종료일보다 늦습니다")
    if robot_type and robot_type not in _VALID_ROBOT_TYPES:
        raise HTTPException(422, f"유효하지 않은 로봇 타입: {robot_type}")

    return StatisticsService(db).get_all(
        start_date=start_date,
        end_date=end_date,
        robot_type=robot_type,
        robot_name=robot_name,
    )
