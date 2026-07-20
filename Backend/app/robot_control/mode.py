"""자세·보행·조명 등 로봇 모드 조작 — 로봇별로 대상을 지정해 명령을 보낸다.

pad.py 와 같은 규약이다: `/robot/{robot_id}/sit` 이 정식이고, `/robot/sit` 은
단일 로봇 시절 레거시 경로로 캐시된 로봇에 폴백한다.
"""
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.database.models import UserInfo
from app.robot_control.control_deps import require_control, resolve_target_robot_id
from app.robot_io.sender import send_posture_to_robot, send_to_robot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/robot")


class PostureRequest(BaseModel):
    """자세 6축 setpoint — 각 값 [-1,1] = 최대 기울기/이동 비율."""
    X: float = 0.0      # 전후 이동
    Y: float = 0.0      # 좌우 이동
    Z: float = 0.0      # 상하 이동
    Roll: float = 0.0   # 롤(좌우 기울기)
    Pitch: float = 0.0  # 피치(앞뒤 기울기)
    Yaw: float = 0.0    # 요(수평 회전)


def _clamp(v: float) -> float:
    return max(-1.0, min(1.0, float(v)))


# 경로 조각 → receiver 액션
# 보행(gait) 전환은 Standard 모드(수동 원격) 전용. receiver → relay_motion → ROS2 /GAIT
# (Agile 0x300X는 네비 주행용으로 별도 처리)
MODE_ACTIONS = {
    "stand": "STAND",
    "sit": "SIT",
    "slow": "SLOW",
    "normal": "NORMAL",
    "fast": "FAST",
    "shutdown": "SHUTDOWN",
    "front_on": "FRONTON",
    "front_off": "FRONTOFF",
    "rear_on": "REARON",
    "rear_off": "REAROFF",
    "gait_basic": "GAIT_BASIC",
    "gait_high_obstacle": "GAIT_HIGH_OBSTACLE",
    "gait_stair": "GAIT_STAIR",
    "gait_posture": "GAIT_POSTURE",
}


def _make_legacy(action: str):
    def handler(current_user: UserInfo = Depends(require_control())):
        robot_id = resolve_target_robot_id()
        logger.debug("레거시 경로 %s → robot=%s", action, robot_id)
        send_to_robot(action, robot_id=robot_id)
        return {"status": "ok", "robotId": robot_id}

    return handler


def _make_scoped(action: str):
    def handler(robot_id: int, current_user: UserInfo = Depends(require_control())):
        send_to_robot(action, robot_id=robot_id)
        return {"status": "ok", "robotId": robot_id}

    return handler


# 리터럴 경로를 먼저 등록해야 `/robot/sit` 이 `{robot_id}` 자리로 잡히지 않는다.
for _seg, _action in MODE_ACTIONS.items():
    router.add_api_route(
        f"/{_seg}", _make_legacy(_action), methods=["POST"], name=f"mode_legacy_{_seg}"
    )


# 자세 6축 setpoint — Posture(0xf001) gait 진입 후, Type 2/21로 기울기/이동 조정
@router.post("/posture")
def robot_posture_legacy(
    req: PostureRequest, current_user: UserInfo = Depends(require_control())
):
    robot_id = resolve_target_robot_id()
    send_posture_to_robot(
        _clamp(req.X), _clamp(req.Y), _clamp(req.Z),
        _clamp(req.Roll), _clamp(req.Pitch), _clamp(req.Yaw),
        robot_id=robot_id,
    )
    return {"status": "ok", "robotId": robot_id}


@router.post("/{robot_id}/posture")
def robot_posture(
    robot_id: int,
    req: PostureRequest,
    current_user: UserInfo = Depends(require_control()),
):
    send_posture_to_robot(
        _clamp(req.X), _clamp(req.Y), _clamp(req.Z),
        _clamp(req.Roll), _clamp(req.Pitch), _clamp(req.Yaw),
        robot_id=robot_id,
    )
    return {"status": "ok", "robotId": robot_id}


for _seg, _action in MODE_ACTIONS.items():
    router.add_api_route(
        f"/{{robot_id}}/{_seg}",
        _make_scoped(_action),
        methods=["POST"],
        name=f"mode_{_seg}",
    )
