from fastapi import APIRouter
from app.robot_sender import send_to_robot

pad = APIRouter(prefix="/robot")

@pad.post("/up")
def robot_up():
    print("UP 명령 받음")
    send_to_robot("UP")
    return {"status": "ok"}

@pad.post("/down")
def robot_down():
    print("DOWN 명령 받음")
    send_to_robot("DOWN")
    return {"status": "ok"}

@pad.post("/left")
def robot_left():
    print("LEFT 명령 받음")
    send_to_robot("LEFT")
    return {"status": "ok"}

@pad.post("/right")
def robot_right():
    print("RIGHT 명령 받음")
    send_to_robot("RIGHT")
    return {"status": "ok"}

@pad.post("/stop")
def robot_stop():
    print("STOP 명령 받음")
    send_to_robot("STOP")
    return {"status": "ok"}

@pad.post("/leftTurn")
def robot_stop():
    print("leftTurn 명령 받음")
    send_to_robot("LEFTTURN")
    return {"status": "ok"}

@pad.post("/rightTurn")
def robot_stop():
    print("rightTurn 명령 받음")
    send_to_robot("RIGHTTURN")
    return {"status": "ok"}