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
nav_loop_total = 0
nav_loop_count = 0          # 현재 진행 중인 반복 회차 (1부터 시작)
nav_loop_infinite = False   # 무한 반복 모드 (작업 중지 전까지 계속)
charge_on_arrival = False  # 도착 후 자동 충전 플래그 (도킹 포인트 도착 시 start_charge 호출)
auto_return_to_charge = False  # 작업 완료 후 충전소로 자동 복귀 플래그
                                # startpath(원격 반복 포함) / 스케줄러만 True.
                                # pathmove / placemove / return-to-charge 자체는 False.

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
    global _nav_reset_flag, _nav_full_reset_flag, nav_sent_time
    _nav_reset_flag = True
    _nav_full_reset_flag = full
    # 이전 작업의 stale nav_sent_time이 남아 있으면 nav_thread가
    # elapsed > NAV_RETRY_TIMEOUT으로 오판해 새 명령 송신 직후 즉시 재전송이 발동된다.
    # 새 명령은 곧 navigation_send_next/resend_current에서 nav_sent_time을 다시 갱신하므로
    # 그 사이 폴링 사이클에서 재전송이 트리거되지 않도록 0으로 비워둔다.
    nav_sent_time = 0


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
    global is_navigating, current_wp_index, nav_loop_remaining, nav_loop_total, nav_loop_count, nav_loop_infinite, charge_on_arrival, auto_return_to_charge
    was_active = is_navigating
    is_navigating = False
    current_wp_index = 0
    nav_loop_remaining = 0
    nav_loop_total = 0
    nav_loop_count = 0
    nav_loop_infinite = False
    charge_on_arrival = False
    auto_return_to_charge = False
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
    return {
        "status": "ok",
        "was_active": was_active,
        "msg": "작업이 중지되었습니다." if was_active else "진행 중인 작업이 없습니다.",
    }

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
    global current_wp_index, waypoints_list, is_navigating, nav_sent_time, nav_loop_remaining, nav_loop_total, nav_loop_count, nav_loop_infinite

    if not is_navigating:
        return

    # 직전 웨이포인트 도착 후 경로별 대기 시간 적용 (첫 출발/preamble은 0이라 자동 skip)
    if 0 < current_wp_index <= len(waypoints_list):
        prev_wp = waypoints_list[current_wp_index - 1]
        wait_s = int(prev_wp.get("wait_seconds", 0) or 0)
        if wait_s > 0:
            wp_name = prev_wp.get("name", f"WP{current_wp_index}")
            print(f"⏸ 도착 후 대기: {wait_s}초 ({wp_name})")
            log_event("schedule", "nav_wait",
                      f"{wp_name} 도착 후 대기 {wait_s}초",
                      robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
            for _ in range(wait_s):
                if not is_navigating:
                    print("⏸ 대기 중 정지 감지 — wait 중단")
                    return
                time.sleep(1)

    if current_wp_index >= len(waypoints_list):
        if nav_loop_infinite:
            nav_loop_count += 1
            current_wp_index = 0
            print(f"[SYNC] 무한 반복 — {nav_loop_count}회차 시작")
            log_event("schedule", "nav_loop",
                      f"무한 반복 — {nav_loop_count}회차 시작",
                      robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        elif nav_loop_remaining > 0:
            nav_loop_remaining -= 1
            nav_loop_count += 1
            current_wp_index = 0
            print(f"[SYNC] 반복 시작 (남은 횟수: {nav_loop_remaining + 1})")
            log_event("schedule", "nav_loop",
                      f"반복 시작 (남은 횟수: {nav_loop_remaining + 1})",
                      robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        else:
            is_navigating = False
            nav_loop_total = 0
            nav_loop_infinite = False
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

                # 도킹 위치 정확도 진단 (localization drift 의심 시 추적)
                dock_diag_msg = ""
                try:
                    import math
                    from app.robot_io import runtime
                    rid = get_robot_id()
                    if rid and waypoints_list:
                        dock_target = waypoints_list[-1]
                        pos = runtime.get_position(rid)
                        dx = pos["x"] - dock_target["x"]
                        dy = pos["y"] - dock_target["y"]
                        dist = (dx ** 2 + dy ** 2) ** 0.5
                        target_yaw = float(dock_target.get("yaw", 0.0) or 0.0)
                        dyaw = pos["yaw"] - target_yaw
                        while dyaw > math.pi:
                            dyaw -= 2 * math.pi
                        while dyaw <= -math.pi:
                            dyaw += 2 * math.pi
                        dock_diag_msg = (
                            f"위치 차이 {dist * 100:.1f}cm "
                            f"(dx={dx * 100:+.1f}cm, dy={dy * 100:+.1f}cm, "
                            f"dyaw={math.degrees(dyaw):+.1f}°)"
                        )
                        print(
                            f"🔋 [DOCK DIAG] {dock_diag_msg} | "
                            f"actual=({pos['x']:.3f},{pos['y']:.3f},yaw={pos['yaw']:.3f}) "
                            f"target=({dock_target['x']:.3f},{dock_target['y']:.3f},yaw={target_yaw:.3f})"
                        )
                except Exception as diag_err:
                    print(f"[WARN] 도킹 위치 진단 실패: {diag_err}")

                print("🔋 도킹 포인트 도착 완료 — 충전소 이동 명령 전송")
                arrival_msg = (
                    f"도킹 포인트 도착 완료, 충전 명령 전송 ({dock_diag_msg})"
                    if dock_diag_msg else "도킹 포인트 도착 완료, 충전 명령 전송"
                )
                log_event("schedule", "dock_arrival", arrival_msg,
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

    # sleep 중 사용자가 정지했을 수 있으므로 송신 직전 재확인
    if not is_navigating:
        print(f"⏸ NAV 이동 취소됨 (WP {idx}) — sleep 중 정지 감지")
        return

    from app.robot_io.sender import send_nav_to_robot
    send_nav_to_robot(idx, x, y, yaw)

    current_wp_index += 1
    nav_sent_time = time.time()

@move.post("/startpath")
def start_path_navigation(way_name: str, loop: int = 1, auto_charge: bool = True, current_user: UserInfo = Depends(require_permission("robot-list"))):
    """DB 경로(WayInfo)를 읽어 네비게이션 시작.

    auto_charge: 작업 완료 후 충전소 자동 복귀 여부 (기본 True).
                 원격 화면 체크박스로 끌 수 있음(반복 테스트 등).
    """
    from app.robot_control.charge import prepare_undock_waypoints

    global current_wp_index, waypoints_list, is_navigating, nav_loop_remaining, nav_loop_total, nav_loop_count, nav_loop_infinite, auto_return_to_charge

    db = SessionLocal()
    try:
        path = db.query(WayInfo).filter(WayInfo.WayName == way_name).first()
        if not path:
            return {"status": "error", "msg": f"경로 '{way_name}'을(를) 찾을 수 없습니다."}

        place_names = [n.strip() for n in path.WayPoints.split(" - ")]
        from app.navigation.waypoints import parse_wait_seconds
        wait_list = parse_wait_seconds(path.WaitSeconds, len(place_names))
        waypoints = []
        for i, name in enumerate(place_names):
            place = db.query(LocationInfo).filter(LocationInfo.LacationName == name).first()
            if place:
                waypoints.append({
                    "x": place.LocationX,
                    "y": place.LocationY,
                    "yaw": place.Yaw or 0.0,
                    "name": place.LacationName,
                    "wait_seconds": wait_list[i],
                })

        if not waypoints:
            return {"status": "error", "msg": f"경로 '{way_name}'에 유효한 장소가 없습니다."}
    finally:
        db.close()

    # 충전 중이면 해제 후 도킹 포인트 경유 + 180° 회전 preamble 삽입
    undock_preamble = prepare_undock_waypoints()
    if undock_preamble:
        waypoints = undock_preamble + waypoints

    waypoints_list = waypoints
    current_wp_index = 0
    is_navigating = True
    # loop <= 0 이면 무한 반복 (작업 중지 전까지 계속)
    nav_loop_infinite = loop <= 0
    nav_loop_remaining = 0 if nav_loop_infinite else max(0, loop - 1)
    nav_loop_total = 0 if nav_loop_infinite else loop
    nav_loop_count = 1
    loop_label = "무한 반복" if nav_loop_infinite else f"{loop}회"
    auto_return_to_charge = auto_charge  # 원격 제어 실행 완료 후 충전소 자동 복귀 (체크박스로 토글)
    _signal_nav_reset(full=True)
    _update_is_working(get_robot_id(), True)

    route_detail = " → ".join(wp["name"] for wp in waypoints_list)
    print(f"🚗 NAV START (경로: {way_name}) — {len(waypoints_list)}개 웨이포인트, 반복: {loop_label}")
    log_event("schedule", "nav_start",
              f"경로 주행 시작: {way_name} ({len(waypoints_list)}개 웨이포인트, {loop_label})",
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
    return {"status": "ok", "msg": f"경로 '{way_name}' 주행 시작 ({loop_label})", "way_name": way_name}


@move.post("/placemove/{place_id}")
def move_to_place(place_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
    from app.robot_control.charge import prepare_undock_waypoints

    global current_wp_index, waypoints_list, is_navigating, auto_return_to_charge

    place = db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    if not place:
        return {"status": "error", "msg": "장소를 찾을 수 없습니다."}

    x = place.LocationX
    y = place.LocationY
    yaw = place.Yaw or 0.0

    work_wps = [{"x": x, "y": y, "yaw": yaw, "name": place.LacationName}]

    # 충전 중이면 해제 후 도킹 포인트 경유 + 180° 회전 preamble 삽입
    undock_preamble = prepare_undock_waypoints()
    if undock_preamble:
        work_wps = undock_preamble + work_wps

    # 단일 장소 이동도 네비게이션 흐름으로 관리 (도착 감지 + IsWorking 연동)
    waypoints_list = work_wps
    current_wp_index = 0
    is_navigating = True
    auto_return_to_charge = False  # 장소 이동은 충전소 복귀 안 함
    _signal_nav_reset(full=True)
    _update_is_working(get_robot_id(), True)

    print(f"🚗 장소 이동: {place.LacationName} → x={x}, y={y}, yaw={yaw}")
    log_event("schedule", "place_move_start", f"장소 이동: {place.LacationName}",
              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

    navigation_send_next()
    return {"status": "ok", "msg": f"{place.LacationName}(으)로 이동 명령 전송 완료"}


@move.post("/pathmove/{path_id}")
def move_along_path(path_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
    from app.robot_control.charge import prepare_undock_waypoints

    global current_wp_index, waypoints_list, is_navigating, auto_return_to_charge

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
    from app.navigation.waypoints import build_waypoints_from_places, parse_wait_seconds
    wait_list = parse_wait_seconds(path.WaitSeconds, len(places))
    waypoints = build_waypoints_from_places(places, wait_list)

    # 충전 중이면 해제 후 도킹 포인트 경유 + 180° 회전 preamble 삽입
    undock_preamble = prepare_undock_waypoints()
    if undock_preamble:
        waypoints = undock_preamble + waypoints

    # 기존 웨이포인트 순차 이동 시스템 활용
    waypoints_list = waypoints
    current_wp_index = 0
    is_navigating = True
    auto_return_to_charge = False  # 경로 이동 버튼은 충전소 복귀 안 함
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