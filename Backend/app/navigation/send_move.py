from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import time
from app.robot_io.sender import send_nav_to_robot
from app.database.database import SessionLocal, get_db
from app.database.models import LocationInfo, WayInfo, UserInfo, RobotInfo
from app.logs.service import log_event
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id
from app.auth.dependencies import get_current_user, require_permission


move = APIRouter(prefix="/nav")

current_wp_index = 0
waypoints_list = []
is_navigating = False
nav_sent_time = 0
nav_loop_remaining = 0
charge_on_arrival = False  # 도착 후 자동 충전 플래그

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


def _update_is_working(robot_id: int, working: bool):
    """robot_last_status.IsWorking을 DB에 업데이트."""
    try:
        db = SessionLocal()
        try:
            from app.database.models import RobotLastStatus
            row = db.query(RobotLastStatus).filter(
                RobotLastStatus.RobotId == robot_id
            ).first()
            if row:
                row.IsWorking = 1 if working else 0
                db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[ERR] IsWorking 업데이트 실패: {e}")

@move.post("/stopmove")
def stop_navigation(current_user: UserInfo = Depends(get_current_user)):
    global is_navigating, current_wp_index, nav_loop_remaining, charge_on_arrival
    was_active = is_navigating
    is_navigating = False
    current_wp_index = 0
    nav_loop_remaining = 0
    charge_on_arrival = False
    _signal_nav_reset(full=True)
    _update_is_working(get_robot_id(), False)

    # 로봇에 즉시 정지 명령 + 네비게이션 취소
    try:
        from app.robot_io.sender import send_to_robot
        send_to_robot("CANCEL_NAV")
        send_to_robot("STOP")
    except Exception as e:
        print(f"[WARN] STOP/CANCEL_NAV 전송 실패: {e}")

    # 진행 중인 스케줄 취소
    try:
        from app.scheduler.loop import cancel_active_schedule, get_active_schedule_id
        if get_active_schedule_id() is not None:
            cancel_active_schedule("작업 정지")
    except Exception as e:
        print(f"[WARN] 스케줄 취소 실패: {e}")

    try:
        from app.recording.manager import stop_all_recording
        stop_all_recording(get_robot_id())
    except Exception as e:
        print(f"[WARN] 녹화 정지 실패: {e}")

    print(f"🛑 NAV STOP (was_active={was_active})")
    return {"status": "ok", "msg": "작업이 중지되었습니다."}

