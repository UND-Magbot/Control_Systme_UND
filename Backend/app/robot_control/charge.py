"""충전 관련 엔드포인트: 충전소 이동 / 작업 정지 후 도킹 포인트 이동"""

import socket
import time

from fastapi import APIRouter

from app.database.database import SessionLocal
from app.database.models import LocationInfo
from app.user_cache import get_robot_id, get_robot_name
from app.logs.service import log_event

router = APIRouter()


@router.post("/robot/charge")
def start_charge():
    """충전소로 이동 (자동 충전) 명령 전송."""
    from app.robot_io import ROBOT_IP, ROBOT_PORT, build_packet

    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {
                "Charge": 1
            }
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        log_event("robot", "robot_charging_start", "충전소 이동 명령 전송",
                  robot_id=get_robot_id(), robot_name=get_robot_name())
        return {"status": "ok", "msg": "충전소 이동 명령 전송 완료"}
    except Exception as e:
        return {"status": "error", "msg": str(e)}
    finally:
        sock.close()


@router.post("/robot/return-to-charge")
def return_to_charge():
    """작업 복귀: 진행 중인 작업 정지 → 도킹 포인트로 이동 → 도착 후 충전 명령 자동 실행."""
    from app.navigation.send_move import navigation_send_next, _signal_nav_reset
    import app.navigation.send_move as nav
    from app.robot_io.sender import send_to_robot
    from app.scheduler.loop import cancel_active_schedule, get_active_schedule_id

    db = SessionLocal()
    try:
        # 충전소(category=charge) 찾기 → 도킹 포인트는 "{충전소이름}-1"
        charge_station = (
            db.query(LocationInfo)
            .filter(LocationInfo.Category == "charge")
            .first()
        )
        if not charge_station:
            return {"status": "error", "msg": "등록된 충전소가 없습니다."}

        dock_name = f"{charge_station.LacationName}-1"
        dock_point = (
            db.query(LocationInfo)
            .filter(LocationInfo.LacationName == dock_name)
            .first()
        )
        if not dock_point:
            return {"status": "error", "msg": f"도킹 포인트 '{dock_name}'을(를) 찾을 수 없습니다."}

        # 1) 진행 중인 스케줄 취소 (대기로 되돌림)
        if get_active_schedule_id() is not None:
            cancel_active_schedule("충전소 이동")

        # 2) 진행 중인 네비게이션 정지
        if nav.is_navigating:
            nav.is_navigating = False
            nav.current_wp_index = 0
            nav.nav_loop_remaining = 0
            nav.charge_on_arrival = False
            _signal_nav_reset(full=True)
            print("🛑 작업 복귀: 기존 네비게이션 정지")

        # 2) 로봇 정지 명령
        try:
            send_to_robot("STOP")
        except Exception as e:
            print(f"[WARN] STOP 전송 실패: {e}")

        time.sleep(1)  # 로봇 정지 대기

        # 3) 도킹 포인트로 네비게이션 + 도착 후 자동 충전 플래그
        nav.waypoints_list = [{
            "x": dock_point.LocationX,
            "y": dock_point.LocationY,
            "yaw": dock_point.Yaw or 0.0,
        }]
        nav.current_wp_index = 0
        nav.is_navigating = True
        nav.nav_loop_remaining = 0
        nav.charge_on_arrival = True
        _signal_nav_reset(full=True)

        print(f"🔋 작업 복귀: {dock_name} → x={dock_point.LocationX}, y={dock_point.LocationY}")
        log_event("schedule", "return_to_charge",
                  f"작업 복귀 시작: {dock_name}(으)로 이동",
                  robot_id=get_robot_id(), robot_name=get_robot_name())

        navigation_send_next()
        return {
            "status": "ok",
            "msg": f"{dock_name}(으)로 이동 시작 (도착 후 자동 충전)",
            "dock_point": dock_name,
            "charge_station": charge_station.LacationName,
        }
    finally:
        db.close()
