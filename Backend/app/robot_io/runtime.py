"""
인메모리 로봇 런타임 상태 관리 모듈.

DB에 저장하지 않는 실시간 데이터(배터리, 위치, 네트워크 상태)를
로봇별로 관리한다. 스레드 안전.
"""

import time
import threading
from typing import Optional

# ── 상수 ──────────────────────────────────────────────
ONLINE_MAX_AGE = 10     # ≤10초 → Online
ERROR_MAX_AGE = 12      # 10~12초 → Error (짧은 과도기), >12초 → Offline

_DUAL_BATTERY_TYPES = {"기본 4족", "순찰 4족", "보안 4족"}

def _is_dual_battery(robot_type: str) -> bool:
    """한글 로봇타입 기준으로 듀얼 배터리(L/R) 여부 판별."""
    return (robot_type or "") in _DUAL_BATTERY_TYPES

# ── 내부 저장소 ───────────────────────────────────────
_lock = threading.Lock()
_runtime: dict[int, dict] = {}      # robot_info.id → 런타임 상태


# ── 초기화 ────────────────────────────────────────────

def init_runtime(robots, last_statuses: Optional[dict] = None) -> None:
    """서버 시작 시 DB의 RobotInfo 목록으로 런타임 초기화.

    last_statuses: {robot_id: RobotLastStatus} — DB에서 읽은 마지막 상태.
    값이 있으면 인메모리 초기값으로 복원하여 서버 재시작 시 상태 유실을 방지.
    """
    last_statuses = last_statuses or {}
    with _lock:
        _runtime.clear()
        restored = 0
        for r in robots:
            entry = {
                "robot_id": r.id,
                "robot_name": r.RobotName or "",
                "robot_type": r.RobotType or "",
                "robot_ip": r.RobotIP,
                "robot_port": r.RobotPort or 30000,
                "current_floor_id": r.CurrentFloorId,
                "current_map_id": getattr(r, "CurrentMapId", None),
                "business_id": r.BusinessId,
                "position": {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0},
                "battery": {},
                "charge_state": {"state": 0, "error_code": 0, "timestamp": 0},
                "device_temp": {},
                "basic_status": {},  # {Sleep, PowerManagement} — 1002/6 응답
                "last_heartbeat": 0,
                "nav": {"arrived": False, "last_state": None, "timestamp": 0},
            }

            # DB에서 마지막 상태 복원
            ls = last_statuses.get(r.id)
            if ls and ls.LastHeartbeat:
                if _is_dual_battery(r.RobotType):
                    entry["battery"] = {
                        "BatteryLevelLeft": ls.BatteryLevel1,
                        "BatteryLevelRight": ls.BatteryLevel2,
                        "VoltageLeft": ls.Voltage1,
                        "VoltageRight": ls.Voltage2,
                        "battery_temperatureLeft": ls.BatteryTemp1,
                        "battery_temperatureRight": ls.BatteryTemp2,
                        "chargeLeft": bool(ls.IsCharging1),
                        "chargeRight": bool(ls.IsCharging2),
                    }
                else:
                    entry["battery"] = {
                        "SOC": ls.BatteryLevel1,
                        "Voltage": ls.Voltage1,
                        "BatteryTemp": ls.BatteryTemp1,
                        "Charging": bool(ls.IsCharging1),
                    }
                if ls.PosX is not None:
                    entry["position"] = {
                        "x": ls.PosX or 0.0,
                        "y": ls.PosY or 0.0,
                        "yaw": ls.PosYaw or 0.0,
                        "timestamp": 0,
                    }
                if ls.CurrentFloorId is not None:
                    entry["current_floor_id"] = ls.CurrentFloorId
                entry["last_heartbeat"] = ls.LastHeartbeat.timestamp()
                restored += 1

            _runtime[r.id] = entry
        print(f"[OK] robot_runtime 초기화 완료: {len(_runtime)}대 (DB 복원: {restored}대)")


# ── 상태 업데이트 ─────────────────────────────────────