def navigation_resend_current():
    """현재 웨이포인트를 재전송 (로봇이 명령을 무시했을 때)"""
    global nav_sent_time

    if not is_navigating or current_wp_index <= 0:
        return

    idx = current_wp_index  # 이미 +1 된 상태
    wp = waypoints_list[idx - 1]

    print(f"🔁 NAV 재전송: {idx} / {len(waypoints_list)}")
    _signal_nav_reset()
    from app.robot_io.sender import send_nav_to_robot
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
            print(f"[SYNC] 반복 시작 (남은 횟수: {nav_loop_remaining + 1})")
            log_event("schedule", "nav_loop",
                      f"반복 시작 (남은 횟수: {nav_loop_remaining + 1})",
                      robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        else:
            is_navigating = False
            _update_is_working(get_robot_id(), False)

            try:
                from app.recording.manager import stop_all_recording
                stop_all_recording(get_robot_id())
            except Exception as e:
                print(f"[WARN] 녹화 정지 실패: {e}")

            # 도킹 포인트 도착 후 자동 충전
            global charge_on_arrival
            if charge_on_arrival:
                charge_on_arrival = False
                print("🔋 도킹 포인트 도착 완료 — 충전소 이동 명령 전송")
                log_event("schedule", "dock_arrival", "도킹 포인트 도착 완료, 충전 명령 전송",
                          robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
                try:
                    from app.robot_control.charge import start_charge
                    start_charge()
                except Exception as e:
                    print(f"[ERR] 자동 충전 명령 실패: {e}")
            else:
                print("🎉 모든 웨이포인트 이동 완료!")
                log_event("schedule", "nav_complete", "모든 웨이포인트 이동 완료",
                          robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

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
    from app.robot_io.sender import send_nav_to_robot
    send_nav_to_robot(idx, x, y, yaw)

    current_wp_index += 1
    nav_sent_time = time.time()

@move.post("/startpath")
def start_path_navigation(way_name: str, loop: int = 1, current_user: UserInfo = Depends(require_permission("robot-list"))):
    """DB 경로(WayInfo)를 읽어 네비게이션 시작."""
    global current_wp_index, waypoints_list, is_navigating, nav_loop_remaining

    db = SessionLocal()
    try:
        path = db.query(WayInfo).filter(WayInfo.WayName == way_name).first()
        if not path:
            return {"status": "error", "msg": f"경로 '{way_name}'을(를) 찾을 수 없습니다."}

        place_names = [n.strip() for n in path.WayPoints.split(" - ")]
        waypoints = []
        for name in place_names:
            place = db.query(LocationInfo).filter(LocationInfo.LacationName == name).first()
            if place:
                waypoints.append({
                    "x": place.LocationX,
                    "y": place.LocationY,
                    "yaw": place.Yaw or 0.0,
                    "name": place.LacationName,
                })

        if not waypoints:
            return {"status": "error", "msg": f"경로 '{way_name}'에 유효한 장소가 없습니다."}
    finally:
        db.close()

    waypoints_list = waypoints
    current_wp_index = 0
    is_navigating = True
    nav_loop_remaining = loop - 1
    _signal_nav_reset(full=True)
    _update_is_working(get_robot_id(), True)

    route_detail = " → ".join(wp["name"] for wp in waypoints_list)
    print(f"🚗 NAV START (경로: {way_name}) — {len(waypoints_list)}개 웨이포인트, 반복: {loop}회")
    log_event("schedule", "nav_start",
              f"경로 주행 시작: {way_name} ({len(waypoints_list)}개 웨이포인트, {loop}회 반복)",
              detail=f"경로: {route_detail}",
              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

    try:
        from app.recording.manager import start_auto_recording
        rid = get_robot_id()
        if not rid:
            db2 = SessionLocal()
            try:
                robot = db2.query(RobotInfo).order_by(RobotInfo.id.asc()).first()
                rid = robot.id if robot else None
            finally:
                db2.close()
        if rid:
            start_auto_recording(rid)
    except Exception as e:
        print(f"[WARN] 자동 녹화 시작 실패: {e}")

    navigation_send_next()
    return {"status": "ok", "msg": f"경로 '{way_name}' 주행 시작 ({loop}회)", "way_name": way_name}


@move.post("/placemove/{place_id}")
def move_to_place(place_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
    global current_wp_index, waypoints_list, is_navigating

    place = db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    if not place:
        return {"status": "error", "msg": "장소를 찾을 수 없습니다."}

    x = place.LocationX
    y = place.LocationY
    yaw = place.Yaw or 0.0

    # 단일 장소 이동도 네비게이션 흐름으로 관리 (도착 감지 + IsWorking 연동)
    waypoints_list = [{"x": x, "y": y, "yaw": yaw, "name": place.LacationName}]
    current_wp_index = 0
    is_navigating = True
    _signal_nav_reset(full=True)
    _update_is_working(get_robot_id(), True)

    print(f"🚗 장소 이동: {place.LacationName} → x={x}, y={y}, yaw={yaw}")
    log_event("schedule", "place_move_start", f"장소 이동: {place.LacationName}",
              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

    navigation_send_next()
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
    from app.navigation.waypoints import build_waypoints_from_places
    waypoints = build_waypoints_from_places(places)

    # 기존 웨이포인트 순차 이동 시스템 활용
    waypoints_list = waypoints
    current_wp_index = 0
    is_navigating = True
    _signal_nav_reset(full=True)
    _update_is_working(get_robot_id(), True)

    print(f"🛤 경로 이동 시작: {path.WayName} — 총 {len(waypoints)}개 포인트")
    for i, wp in enumerate(waypoints):
        print(f"  [{i+1}] {place_names[i]} → x={wp['x']}, y={wp['y']}, yaw={wp['yaw']}")
    route_names = " → ".join(place_names)
    log_event("schedule", "path_move_start",
              f"경로 이동 시작: {path.WayName} ({len(waypoints)}개 포인트)",
              detail=f"경로: {route_names}",
              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

    try:
        from app.recording.manager import start_auto_recording
        rid = get_robot_id()
        if not rid:
            _db = SessionLocal()
            try:
                _robot = _db.query(RobotInfo).order_by(RobotInfo.id.asc()).first()
                rid = _robot.id if _robot else None
            finally:
                _db.close()
        if rid:
            start_auto_recording(rid)
    except Exception as e:
        print(f"[WARN] 자동 녹화 시작 실패: {e}")

    navigation_send_next()
    return {"status": "ok", "msg": f"경로 '{path.WayName}' 이동 시작 ({len(waypoints)}개 포인트)"}