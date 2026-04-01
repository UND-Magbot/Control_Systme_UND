from fastapi import APIRouter, Depends
from app.robot_sender import send_to_robot
from app.Database.models import UserInfo
from app.auth.dependencies import get_current_user

mode = APIRouter(prefix="/robot")

@mode.post("/stand")
def robot_up(current_user: UserInfo = Depends(get_current_user)):
    print("stand 명령 받음")
    send_to_robot("STAND")
    return {"status": "ok"}

@mode.post("/sit")
def robot_down(current_user: UserInfo = Depends(get_current_user)):
    print("sit 명령 받음")
    send_to_robot("SIT")
    return {"status": "ok"}

@mode.post("/slow")
def robot_left(current_user: UserInfo = Depends(get_current_user)):
    print("slow 명령 받음")
    send_to_robot("SLOW")
    return {"status": "ok"}

@mode.post("/normal")
def robot_right(current_user: UserInfo = Depends(get_current_user)):
    print("normal 명령 받음")
    send_to_robot("NORMAL")
    return {"status": "ok"}

@mode.post("/fast")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("fast 명령 받음")
    send_to_robot("FAST")
    return {"status": "ok"}

@mode.post("/shutdown")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("fast 명령 받음")
    send_to_robot("SHUTDOWN")
    return {"status": "ok"}

@mode.post("/front_on")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("front_on 명령 받음")
    send_to_robot("FRONTON")
    return {"status": "ok"}

@mode.post("/front_off")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("front_off 명령 받음")
    send_to_robot("FRONTOFF")
    return {"status": "ok"}

@mode.post("/rear_on")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("rear_on 명령 받음")
    send_to_robot("REARON")
    return {"status": "ok"}

@mode.post("/rear_off")
def robot_stop(current_user: UserInfo = Depends(get_current_user)):
    print("rear_off 명령 받음")
    send_to_robot("REAROFF")
    return {"status": "ok"}

