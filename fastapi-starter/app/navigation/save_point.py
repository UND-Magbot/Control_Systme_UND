from fastapi import APIRouter
import os
import json
import time

# 🔥 main.py의 전역변수 직접 가져오기
import app.main

point = APIRouter(prefix="/nav")

WAYPOINT_FILE = "./data/waypoints.json"


@point.post("/savepoint")
def save_current_waypoint():

    # 위치 쓰레드에서 수집 중인 전역 변수 사용
    current_pos = app.main.robot_position

    if current_pos["timestamp"] == 0:
        return {"status": "error", "msg": "로봇 위치 응답 없음"}

    waypoint = {
        "x": round(current_pos["x"], 3),
        "y": round(current_pos["y"], 3),
        "yaw": round(current_pos["yaw"], 3),
        "timestamp": time.time(),
    }

    # 기존 JSON 불러오기
    try:
        with open(WAYPOINT_FILE, "r") as f:
            waypoints = json.load(f)
    except:
        waypoints = []

    waypoints.append(waypoint)

    # 저장
    with open(WAYPOINT_FILE, "w") as f:
        json.dump(waypoints, f, indent=4)

    return {
        "status": "ok",
        "saved": waypoint,
        "total": len(waypoints),
    }

# JSON 파일 존재하지 않을 경우 생성
os.makedirs("./data", exist_ok=True)
if not os.path.exists(WAYPOINT_FILE):
    with open(WAYPOINT_FILE, "w") as f:
        json.dump([], f, indent=4)


def load_waypoints():
    with open(WAYPOINT_FILE, "r") as f:
        return json.load(f)


def save_waypoints(data):
    with open(WAYPOINT_FILE, "w") as f:
        json.dump(data, f, indent=4)
