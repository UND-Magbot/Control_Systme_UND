"""수동 이동 조작(패드) — 로봇별로 대상을 지정해 명령을 보낸다.

경로는 두 벌이다:
  - ``/robot/{robot_id}/up`` … 대상 로봇을 명시하는 정식 경로
  - ``/robot/up``            … 단일 로봇 시절의 레거시 경로(캐시된 로봇으로 폴백)

레거시 경로는 기존 클라이언트가 깨지지 않도록 남겨둔 것이고, 새 호출은 전부
robot_id 를 실어야 한다. 두 벌 모두 같은 동작을 하므로 차이는 대상 결정 방식뿐이다.
(설계: 06_Planning/ARCH-Remote-Control-and-Device-Console.md §1.3 R1)
"""
import logging

from fastapi import APIRouter, Depends

from app.auth.dependencies import require_permission
from app.database.models import UserInfo
from app.robot_control.control_deps import require_control, resolve_target_robot_id
from app.robot_io.sender import send_to_robot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/robot")

# 경로 조각 → receiver 액션
MOVE_ACTIONS = {
    "up": "UP",
    "down": "DOWN",
    "left": "LEFT",
    "right": "RIGHT",
    "leftTurn": "LEFTTURN",
    "rightTurn": "RIGHTTURN",
    "slow": "SLOW",
    "normal": "NORMAL",
    "fast": "FAST",
}


def _make_legacy(action: str):
    """레거시 경로 — 대상이 없으므로 캐시된 로봇으로 폴백한다."""

    def handler(current_user: UserInfo = Depends(require_control())):
        robot_id = resolve_target_robot_id()
        logger.debug("레거시 경로 %s → robot=%s", action, robot_id)
        send_to_robot(action, robot_id=robot_id)
        return {"status": "ok", "robotId": robot_id}

    return handler


def _make_scoped(action: str):
    """대상 로봇을 명시하는 경로."""

    def handler(robot_id: int, current_user: UserInfo = Depends(require_control())):
        send_to_robot(action, robot_id=robot_id)
        return {"status": "ok", "robotId": robot_id}

    return handler


# 리터럴 경로를 먼저 등록해야 `/robot/up` 이 `{robot_id}` 자리로 잡히지 않는다.
for _seg, _action in MOVE_ACTIONS.items():
    router.add_api_route(
        f"/{_seg}", _make_legacy(_action), methods=["POST"], name=f"pad_legacy_{_seg}"
    )


# ── 정지 ──
# 정지는 제어권보다 위다. 권한만 있으면 누구든 세울 수 있어야 한다.
@router.post("/stop")
def robot_stop_legacy(current_user: UserInfo = Depends(require_permission("robot-list"))):
    robot_id = resolve_target_robot_id()
    send_to_robot("STOP", robot_id=robot_id)
    return {"status": "ok", "robotId": robot_id}


@router.post("/{robot_id}/stop")
def robot_stop(
    robot_id: int, current_user: UserInfo = Depends(require_permission("robot-list"))
):
    send_to_robot("STOP", robot_id=robot_id)
    return {"status": "ok", "robotId": robot_id}


for _seg, _action in MOVE_ACTIONS.items():
    router.add_api_route(
        f"/{{robot_id}}/{_seg}",
        _make_scoped(_action),
        methods=["POST"],
        name=f"pad_{_seg}",
    )
