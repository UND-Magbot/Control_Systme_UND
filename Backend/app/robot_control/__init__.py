"""
로봇 제어 엔드포인트 aggregator.
각 도메인 파일이 자체 APIRouter를 가지고 있으며, 여기서 하나로 묶는다.
main.py에서 `from app.robot_control import router` 로 가져가 include한다.
"""

from fastapi import APIRouter

from app.robot_control.camera import router as camera_router
from app.robot_control.status import router as status_router
from app.robot_control.charge import router as charge_router
from app.robot_control.return_to_work import router as return_to_work_router
from app.robot_control.error import router as error_router
from app.robot_control.pad import router as pad_router
from app.robot_control.mode import router as mode_router

router = APIRouter()
router.include_router(camera_router)
router.include_router(status_router)
router.include_router(charge_router)
router.include_router(return_to_work_router)
router.include_router(error_router)
router.include_router(pad_router)
router.include_router(mode_router)

# start_charge 는 navigation/send_move.py 에서 직접 호출하므로 re-export
from app.robot_control.charge import start_charge  # noqa: F401

__all__ = ["router", "start_charge"]
