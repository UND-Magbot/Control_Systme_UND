from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.robot_io.sender import send_to_robot, send_posture_to_robot
from app.database.models import UserInfo
from app.auth.dependencies import require_permission

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

@router.post("/stand")
def robot_up(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("stand 명령 받음")
    send_to_robot("STAND")
    return {"status": "ok"}

@router.post("/sit")
def robot_down(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("sit 명령 받음")
    send_to_robot("SIT")
    return {"status": "ok"}

@router.post("/slow")
def robot_left(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("slow 명령 받음")
    send_to_robot("SLOW")
    return {"status": "ok"}

@router.post("/normal")
def robot_right(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("normal 명령 받음")
    send_to_robot("NORMAL")
    return {"status": "ok"}

@router.post("/fast")
def robot_stop(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("fast 명령 받음")
    send_to_robot("FAST")
    return {"status": "ok"}

@router.post("/shutdown")
def robot_stop(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("fast 명령 받음")
    send_to_robot("SHUTDOWN")
    return {"status": "ok"}

@router.post("/front_on")
def robot_stop(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("front_on 명령 받음")
    send_to_robot("FRONTON")
    return {"status": "ok"}

@router.post("/front_off")
def robot_stop(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("front_off 명령 받음")
    send_to_robot("FRONTOFF")
    return {"status": "ok"}

@router.post("/rear_on")
def robot_stop(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("rear_on 명령 받음")
    send_to_robot("REARON")
    return {"status": "ok"}

@router.post("/rear_off")
def robot_stop(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("rear_off 명령 받음")
    send_to_robot("REAROFF")
    return {"status": "ok"}


# 보행(gait) 전환 — Standard 모드(수동 원격). receiver → relay_motion → ROS2 /GAIT
# (Agile 0x300X는 네비 주행용으로 별도 처리)
@router.post("/gait_basic")
def robot_gait_basic(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("gait_basic(기본 보행) 명령 받음")
    send_to_robot("GAIT_BASIC")
    return {"status": "ok"}


@router.post("/gait_high_obstacle")
def robot_gait_high_obstacle(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("gait_high_obstacle(고장애물 보행) 명령 받음")
    send_to_robot("GAIT_HIGH_OBSTACLE")
    return {"status": "ok"}


@router.post("/gait_stair")
def robot_gait_stair(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("gait_stair(계단 보행) 명령 받음")
    send_to_robot("GAIT_STAIR")
    return {"status": "ok"}


@router.post("/gait_posture")
def robot_gait_posture(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("gait_posture(자세 보행) 명령 받음")
    send_to_robot("GAIT_POSTURE")
    return {"status": "ok"}


# 자세 6축 setpoint — Posture(0xf001) gait 진입 후, Type 2/21로 기울기/이동 조정
@router.post("/posture")
def robot_posture(req: PostureRequest,
                  current_user: UserInfo = Depends(require_permission("robot-list"))):
    send_posture_to_robot(
        _clamp(req.X), _clamp(req.Y), _clamp(req.Z),
        _clamp(req.Roll), _clamp(req.Pitch), _clamp(req.Yaw),
    )
    return {"status": "ok"}

