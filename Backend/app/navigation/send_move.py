from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import time
import json
import math
import app.main
from app.robot_sender import send_nav_to_robot
from app.Database.database import SessionLocal
from app.Database.models import LocationInfo, WayInfo, UserInfo
from app.logs.service import log_event
from app.current_user import get_robot_id, get_robot_name
from app.auth.dependencies import get_current_user, require_permission


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

# nav_thread 상태 리셋 신호 (새 주행/정지 시 nav_thread가 감지)
_nav_reset_flag = False
_nav_full_reset_flag = False  # True면 retry_count도 리셋

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

def check_and_clear_reset_flag():
    """nav_thread에서 호출: 리셋 신호가 있으면 (True, is_full) 반환 후 클리어"""
    global _nav_reset_flag, _nav_full_reset_flag
    if _nav_reset_flag:
        is_full = _nav_full_reset_flag
        _nav_reset_flag = False
        _nav_full_reset_flag = False
        return True, is_full
    return False, False

def _signal_nav_reset(full=False):
    global _nav_reset_flag, _nav_full_reset_flag
    _nav_reset_flag = True
    _nav_full_reset_flag = full

@move.post("/startmove")
def start_navigation(loop: int = 3, current_user: UserInfo = Depends(require_permission("robot-list"))):

    waypoints = load_waypoints()

    global current_wp_index, waypoints_list, is_navigating, nav_loop_remaining

    waypoints_list = waypoints
    current_wp_index = 0
    is_navigating = True
    nav_loop_remaining = loop - 1

    # nav_thread 상태 리셋 (last_status, zero_count, retry_count 초기화)
    _signal_nav_reset(full=True)

    print(f"🚗 NAV START — 총 {len(waypoints_list)}개 웨이포인트, 반복: {loop}회")
    log_event("schedule", "nav_start",
              f"네비게이션 시작 ({len(waypoints_list)}개 웨이포인트, {loop}회 반복)",
              robot_id=get_robot_id(), robot_name=get_robot_name())

    navigation_send_next()
    return {"status": "ok", "msg": f"네비게이션 명령 전송 완료 ({loop}회)"}

@move.post("/stopmove")
def stop_navigation(current_user: UserInfo = Depends(get_current_user)):
    global is_navigating, current_wp_index, nav_loop_remaining
    was_active = is_navigating
    is_navigating = False
    current_wp_index = 0
    nav_loop_remaining = 0
    _signal_nav_reset(full=True)
    print(f"🛑 NAV STOP (was_active={was_active})")
    return {"status": "ok", "msg": "네비게이션 정지 완료"}

def navigation_resend_current():
    """현재 웨이포인트를 재전송 (로봇이 명령을 무시했을 때)"""
    global nav_sent_time

    if not is_navigating or current_wp_index <= 0:
        return

    idx = current_wp_index  # 이미 +1 된 상태
    wp = waypoints_list[idx - 1]

    print(f"🔁 NAV 재전송: {idx} / {len(waypoints_list)}")
    _signal_nav_reset()
    from app.robot_sender import send_nav_to_robot
    send_nav_to_robot(idx, wp["x"], wp["y"], wp["yaw"])
    nav_sent_time = time.time()

def navigation_send_next():
    global current_wp_index, waypoints_list, is_navigating, nav_sent_time, nav_loop_remaining

    if not is_navigating:
        return

    if current_wp_index >= len(waypoints_list):
        if nav_loop_remaining > 0:
            nav_loop_remaining -= 1
            current_wp_index = 0
            print(f"🔄 반복 시작 (남은 횟수: {nav_loop_remaining + 1})")
            log_event("schedule", "nav_loop",
                      f"반복 시작 (남은 횟수: {nav_loop_remaining + 1})",
                      robot_id=get_robot_id(), robot_name=get_robot_name())
        else:
            print("🎉 모든 웨이포인트 이동 완료!")
            log_event("schedule", "nav_complete", "모든 웨이포인트 이동 완료",
                      robot_id=get_robot_id(), robot_name=get_robot_name())
            is_navigating = False
            return

    wp = waypoints_list[current_wp_index]
    idx = current_wp_index + 1

    x = wp["x"]
    y = wp["y"]
    yaw = wp["yaw"]

    # 다음 웨이포인트 전송 전 nav_thread 상태 리셋
    # → last_status=None으로 초기화되어 새 상태 전환을 감지할 수 있음
    _signal_nav_reset(full=True)

    print(f"➡ NAV 이동 시작: {idx} / {len(waypoints_list)}")
    time.sleep(1)  # 로봇 네비게이션 준비 대기
    from app.robot_sender import send_nav_to_robot
    send_nav_to_robot(idx, x, y, yaw)

    current_wp_index += 1
    nav_sent_time = time.time()

def load_waypoints():
    with open(WAYPOINT_FILE, "r") as f:
        return json.load(f)


@move.post("/placemove/{place_id}")
def move_to_place(place_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
    place = db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    if not place:
        return {"status": "error", "msg": "장소를 찾을 수 없습니다."}

    x = place.LocationX
    y = place.LocationY
    yaw = place.Yaw or 0.0

    print(f"🚗 장소 이동: {place.LacationName} → x={x}, y={y}, yaw={yaw}")
    log_event("schedule", "place_move_start", f"장소 이동: {place.LacationName}",
              robot_id=get_robot_id(), robot_name=get_robot_name())
    send_nav_to_robot(1, x, y, yaw)

    return {"status": "ok", "msg": f"{place.LacationName}(으)로 이동 명령 전송 완료"}


@move.post("/pathmove/{path_id}")
def move_along_path(path_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
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
    _signal_nav_reset(full=True)

    print(f"🛤 경로 이동 시작: {path.WayName} — 총 {len(waypoints)}개 포인트")
    for i, wp in enumerate(waypoints):
        print(f"  [{i+1}] {place_names[i]} → x={wp['x']}, y={wp['y']}, yaw={wp['yaw']}")
    log_event("schedule", "path_move_start",
              f"경로 이동 시작: {path.WayName} ({len(waypoints)}개 포인트)",
              robot_id=get_robot_id(), robot_name=get_robot_name())

    navigation_send_next()
    return {"status": "ok", "msg": f"경로 '{path.WayName}' 이동 시작 ({len(waypoints)}개 포인트)"}