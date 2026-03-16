from fastapi import APIRouter
import time
import json
import app.main
from app.robot_sender import send_nav_to_robot


move = APIRouter(prefix="/nav")

current_wp_index = 0
waypoints_list = []
is_navigating = False
WAYPOINT_FILE = "./data/waypoints.json"

@move.post("/startmove")
def start_navigation():

    waypoints = load_waypoints()

    global current_wp_index, waypoints_list, is_navigating

    waypoints_list = waypoints
    current_wp_index = 0
    is_navigating = True

    print(f"🚗 NAV START — 총 {len(waypoints_list)}개 웨이포인트")

    navigation_send_next()
    return {"status": "ok", "msg": "네비게이션 명령 전송 완료"}

def navigation_send_next():
    global current_wp_index, waypoints_list, is_navigating

    if not is_navigating:
        return

    if current_wp_index >= len(waypoints_list):
        print("🎉 모든 웨이포인트 이동 완료!")
        is_navigating = False
        return

    wp = waypoints_list[current_wp_index]
    idx = current_wp_index + 1

    x = wp["x"]
    y = wp["y"]
    yaw = wp["yaw"]

    print(f"➡ NAV 이동 시작: {idx} / {len(waypoints_list)}")
    from app.robot_sender import send_nav_to_robot
    send_nav_to_robot(idx, x, y, yaw)

    current_wp_index += 1

def load_waypoints():
    with open(WAYPOINT_FILE, "r") as f:
        return json.load(f)