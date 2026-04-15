"""작업 복귀 워크플로: 가장 최근 경로의 출발 지점으로 복귀"""

import math
import time

from fastapi import APIRouter

from app.database.database import SessionLocal
from app.database.models import LocationInfo, WayInfo, ScheduleInfo
from app.user_cache import get_robot_id, get_robot_name
from app.logs.service import log_event

router = APIRouter()


@router.get("/robot/return-to-work/info")
def get_return_to_work_info():
    """작업 복귀 가능 여부 + 대상 경로 정보 반환"""
    import app.navigation.send_move as nav
    from app.scheduler.loop import get_active_schedule_id

    source = None       # "active" | "recent"
    way_name = None
    origin_name = None
    waypoint_names = []
    schedule_name = None

    # 1) 현재 진행 중인 네비게이션 또는 활성 스케줄
    active_schedule_id = get_active_schedule_id()
    is_active = nav.is_navigating or active_schedule_id is not None

    if is_active and nav.waypoints_list:
        source = "active"
        waypoint_names = [wp.get("name", f"({wp['x']:.1f},{wp['y']:.1f})") for wp in nav.waypoints_list]
        origin_name = waypoint_names[0]
        if active_schedule_id:
            db = SessionLocal()
            try:
                sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == active_schedule_id).first()
                if sched:
                    way_name = sched.WayName
                    schedule_name = sched.WorkName
            finally:
                db.close()

    # 활성 스케줄은 있지만 waypoints_list가 비어있는 경우 — DB에서 경로 조회
    if is_active and not waypoint_names and active_schedule_id:
        db = SessionLocal()
        try:
            sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == active_schedule_id).first()
            if sched and sched.WayName:
                path = db.query(WayInfo).filter(WayInfo.WayName == sched.WayName).first()
                if path:
                    place_names = [n.strip() for n in path.WayPoints.split(" - ")]
                    valid_names = []
                    for name in place_names:
                        if db.query(LocationInfo).filter(LocationInfo.LacationName == name).first():
                            valid_names.append(name)
                    if valid_names:
                        source = "active"
                        way_name = sched.WayName
                        schedule_name = sched.WorkName
                        waypoint_names = valid_names
                        origin_name = valid_names[0]
        finally:
            db.close()

    # 2) DB에서 "진행중" 상태 스케줄 확인
    if not source:
        db = SessionLocal()
        try:
            running = (
                db.query(ScheduleInfo)
                .filter(ScheduleInfo.TaskStatus == "진행중")
                .order_by(ScheduleInfo.LastRunDate.desc())
                .first()
            )
            if running and running.WayName:
                path = db.query(WayInfo).filter(WayInfo.WayName == running.WayName).first()
                if path:
                    place_names = [n.strip() for n in path.WayPoints.split(" - ")]
                    valid_names = []
                    for name in place_names:
                        if db.query(LocationInfo).filter(LocationInfo.LacationName == name).first():
                            valid_names.append(name)
                    if valid_names:
                        source = "active"
                        way_name = running.WayName
                        schedule_name = running.WorkName
                        waypoint_names = valid_names
                        origin_name = valid_names[0]
        finally:
            db.close()

    # 3) 최근 실행된 스케줄 경로
    if not source:
        db = SessionLocal()
        try:
            recent = (
                db.query(ScheduleInfo)
                .filter(ScheduleInfo.LastRunDate.isnot(None))
                .order_by(ScheduleInfo.LastRunDate.desc())
                .first()
            )
            if recent and recent.WayName:
                path = db.query(WayInfo).filter(WayInfo.WayName == recent.WayName).first()
                if path:
                    place_names = [n.strip() for n in path.WayPoints.split(" - ")]
                    valid = True
                    for name in place_names:
                        if not db.query(LocationInfo).filter(LocationInfo.LacationName == name).first():
                            valid = False
                            break
                    if valid and place_names:
                        source = "recent"
                        way_name = recent.WayName
                        schedule_name = recent.WorkName
                        waypoint_names = place_names
                        origin_name = place_names[0]
        finally:
            db.close()

    if not source:
        return {"available": False, "msg": "복귀할 경로가 없습니다."}

    return {
        "available": True,
        "source": source,
        "source_label": "진행 중인 작업" if source == "active" else "최근 작업",
        "retrace_available": source == "active" and nav.is_navigating and nav.current_wp_index > 0,
        "schedule_name": schedule_name,
        "way_name": way_name,
        "origin": origin_name,
        "waypoints": waypoint_names,
    }