def update_status(robot_id: int, battery: dict, timestamp: float,
                   charge_state: dict | None = None,
                   device_temp: dict | None = None,
                   basic_status: dict | None = None) -> None:
    """heartbeat 수신 시 배터리, 충전 상태, 디바이스 온도, 기본 상태(Sleep/PowerManagement) 갱신."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return
        # 응답이 도달했으면 last_heartbeat는 항상 갱신.
        # battery는 빈 dict로 왔을 때 기존 값을 덮어쓰지 않도록 한다.
        entry["last_heartbeat"] = timestamp
        if battery:
            entry["battery"] = battery
        if charge_state:
            entry["charge_state"] = charge_state
        if basic_status is not None:
            # None이 들어올 수 있으므로 기존 값 유지 방식으로 병합
            merged = dict(entry.get("basic_status") or {})
            for k in ("Sleep", "PowerManagement", "MotionState"):
                v = basic_status.get(k)
                if v is not None:
                    merged[k] = v
            entry["basic_status"] = merged

        # is_charging 디바운스: 충전→비충전 전환은 5회 연속 확인 후 반영
        now_charging = _check_charging(battery)
        if charge_state and charge_state.get("state", 0) == 2:
            now_charging = True
        was_charging = entry.get("_is_charging", False)

        if was_charging and not now_charging:
            drop = entry.get("_charging_drop_count", 0) + 1
            entry["_charging_drop_count"] = drop
            if drop >= 15:
                entry["_is_charging"] = False
                entry["_charging_drop_count"] = 0
        else:
            entry["_is_charging"] = now_charging
            entry["_charging_drop_count"] = 0

        if device_temp:
            entry["device_temp"] = device_temp


def update_position(robot_id: int, x: float, y: float, yaw: float) -> None:
    """위치 수신 시 좌표 갱신."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return
        entry["position"] = {
            "x": x,
            "y": y,
            "yaw": yaw,
            "timestamp": time.time(),
        }


def update_nav(robot_id: int, arrived: bool, last_state, timestamp: float) -> None:
    """네비게이션 상태 갱신."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return
        entry["nav"] = {
            "arrived": arrived,
            "last_state": last_state,
            "timestamp": timestamp,
        }


# ── 조회 ──────────────────────────────────────────────

def _derive_network(last_heartbeat: float) -> str:
    """last_heartbeat 기준 네트워크 상태 판정.
    - 한 번도 heartbeat 없으면 → "-" (미확인)
    - 5초 이내 → "Online"
    - 5~15초 → "Error"
    - 15초 초과 → "Offline"
    """
    if last_heartbeat == 0:
        return "-"
    age = time.time() - last_heartbeat
    if age <= ONLINE_MAX_AGE:
        return "Online"
    if age <= ERROR_MAX_AGE:
        return "Error"
    return "Offline"


def _derive_power(
    basic_status: dict | None,
    battery: dict | None = None,
    network: str | None = None,
) -> str:
    """전원 상태 도출 — Sleep=0이 현재 수신되고 있을 때만 On, 그 외 Off.

    규칙:
    - basic_status도 battery도 전혀 없음 → "-" (미확인)
    - 네트워크가 확정 Offline → "Off" (Sleep 값이 있어도 stale이므로 무시)
    - Sleep == 0 → "On" (로봇 켜져 있음)
    - 그 외 (Sleep != 0 또는 Sleep 없음) → "Off"
    """
    if not basic_status and not battery:
        return "-"
    # 네트워크가 끊어진 지 오래되면(Offline 확정) Sleep 값은 stale이므로 Off
    if network == "Offline":
        return "Off"
    sleep_val = (basic_status or {}).get("Sleep")
    return "On" if sleep_val == 0 else "Off"


def get_all_statuses() -> list[dict]:
    """전체 로봇 런타임 상태를 API 응답 형태로 반환."""
    with _lock:
        return [_build_status(entry) for entry in _runtime.values()]


_CHARGE_STATE_LABEL = {
    0: "대기",
    1: "부두로 이동",
    2: "충전 중",
    3: "부두에서 나가기",
    4: "로봇 오류",
    5: "부두에 있지만 전류가 흐르지 않음",
}

_CHARGE_ERROR_MSG = {
    0:    "재설정 작업/초기화",
    1:    "작전 성공",
    4098: "도킹 대상 지점 검색 중 시간 초과 발생(반사판 가림 시간 초과)",
    4099: "반사경 위치 지정 알고리즘을 시작하는 데 실패했습니다",
    4100: "도킹 목표 지점을 찾지 못했습니다(반사판 목표 지점 없음)",
    4101: "도킹 타임아웃",
    4102: "도킹 해제 시간 초과",
    4103: "충전 도크에서 전류가 흐르지 않습니다",
    4104: "소프트 비상 정지 작동됨",
}


def _build_status(entry: dict) -> dict:
    """내부 엔트리를 API 응답 형태로 변환."""
    network = _derive_network(entry["last_heartbeat"])
    basic_status = entry.get("basic_status") or {}
    battery = entry["battery"]
    power = _derive_power(basic_status, battery, network)
    sleep_val = basic_status.get("Sleep")
    power_mgmt = basic_status.get("PowerManagement")
    motion_state = basic_status.get("MotionState")
    cs = entry.get("charge_state", {})
    charge_st = cs.get("state", 0)
    charge_err = cs.get("error_code", 0)
    return {
        "robot_id": entry["robot_id"],
        "robot_name": entry["robot_name"],
        "robot_type": entry["robot_type"],
        "battery": battery,
        "network": network,
        "power": power,
        "sleep": sleep_val,
        # 0=regular(배터리 2개) / 1=single battery — 로봇이 켜진 상태(Sleep=0)일 때만 유효
        "power_management": power_mgmt if sleep_val == 0 else None,
        # 1=Stand, 4=Sit (로봇 자세)
        "motion_state": motion_state,
        "is_charging": entry.get("_is_charging", False),
        "charge_state": charge_st,
        "charge_state_label": _CHARGE_STATE_LABEL.get(charge_st, f"알 수 없음({charge_st})"),
        "charge_error_code": charge_err,
        "charge_error_msg": _CHARGE_ERROR_MSG.get(charge_err, f"알 수 없는 오류(0x{charge_err:04X})") if charge_st == 4 else None,
        "is_navigating": _check_navigating(entry["robot_id"]),
        "current_floor_id": entry.get("current_floor_id"),
        "current_map_id": entry.get("current_map_id"),
        "timestamp": entry["last_heartbeat"],
        "position": entry["position"],
    }


def _check_navigating(robot_id: int) -> bool:
    """현재 네비게이션 진행 중 여부.
    1순위: 메모리 (이 서버에서 시작한 작업)
    2순위: DB IsWorking (다른 서버에서 시작한 작업)
    """
    try:
        from app.navigation.send_move import is_nav_active
        if is_nav_active():
            return True
    except Exception:
        pass
    try:
        from app.database.database import SessionLocal
        from app.database.models import RobotLastStatus
        db = SessionLocal()
        try:
            row = db.query(RobotLastStatus.IsWorking).filter(
                RobotLastStatus.RobotId == robot_id
            ).first()
            return bool(row and row.IsWorking)
        finally:
            db.close()
    except Exception:
        return False


def _check_charging(battery: dict) -> bool:
    """배터리 딕셔너리에서 충전 여부 판정.
    - 일반 로봇: Charging 키
    - QUADRUPED: chargeLeft 또는 chargeRight 중 하나라도 True
    """
    if battery.get("Charging", False):
        return True
    if battery.get("chargeLeft", False) or battery.get("chargeRight", False):
        return True
    return False


# ── 유틸 ──────────────────────────────────────────────

def get_first_robot_id() -> Optional[int]:
    """등록된 첫 번째 로봇 ID 반환 (단일 로봇 환경 호환용)."""
    with _lock:
        if not _runtime:
            return None
        return next(iter(_runtime))


def get_robot_id_by_ip(ip: str) -> Optional[int]:
    """RobotIP가 일치하는 로봇 ID 반환."""
    with _lock:
        for rid, entry in _runtime.items():
            if entry.get("robot_ip") == ip:
                return rid
        return None


def get_business_id(robot_id: int) -> Optional[int]:
    """로봇의 사업장 ID 반환."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return None
        return entry.get("business_id")


