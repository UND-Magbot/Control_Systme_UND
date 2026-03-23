from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import time
import json
import math
import app.main
from app.robot_sender import send_nav_to_robot
from app.Database.database import SessionLocal
from app.Database.models import LocationInfo, WayInfo


move = APIRouter(prefix="/nav")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

current_wp_index = 0
waypoints_list = []
is_navigating = False
nav_sent_time = 0
nav_loop_remaining = 0
WAYPOINT_FILE = "./data/waypoints.json"

def is_nav_active():
    return is_navigating

def get_current_target():
    if not is_navigating or current_wp_index <= 0:
        return None
    idx = current_wp_index - 1
    if idx < len(waypoints_list):
        return waypoints_list[idx]
    return None

def get_nav_sent_time():
    return nav_sent_time

@move.post("/startmove")
def start_navigation(loop: int = 1):

    waypoints = load_waypoints()

    global current_wp_index, waypoints_list, is_navigating, nav_loop_remaining

    waypoints_list = waypoints
    current_wp_index = 0
    is_navigating = True
    nav_loop_remaining = loop - 1

    print(f"🚗 NAV START — 총 {len(waypoints_list)}개 웨이포인트, 반복: {loop}회")

    navigation_send_next()
    return {"status": "ok", "msg": f"네비게이션 명령 전송 완료 ({loop}회)"}

def navigation_send_next():
    global current_wp_index, waypoints_list, is_navigating, nav_sent_time, nav_loop_remaining

    if not is_navigating:
        return

    if current_wp_index >= len(waypoints_list):
        if nav_loop_remaining > 0:
            nav_loop_remaining -= 1
            current_wp_index = 0
            print(f"🔄 반복 시작 (남은 횟수: {nav_loop_remaining + 1})")
        else:
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
    nav_sent_time = time.time()

def load_waypoints():
    with open(WAYPOINT_FILE, "r") as f:
        return json.load(f)


@move.post("/placemove/{place_id}")
def move_to_place(place_id: int, db: Session = Depends(get_db)):
    place = db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    if not place:
        return {"status": "error", "msg": "장소를 찾을 수 없습니다."}

    x = place.LocationX
    y = place.LocationY
    yaw = place.Yaw or 0.0

    print(f"🚗 장소 이동: {place.LacationName} → x={x}, y={y}, yaw={yaw}")
    send_nav_to_robot(1, x, y, yaw)

    return {"status": "ok", "msg": f"{place.LacationName}(으)로 이동 명령 전송 완료"}


@move.post("/pathmove/{path_id}")
def move_along_path(path_id: int, db: Session = Depends(get_db)):
    global current_wp_index, waypoints_list, is_navigating

    path = db.query(WayInfo).filter(WayInfo.id == path_id).first()
    if not path:
        return {"status": "error", "msg": "경로를 찾을 수 없습니다."}

    place_names = [name.strip() for name in path.WayPoints.split(" - ")]
    if len(place_names) < 2:
        return {"status": "error", "msg": "경로에 장소가 2개 이상 필요합니다."}

    # 장소명으로 좌표 조회
    places = []
    for name in place_names:
        place = db.query(LocationInfo).filter(LocationInfo.LacationName == name).first()
        if not place:
            return {"status": "error", "msg": f"장소 '{name}'을(를) 찾을 수 없습니다."}
        places.append(place)

    # 웨이포인트 목록 생성 (yaw = 다음 포인트 방향, 마지막은 저장된 yaw)
    waypoints = []
    for i, place in enumerate(places):
        x = place.LocationX
        y = place.LocationY

        if i < len(places) - 1:
            # 다음 포인트를 향하는 방향으로 yaw 계산
            nx = places[i + 1].LocationX
            ny = places[i + 1].LocationY
            yaw = math.atan2(ny - y, nx - x)
        else:
            # 마지막 포인트: 저장된 yaw 사용
            yaw = place.Yaw or 0.0

        waypoints.append({"x": x, "y": y, "yaw": round(yaw, 3)})

    # 기존 웨이포인트 순차 이동 시스템 활용
    waypoints_list = waypoints
    current_wp_index = 0
    is_navigating = True

    print(f"🛤 경로 이동 시작: {path.WayName} — 총 {len(waypoints)}개 포인트")
    for i, wp in enumerate(waypoints):
        print(f"  [{i+1}] {place_names[i]} → x={wp['x']}, y={wp['y']}, yaw={wp['yaw']}")

    navigation_send_next()
    return {"status": "ok", "msg": f"경로 '{path.WayName}' 이동 시작 ({len(waypoints)}개 포인트)"}