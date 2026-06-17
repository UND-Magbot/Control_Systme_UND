"""외부(로봇 NOS 등)에서 발화하는 알람 endpoint.

frontend가 부르는 /DB/alerts/* 와 달리 인증 없이 받는다.
사내 네트워크 신뢰 가정. 외부 노출 시에는 API 키 또는 IP 화이트리스트 필요.
"""

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.database.database import SessionLocal
from app.database.models import RobotInfo
from app.logs.service import log_event

router = APIRouter(prefix="/alerts/external", tags=["alerts-external"])


class ThermalEventIn(BaseModel):
    temperature: float = Field(..., description="측정 온도(°C)")
    robot_name: Optional[str] = Field(None, description="로봇 RobotName")
    detected_at: Optional[str] = Field(None, description="감지 시각 ISO8601")


@router.post("/thermal-event")
def thermal_event(payload: ThermalEventIn):
    """열화상에서 임계 이상 고온 객체 감지 시 로봇이 호출.

    log_event를 통해 LogDataInfo + Alert(자동 생성, Type=Robot/Status=event)이
    함께 기록되어 frontend AlertContext 폴링에 잡힌다.
    """
    detail_parts = [f"온도 {payload.temperature:.1f}°C 측정"]
    if payload.detected_at:
        detail_parts.append(f"감지 시각 {payload.detected_at}")
    detail = " · ".join(detail_parts)

    # robot_name → robot_id / business_id 보강 (Alert 표시·필터링에 활용)
    robot_id = None
    business_id = None
    if payload.robot_name:
        db = SessionLocal()
        try:
            robot = (
                db.query(RobotInfo)
                .filter(RobotInfo.RobotName == payload.robot_name)
                .first()
            )
            if robot:
                robot_id = robot.id
                business_id = robot.BusinessId
        finally:
            db.close()

    log_event(
        category="robot",
        action="thermal_temp_high",
        message="고온 감지",
        detail=detail,
        robot_id=robot_id,
        robot_name=payload.robot_name,
        business_id=business_id,
    )
    return {"ok": True}
