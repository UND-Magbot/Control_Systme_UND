from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import os
import json
import time

# 🔥 main.py의 전역변수 직접 가져오기
import app.main
from app.Database.database import SessionLocal
from app.Database.models import LocationInfo

point = APIRouter(prefix="/nav")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

WAYPOINT_FILE = "./data/waypoints.json"


def _next_cur_name(db: Session) -> str:
    """CUR-001, CUR-002, ... 빈 번호 찾기 (삭제된 번호 재사용)"""
    existing = (
        db.query(LocationInfo.LacationName)
        .filter(LocationInfo.LacationName.like("CUR-%"))
        .all()
    )
    used = set()
    for (name,) in existing:
        try:
            num = int(name.split("-")[1])
            used.add(num)
        except (IndexError, ValueError):
            pass

    n = 1
    while n in used:
        n += 1
    return f"CUR-{n:03d}"


@point.post("/savepoint")
def save_current_waypoint(db: Session = Depends(get_db)):

    # receiver.py에서 수집 중인 위치 사용
    current_pos = app.main.robot_position

    if current_pos["timestamp"] == 0:
        return {"status": "error", "msg": "로봇 위치 응답 없음"}

    wp_x = round(current_pos["x"], 3)
    wp_y = round(current_pos["y"], 3)
    wp_yaw = round(current_pos["yaw"], 3)

    waypoint = {
        "x": wp_x,
        "y": wp_y,
        "yaw": wp_yaw,
        "timestamp": time.time(),
    }

    # 기존 JSON 불러오기
    try:
        with open(WAYPOINT_FILE, "r") as f:
            waypoints = json.load(f)
    except:
        waypoints = []

    waypoints.append(waypoint)

    # JSON 저장
    with open(WAYPOINT_FILE, "w") as f:
        json.dump(waypoints, f, indent=4)

    # DB 장소 저장 (CUR-XXX)
    cur_name = _next_cur_name(db)
    place = LocationInfo(
        UserId=1,
        RobotName="TestRobot-01",
        LacationName=cur_name,
        Floor="1F",
        LocationX=wp_x,
        LocationY=wp_y,
        Yaw=wp_yaw,
    )
    db.add(place)
    db.commit()
    print(f"📍 DB 장소 저장: {cur_name} → x={wp_x}, y={wp_y}, yaw={wp_yaw}")

    return {
        "status": "ok",
        "saved": waypoint,
        "total": len(waypoints),
        "place_name": cur_name,
    }

@point.post("/clearpoints")
def clear_waypoints():
    with open(WAYPOINT_FILE, "w") as f:
        json.dump([], f, indent=4)
    return {"status": "ok", "msg": "웨이포인트 초기화 완료"}


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
