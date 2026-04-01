from fastapi import APIRouter, Depends
from app.robot_sender import send_to_robot
from app.Database.models import UserInfo
from app.auth.dependencies import get_current_user

pad = APIRouter(prefix="/robot")

@pad.post("/up")
def robot_up(current_user: UserInfo = Depends(get_current_user)):
    print("UP 명령 받음")
    send_to_robot("UP")
    return {"status": "ok"}

@pad.post("/down")
def robot_down(current_user: UserInfo = Depends(get_current_user)):
    print("DOWN 명령 받음")
    send_to_robot("DOWN")
    return {"status": "ok"}

@pad.post("/left")
def robot_left(current_user: UserInfo = Depends(get_current_user)):
    print("LEFT 명령 받음")
    send_to_robot("LEFT")
    return {"status": "ok"}

@pad.post("/right")
def robot_right(current_user: UserInfo = Depends(get_current_user)):
    print("RIGHT 명령 받음")
    send_to_robot("RIGHT")
    return {"status": "ok"}

@pad.post("/stop")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("STOP 명령 받음")
    send_to_robot("STOP")
    return {"status": "ok"}

@pad.post("/leftTurn")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("leftTurn 명령 받음")
    send_to_robot("LEFTTURN")
    return {"status": "ok"}

@pad.post("/rightTurn")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("rightTurn 명령 받음")
    send_to_robot("RIGHTTURN")
    return {"status": "ok"}