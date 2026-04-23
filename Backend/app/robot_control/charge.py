"""충전 관련 엔드포인트: 충전소 이동 / 작업 정지 후 도킹 포인트 이동"""

import socket
import time

from fastapi import APIRouter

from app.database.database import SessionLocal
from app.database.models import LocationInfo
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id
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
                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        return {"status": "ok", "msg": "충전소 이동 명령 전송 완료"}
    except Exception as e:
        return {"status": "error", "msg": str(e)}
    finally:
        sock.close()


@router.post("/robot/stop-charge")
def stop_charge():
    """충전 해제 (Charge=0). 도킹 상태에서 충전을 해제한다."""
    from app.robot_io import ROBOT_IP, ROBOT_PORT, build_packet

    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {
                "Charge": 0
            }
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        log_event("robot", "robot_charging_stop", "충전 해제 명령 전송",
                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        return {"status": "ok", "msg": "충전 해제 명령 전송 완료"}
    except Exception as e:
        return {"status": "error", "msg": str(e)}
    finally:
        sock.close()


def _send_stop_charge_packet() -> bool:
    """stop-charge UDP 패킷만 전송 (상태 체크 없이). 내부 헬퍼."""
    from app.robot_io import ROBOT_IP, ROBOT_PORT, build_packet

    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {"Charge": 0},
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        return True
    except Exception as e:
        print(f"[WARN] stop-charge 전송 실패: {e}")
        return False
    finally:
        sock.close()


def prepare_undock_waypoints(
    max_wait_seconds: float = 20.0,
    poll_interval: float = 1.0,
) -> list[dict] | None:
    """작업 시작 전 충전 상태 확인 → 필요 시 해제 + 도킹 포인트 회전 웨이포인트 반환.

    로봇이 충전 중이면:
      1) stop-charge UDP 전송
      2) `runtime.is_charging` 이 False 가 될 때까지 `poll_interval` 초마다 폴링
         (최대 `max_wait_seconds` 초). 해제 확인되면 즉시 진행, 타임아웃이면 경고 로그 후 진행.
      3) 도킹 포인트(`<충전소>-1`) 에서 180° 회전 웨이포인트 1개 반환
         (해제 직후 로봇은 이미 도킹 포인트에 있으므로 이동 불필요 — 회전만)
    caller 는 반환된 preamble 을 자신의 작업 웨이포인트 앞에 붙여 nav_mod.waypoints_list 에 세팅.

    주의: is_charging 은 runtime 내부 디바운스(heartbeat 1초 간격, 연속 15회 필요) 적용된
    플래그라 물리적 해제 후에도 표시가 떨어지기까지 시간이 걸린다. 보통 10초 내에 해제
    신호가 반영되는 경우 정상 진행하고, 타임아웃이어도 진행해서 회전 명령을 보낸다.

    Returns:
        list[dict] — preamble 웨이포인트 (1개): 도킹 포인트에서 180° 회전
        None       — 충전 중 아님, 또는 도킹 포인트 데이터 미등록, 또는 실패
    """
    import math
    from app.robot_io import runtime
    from app.database.models import LocationInfo

    rid = get_robot_id()
    if not rid:
        return None

    try:
        charging = runtime.is_charging(rid)
    except Exception as e:
        print(f"[WARN] is_charging 조회 실패: {e}")
        return None
    if not charging:
        return None

    # 1) stop-charge 패킷 전송
    if not _send_stop_charge_packet():
        return None
    log_event(
        "robot", "charge_release_auto",
        "작업 시작 전 충전 자동 해제",
        robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id(),
    )
    print(f"🔋 stop-charge 전송 — 해제 확인 대기 (최대 {max_wait_seconds:.0f}s)")

    # 2) is_charging 이 False 가 될 때까지 폴링
    elapsed = 0.0
    released = False
    while elapsed < max_wait_seconds:
        time.sleep(poll_interval)
        elapsed += poll_interval
        try:
            if not runtime.is_charging(rid):
                released = True
                break
        except Exception as e:
            print(f"[WARN] is_charging 폴링 실패: {e}")
            break

    if released:
        print(f"🔋 충전 해제 확인됨 ({elapsed:.1f}s) — 도킹 포인트로 이동 시작")
    else:
        print(f"[WARN] {max_wait_seconds:.0f}s 내 충전 해제 미확인 — 그래도 진행 (로봇 상태 확인 필요)")
        log_event(
            "robot", "charge_release_timeout",
            f"충전 해제 타임아웃 ({max_wait_seconds:.0f}s)",
            robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id(),
        )

    # 3) 도킹 포인트 조회
    db = SessionLocal()
    try:
        charge_station = (
            db.query(LocationInfo)
            .filter(LocationInfo.Category == "charge")
            .first()
        )
        if not charge_station:
            print("[WARN] 등록된 충전소 없음 — 도킹 preamble 생략")
            return None
        dock_name = f"{charge_station.LacationName}-1"
        dock = (
            db.query(LocationInfo)
            .filter(LocationInfo.LacationName == dock_name)
            .first()
        )
        if not dock:
            print(f"[WARN] 도킹 포인트 '{dock_name}' 없음 — 도킹 preamble 생략")
            return None

        base_yaw = float(dock.Yaw or 0.0)
        # 180° 회전 yaw 계산, (-π, π] 로 정규화
        rotated_yaw = base_yaw + math.pi
        while rotated_yaw > math.pi:
            rotated_yaw -= 2 * math.pi
        while rotated_yaw <= -math.pi:
            rotated_yaw += 2 * math.pi

        # 해제 직후 로봇은 이미 도킹 포인트에 있으므로 이동 불필요 — 회전만
        preamble = [
            {
                "x": dock.LocationX,
                "y": dock.LocationY,
                "yaw": round(rotated_yaw, 3),
                "name": f"{dock_name} (180°)",
            },
        ]
        print(f"🔋 언도킹 preamble: {dock_name} 에서 180° 회전 후 작업 진행")
        return preamble
    finally:
        db.close()


def _return_to_charge_internal(cancel_running: bool = True) -> dict:
    """충전소 복귀 코어 로직.

    - cancel_running=True (수동 호출, /robot/return-to-charge):
      진행 중인 스케줄/네비게이션을 먼저 취소하고 STOP 명령을 보낸다.
    - cancel_running=False (작업 완료 후 자동 호출):
      네비게이션은 이미 종료된 상태이므로 바로 도킹 포인트 이동만 수행.

    Returns:
        {"ok": bool, "msg": str, "dock_point": str|None, "charge_station": str|None}
    """
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
            return {"ok": False, "msg": "등록된 충전소가 없습니다.",
                    "dock_point": None, "charge_station": None}

        dock_name = f"{charge_station.LacationName}-1"
        dock_point = (
            db.query(LocationInfo)
            .filter(LocationInfo.LacationName == dock_name)
            .first()
        )
        if not dock_point:
            return {"ok": False, "msg": f"도킹 포인트 '{dock_name}'을(를) 찾을 수 없습니다.",
                    "dock_point": None, "charge_station": charge_station.LacationName}

        if cancel_running:
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

            # 3) 로봇 정지 명령
            try:
                send_to_robot("STOP")
            except Exception as e:
                print(f"[WARN] STOP 전송 실패: {e}")

            time.sleep(1)  # 로봇 정지 대기

        # 도킹 포인트로 네비게이션 + 도착 후 자동 충전 플래그
        nav.waypoints_list = [{
            "x": dock_point.LocationX,
            "y": dock_point.LocationY,
            "yaw": dock_point.Yaw or 0.0,
            "name": dock_name,
        }]
        nav.current_wp_index = 0
        nav.is_navigating = True
        nav.nav_loop_remaining = 0
        nav.nav_loop_total = 0
        nav.charge_on_arrival = True
        nav.auto_return_to_charge = False  # 이미 복귀 중 — 중복 트리거 방지
        _signal_nav_reset(full=True)

        print(f"🔋 충전소 복귀 시작: {dock_name} → x={dock_point.LocationX}, y={dock_point.LocationY}")
        log_event("schedule", "return_to_charge",
                  f"충전소 복귀 시작: {dock_name}(으)로 이동",
                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

        navigation_send_next()
        return {
            "ok": True,
            "msg": f"{dock_name}(으)로 이동 시작 (도착 후 자동 충전)",
            "dock_point": dock_name,
            "charge_station": charge_station.LacationName,
        }
    finally:
        db.close()


@router.post("/robot/return-to-charge")
def return_to_charge():
    """작업 복귀: 진행 중인 작업 정지 → 도킹 포인트로 이동 → 도착 후 충전 명령 자동 실행."""
    result = _return_to_charge_internal(cancel_running=True)
    if result["ok"]:
        return {
            "status": "ok",
            "msg": result["msg"],
            "dock_point": result["dock_point"],
            "charge_station": result["charge_station"],
        }
    return {"status": "error", "msg": result["msg"]}