@router.post("/robot/return-to-work")
def return_to_work(mode: str = "direct"):
    """
    작업 복귀: 가장 최근 경로의 출발 지점으로 복귀.
    - mode="direct": 자율 주행 (출발 지점으로 직접 이동)
    - mode="retrace": 경로 역주행 (현재 위치에서 경로를 거꾸로 따라감)
    """
    from app.navigation.send_move import navigation_send_next, _signal_nav_reset
    import app.navigation.send_move as nav
    from app.robot_io.sender import send_to_robot
    from app.scheduler.loop import cancel_active_schedule, get_active_schedule_id

    # 현재 진행 중인 경로가 있으면 그것을 사용, 없으면 가장 최근 실행된 스케줄의 경로
    waypoints_snapshot = list(nav.waypoints_list) if nav.waypoints_list else []
    wp_index_snapshot = nav.current_wp_index  # 정지 전에 인덱스 저장
    way_name = None

    if not waypoints_snapshot:
        db = SessionLocal()
        try:
            recent = (
                db.query(ScheduleInfo)
                .filter(ScheduleInfo.LastRunDate.isnot(None))
                .order_by(ScheduleInfo.LastRunDate.desc())
                .first()
            )
            if recent and recent.WayName:
                way_name = recent.WayName
                path = db.query(WayInfo).filter(WayInfo.WayName == way_name).first()
                if path:
                    place_names = [n.strip() for n in path.WayPoints.split(" - ")]
                    for name in place_names:
                        place = db.query(LocationInfo).filter(LocationInfo.LacationName == name).first()
                        if place:
                            waypoints_snapshot.append({
                                "x": place.LocationX,
                                "y": place.LocationY,
                                "yaw": place.Yaw or 0.0,
                                "name": place.LacationName,
                            })
        finally:
            db.close()

    if not waypoints_snapshot:
        return {"status": "error", "msg": "복귀할 경로가 없습니다. 최근 작업 이력이 없습니다."}

    # 출발 지점 = 경로의 첫 번째 웨이포인트
    origin = waypoints_snapshot[0]

    # 1) 진행 중인 스케줄 취소
    if get_active_schedule_id() is not None:
        cancel_active_schedule("작업 복귀")

    # 2) 진행 중인 네비게이션 정지
    if nav.is_navigating:
        nav.is_navigating = False
        nav.current_wp_index = 0
        nav.nav_loop_remaining = 0
        nav.charge_on_arrival = False
        _signal_nav_reset(full=True)

    # 3) 로봇 정지
    try:
        send_to_robot("STOP")
    except Exception as e:
        print(f"[WARN] STOP 전송 실패: {e}")

    time.sleep(1)

    if mode == "retrace":
        # 경로 역주행: 현재 웨이포인트 위치부터 역순으로 출발 지점까지
        wp_index = min(wp_index_snapshot, len(waypoints_snapshot))
        passed = max(wp_index - 1, 0)  # 실제 도착 완료한 포인트까지
        retrace_wps = list(reversed(waypoints_snapshot[:max(passed, 1)]))

        # yaw를 역방향으로 재계산
        for i in range(len(retrace_wps)):
            if i < len(retrace_wps) - 1:
                nx = retrace_wps[i + 1]["x"]
                ny = retrace_wps[i + 1]["y"]
                retrace_wps[i]["yaw"] = round(math.atan2(ny - retrace_wps[i]["y"], nx - retrace_wps[i]["x"]), 3)

        nav.waypoints_list = retrace_wps
        route_desc = " → ".join(wp.get("name", f"({wp['x']:.1f},{wp['y']:.1f})") for wp in retrace_wps)
        print(f"🔙 작업 복귀 (역주행): {len(retrace_wps)}개 포인트 — {route_desc}")
    else:
        # 자율 주행: 출발 지점으로 직접 이동
        nav.waypoints_list = [origin]
        print(f"🔙 작업 복귀 (자율주행): {origin.get('name', '')} → x={origin['x']}, y={origin['y']}")

    nav.current_wp_index = 0
    nav.is_navigating = True
    nav.nav_loop_remaining = 0
    nav.charge_on_arrival = False
    _signal_nav_reset(full=True)

    mode_label = "경로 역주행" if mode == "retrace" else "자율 주행"
    origin_name = origin.get("name", f"({origin['x']:.1f}, {origin['y']:.1f})")
    log_event("schedule", "return_to_work",
              f"작업 복귀 시작 ({mode_label}): {origin_name}(으)로 이동",
              robot_id=get_robot_id(), robot_name=get_robot_name())

    navigation_send_next()
    return {
        "status": "ok",
        "msg": f"작업 복귀 시작 ({mode_label}) → {origin_name}",
        "mode": mode,
        "origin": origin_name,
    }
