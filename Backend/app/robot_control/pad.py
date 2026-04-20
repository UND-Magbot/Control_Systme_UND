from fastapi import APIRouter, Depends
from app.robot_io.sender import send_to_robot
from app.database.models import UserInfo
from app.auth.dependencies import require_permission

router = APIRouter(prefix="/robot")

@router.post("/up")
def robot_up(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("UP 명령 받음")
    send_to_robot("UP")
    return {"status": "ok"}

@router.post("/down")
def robot_down(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("DOWN 명령 받음")
    send_to_robot("DOWN")
    return {"status": "ok"}

@router.post("/left")
def robot_left(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("LEFT 명령 받음")
    send_to_robot("LEFT")
    return {"status": "ok"}

@router.post("/right")
def robot_right(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("RIGHT 명령 받음")
    send_to_robot("RIGHT")
    return {"status": "ok"}

@router.post("/stop")
def robot_stop(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("STOP 명령 받음")
    send_to_robot("STOP")
    return {"status": "ok"}

@router.post("/leftTurn")
def robot_stop(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("leftTurn 명령 받음")
    send_to_robot("LEFTTURN")
    return {"status": "ok"}

@router.post("/rightTurn")
def robot_right_turn(current_user: UserInfo = Depends(require_permission("robot-list"))):
    print("rightTurn 명령 받음")
    send_to_robot("RIGHTTURN")
    return {"status": "ok"}

@router.post("/slow")
def robot_slow(current_user: UserInfo = Depends(require_permission("robot-list"))):
    send_to_robot("SLOW")
    return {"status": "ok"}

@router.post("/normal")
def robot_normal(current_user: UserInfo = Depends(require_permission("robot-list"))):
    send_to_robot("NORMAL")
    return {"status": "ok"}

@router.post("/fast")
def robot_fast(current_user: UserInfo = Depends(require_permission("robot-list"))):
    send_to_robot("FAST")
    return {"status": "ok"}