def is_charging(robot_id: int) -> bool:
    """로봇이 충전 중인지 확인."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return False
        return entry.get("_is_charging", False)


def update_floor(robot_id: int, floor_id: int, map_id: int = None) -> None:
    """로봇의 현재 층/맵 변경."""
    with _lock:
        entry = _runtime.get(robot_id)
        if entry:
            entry["current_floor_id"] = floor_id
            if map_id is not None:
                entry["current_map_id"] = map_id


def get_position(robot_id: int) -> dict:
    """단일 로봇 위치 조회."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}
        return {
            "robot_id": entry["robot_id"],
            "robot_name": entry["robot_name"],
            **entry["position"],
        }


def get_nav(robot_id: int) -> dict:
    """단일 로봇 네비게이션 상태 조회."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return {"arrived": False, "last_state": None, "timestamp": 0}
        return dict(entry["nav"])


def add_or_update_robot(robot) -> None:
    """DB의 RobotInfo 객체로 런타임 엔트리 추가 또는 갱신 (서버 재시작 불필요)."""
    with _lock:
        existing = _runtime.get(robot.id)
        if existing:
            existing["robot_name"] = robot.RobotName or ""
            existing["robot_type"] = robot.RobotType or ""
            existing["robot_ip"] = robot.RobotIP
            existing["robot_port"] = robot.RobotPort or 30000
        else:
            _runtime[robot.id] = {
                "robot_id": robot.id,
                "robot_name": robot.RobotName or "",
                "robot_type": robot.RobotType or "",
                "robot_ip": robot.RobotIP,
                "robot_port": robot.RobotPort or 30000,
                "current_floor_id": robot.CurrentFloorId,
                "current_map_id": getattr(robot, "CurrentMapId", None),
                "position": {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0},
                "battery": {},
                "charge_state": {"state": 0, "error_code": 0, "timestamp": 0},
                "device_temp": {},
                "basic_status": {},
                "last_heartbeat": 0,
                "nav": {"arrived": False, "last_state": None, "timestamp": 0},
            }
        print(f"[OK] 런타임 갱신: robot_id={robot.id}, name={robot.RobotName}")
