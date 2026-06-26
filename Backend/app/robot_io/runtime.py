"""
인메모리 로봇 런타임 상태 관리 모듈.

DB에 저장하지 않는 실시간 데이터(배터리, 위치, 네트워크 상태)를
로봇별로 관리한다. 스레드 안전.
"""

import json
import time
import threading
from typing import Optional

# ── 상수 ──────────────────────────────────────────────
# 네트워크 판정 임계 (혼잡 무선 대응 — 비대칭 히스테리시스).
# heartbeat가 하나만 새로 도착해도 즉시 Online으로 복귀하지만, Offline 확정은
# 느리게 둔다. 전시장처럼 패킷 손실이 잦은 무선에서 일시 유실로 카드가
# Offline↔Online으로 깜빡이는 것을 막기 위함.
ONLINE_MAX_AGE = 12     # ≤12초 → Online
ERROR_MAX_AGE = 35      # 12~35초 → Error(불안정, 직전 상태 유지), >35초 → Offline

_DUAL_BATTERY_TYPES = {"기본 4족", "순찰 4족", "보안 4족"}

def _is_dual_battery(robot_type: str) -> bool:
    """한글 로봇타입 기준으로 듀얼 배터리(L/R) 여부 판별."""
    return (robot_type or "") in _DUAL_BATTERY_TYPES


def battery_percent(battery: dict, robot_type: str) -> Optional[int]:
    """배터리 잔량(%) 추출. 듀얼은 더 낮은 셀 기준(보수적). 값이 없으면 None."""
    if _is_dual_battery(robot_type):
        vals = [int(v) for v in (battery.get("BatteryLevelLeft"),
                                 battery.get("BatteryLevelRight")) if v is not None]
        return min(vals) if vals else None
    soc = battery.get("SOC")
    return int(soc) if soc is not None else None


# 배터리 오독 필터 — 혼잡 무선에서 receiver가 통신 끊김 순간 0/디폴트값을 흘려
# 정상값(예: 99%) 위에 0%가 덮어써지고, 이로 인해 헛 자동 충전복귀가 트리거되는
# 것을 막는다. 물리적으로 가능한 최대 방전 속도를 넘는 '직전 정상값 대비 급락'은
# 측정 오류로 보고 직전 정상값을 유지한다(진짜 방전은 점진적이라 통과된다).
BATTERY_MAX_DRAIN_PCT_PER_SEC = 0.2   # 사실상 상한(실제 4족 부하 방전 ~1~2%/분보다 큼)
BATTERY_DRAIN_MARGIN_PCT = 5          # 측정 양자화/지터 여유

# 콜드스타트 디바운스 — 신뢰할 직전 정상값이 전혀 없는 상태(DB 이력 없는 신규 로봇,
# 첫 heartbeat)에서 임계치 이하(특히 0%) reading은 통신 오독일 수 있으므로
# N회 연속 확인된 뒤에야 채택한다. 진짜 저전력이면 N회 연속 관측되어 통과된다.
BATTERY_LOW_CONFIRM_COUNT = 3

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
                "limit_battery": int(r.LimitBattery) if r.LimitBattery is not None else 30,
                "position": {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0},
                "battery": {},
                "charge_state": {"state": 0, "error_code": 0, "timestamp": 0},
                "device_temp": {},
                "basic_status": {},  # {Sleep, PowerManagement} — 1002/6 응답
                "abnormal_codes": set(),  # 현재 활성 errorCode 집합 — 1002/3 응답(차집합 감지용)
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
                # 배터리 오독 필터를 DB 복원값으로 미리 무장한다.
                # 이걸 안 하면 재시작 후 첫 heartbeat가 콜드스타트로 취급돼
                # 급락 필터가 동작하지 않는다.
                restored_pct = battery_percent(entry["battery"], r.RobotType)
                if restored_pct is not None:
                    entry["_last_good_battery_pct"] = restored_pct
                    entry["_last_good_battery_ts"] = entry["last_heartbeat"]
                restored += 1

            _runtime[r.id] = entry
        print(f"[OK] robot_runtime 초기화 완료: {len(_runtime)}대 (DB 복원: {restored}대)")


# ── 상태 업데이트 ─────────────────────────────────────

def update_status(robot_id: int, battery: dict, timestamp: float,
                   charge_state: dict | None = None,
                   device_temp: dict | None = None,
                   basic_status: dict | None = None,
                   gait: int | None = None,
                   abnormal_status: list | None = None) -> None:
    """heartbeat 수신 시 배터리, 충전 상태, 디바이스 온도, 기본 상태(Sleep/PowerManagement), 보행(gait), 비정상 에러(abnormal_status) 갱신."""
    charge_log_payload = None  # 락 밖에서 처리할 charge_state 변화 정보
    battery_glitch_payload = None  # 락 밖에서 처리할 배터리 오독 감지 정보
    abnormal_payloads = []  # 락 밖에서 처리할 (code, component, appeared) 리스트
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return
        # 응답이 도달했으면 last_heartbeat는 항상 갱신.
        # battery는 빈 dict로 왔을 때 기존 값을 덮어쓰지 않도록 한다.
        entry["last_heartbeat"] = timestamp
        if battery:
            # 배터리 오독 필터.
            #  - 워밍(직전 정상값 있음): 물리적으로 불가능한 급락(예: 99%→0%)은 오독으로 무시.
            #  - 콜드스타트(직전 정상값 없음): 임계치 이하 reading은 N회 연속 확인 전엔 보류.
            # 진짜 방전은 단계가 작거나 N회 연속 관측되므로 실제 저전력은 그대로 감지된다.
            new_pct = battery_percent(battery, entry.get("robot_type", ""))
            prev_pct = entry.get("_last_good_battery_pct")
            prev_ts = entry.get("_last_good_battery_ts", 0.0)
            limit = int(entry.get("limit_battery") or 0)

            hold_reason = None  # None=채택, "glitch"=급락 오독, "pending"=콜드 미확인
            if new_pct is not None and prev_pct is not None:
                elapsed = max(timestamp - prev_ts, 1.0)
                max_drop = BATTERY_MAX_DRAIN_PCT_PER_SEC * elapsed + BATTERY_DRAIN_MARGIN_PCT
                if (prev_pct - new_pct) > max_drop:
                    hold_reason = "glitch"
            elif new_pct is not None and prev_pct is None and limit > 0 and new_pct <= limit:
                cnt = entry.get("_cold_low_count", 0) + 1
                entry["_cold_low_count"] = cnt
                if cnt < BATTERY_LOW_CONFIRM_COUNT:
                    hold_reason = "pending"

            if hold_reason == "glitch":
                # 직전 정상 배터리값 유지. 오독 구간 진입 시 1회만 DB 로그.
                if not entry.get("_battery_glitch_active"):
                    entry["_battery_glitch_active"] = True
                    battery_glitch_payload = (prev_pct, new_pct)
                print(f"[BATTERY] 오독 무시(급락): {prev_pct}% → {new_pct}% (직전 정상값 유지)")
            elif hold_reason == "pending":
                print(f"[BATTERY] 콜드스타트 저전력 미확인: {new_pct}% ≤ 임계치 {limit}% — "
                      f"{entry['_cold_low_count']}/{BATTERY_LOW_CONFIRM_COUNT}회 확인 중(보류)")
            else:
                entry["battery"] = battery
                if new_pct is not None:
                    entry["_last_good_battery_pct"] = new_pct
                    entry["_last_good_battery_ts"] = timestamp
                entry["_cold_low_count"] = 0
                entry["_battery_glitch_active"] = False
        if charge_state:
            # charge_state 변화 감지 (도킹 실패 원인 진단용)
            prev_cs = entry.get("charge_state") or {}
            prev_state = prev_cs.get("state")
            prev_err = prev_cs.get("error_code")
            new_state = charge_state.get("state")
            new_err = charge_state.get("error_code")
            if prev_state != new_state or prev_err != new_err:
                charge_log_payload = (prev_state, new_state, prev_err, new_err)
            entry["charge_state"] = charge_state
        if basic_status is not None:
            # None이 들어올 수 있으므로 기존 값 유지 방식으로 병합
            merged = dict(entry.get("basic_status") or {})
            for k in ("Sleep", "PowerManagement", "MotionState"):
                v = basic_status.get(k)
                if v is not None:
                    merged[k] = v
            entry["basic_status"] = merged
        if gait is not None:
            entry["gait"] = gait
        if abnormal_status is not None:
            # 활성 에러 코드 집합의 변화(발생/해소)만 감지 → 2Hz 폭주 없이 전이 순간만 로깅.
            # errorCode는 10진/"0x" 문자열 모두 방어적으로 int 변환.
            new_map: dict[int, object] = {}
            for e in abnormal_status:
                try:
                    raw = e.get("errorCode")
                    if raw is None:
                        continue
                    code = int(raw, 16) if isinstance(raw, str) and raw.lower().startswith("0x") else int(raw)
                    new_map[code] = e.get("component")
                except (ValueError, TypeError, AttributeError):
                    continue
            new_codes = set(new_map)
            prev_codes = entry.get("abnormal_codes", set())
            appeared = new_codes - prev_codes
            resolved = prev_codes - new_codes
            if appeared or resolved:
                abnormal_payloads = (
                    [(c, new_map.get(c), True) for c in appeared]
                    + [(c, None, False) for c in resolved]
                )
            entry["abnormal_codes"] = new_codes

        # is_charging 디바운스: 충전→비충전 전환은 5회 연속 확인 후 반영.
        # 오독으로 거부된 배터리 대신 채택된(직전 정상 포함) 값으로 판정한다.
        now_charging = _check_charging(entry["battery"])
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

        # 도크 점유(충전 완료 후 충전소 대기) 추적 — '충전 해제(언도킹)' 버튼 노출용.
        #  · 충전 중/도킹 진행(state 1·2) → 도크에 물림 (set)
        #  · 주행 시작 → 도크를 떠남 (clear)
        #  · 그 외(완충 후 비충전·비주행) → 직전 값 유지
        # 위치 기반 판정은 좌표 부정확 + '자율주행 후 충전소 근처 정지' 오판이 있어 쓰지 않는다.
        cur_state = (charge_state or {}).get("state", entry.get("charge_state", {}).get("state", 0))
        if now_charging or cur_state in (1, 2):
            entry["_docked_idle"] = True
        elif cur_state == 3:
            # 부두에서 나가기(state 3) = 로봇이 도크를 떠나는 중 → 점유 해제
            entry["_docked_idle"] = False
        else:
            try:
                from app.navigation.send_move import is_nav_active
                if is_nav_active():
                    entry["_docked_idle"] = False
            except Exception:
                pass

        if device_temp:
            entry["device_temp"] = device_temp

    # 락 밖에서 배터리 오독 감지 로그 (오독 구간 진입 시 1회만)
    if battery_glitch_payload is not None:
        prev_pct, new_pct = battery_glitch_payload
        try:
            from app.logs.service import log_event
            from app.user_cache import get_robot_name, get_robot_business_id
            log_event(
                "error", "battery_misread",
                f"배터리 오독 감지 — {prev_pct}% → {new_pct}% 무시(직전 정상값 유지)",
                detail="통신 불안정 구간의 순간 측정 오류로 추정. 자동 충전복귀 오발동 방지를 위해 무시함.",
                robot_id=robot_id, robot_name=get_robot_name(), business_id=get_robot_business_id(),
            )
        except Exception as e:
            print(f"[WARN] battery_misread 로그 실패: {e}")

    # 락 밖에서 charge_state 변화 로그 처리 (락 보유 시간 최소화)
    if charge_log_payload is not None:
        prev_state, new_state, prev_err, new_err = charge_log_payload
        state_label = _CHARGE_STATE_LABEL.get(new_state, f"unknown({new_state})")
        err_code = new_err if new_err is not None else 0
        err_label = _CHARGE_ERROR_MSG.get(new_err, f"unknown(0x{err_code:04X})")
        print(
            f"[CHARGE] state {prev_state}→{new_state} ({state_label}), "
            f"error_code={new_err} ({err_label})"
        )
        # 비정상 상태(4=로봇 오류, 5=도크에 있지만 전류 없음)나 신규 실에러 코드는 DB에도 기록
        is_abnormal_state = new_state in (4, 5)
        is_real_error = new_err not in (None, 0, 1) and prev_err != new_err
        if is_abnormal_state or is_real_error:
            try:
                from app.logs.service import log_event
                from app.user_cache import get_robot_name, get_robot_business_id
                log_event(
                    "robot",
                    "charge_state_change",
                    f"충전 상태: {state_label} / 에러 코드={new_err} ({err_label})",
                    robot_id=robot_id,
                    robot_name=get_robot_name(),
                    business_id=get_robot_business_id(),
                )
            except Exception as e:
                print(f"[WARN] charge_state DB 로그 실패: {e}")

    # 락 밖에서 비정상 에러(abnormal_status) 발생/해소 로그 처리.
    # 코드를 error_codes 테이블·부위 분류와 매칭해 "어디서 난 오류인지"를 메시지에 담는다.
    if abnormal_payloads:
        try:
            from app.robot_io.error_codes import ROBOT_ERROR_CODES, get_error_category
            from app.logs.service import log_event
            from app.user_cache import get_robot_name, get_robot_business_id
            rname = get_robot_name()
            rbiz = get_robot_business_id()
        except Exception as e:
            print(f"[WARN] abnormal_status 로그 준비 실패: {e}")
            ROBOT_ERROR_CODES = None

        if ROBOT_ERROR_CODES is not None:
            for code, comp, appeared in abnormal_payloads:
                category = get_error_category(code)
                comp_suffix = f" (부위: {comp})" if comp else ""
                err_hex = f"0x{code:04X}"
                if appeared:
                    if code in ROBOT_ERROR_CODES:
                        msg = ROBOT_ERROR_CODES[code]
                        if msg is None:   # 0x0000 등 정상값 — 알림 안 함
                            continue
                    else:
                        msg = f"미등록 코드({err_hex})"
                    try:
                        log_event(
                            "error", "robot_error_code",
                            f"[{category}] {msg}{comp_suffix}",
                            detail=f"부위: {comp}" if comp else None,
                            error_json=json.dumps(
                                {"error_code": err_hex, "category": category, "component": comp},
                                ensure_ascii=False),
                            robot_id=robot_id, robot_name=rname, business_id=rbiz,
                        )
                    except Exception as e:
                        print(f"[WARN] robot_error_code 로그 실패: {e}")
                else:
                    # 해소 — 로그만 남기고 알림은 띄우지 않음(설계서 §5 MVP)
                    label = ROBOT_ERROR_CODES.get(code) or err_hex
                    try:
                        log_event(
                            "robot", "robot_error_resolved",
                            f"[{category}] {label} 해소",
                            error_json=json.dumps(
                                {"error_code": err_hex, "category": category}, ensure_ascii=False),
                            robot_id=robot_id, robot_name=rname, business_id=rbiz,
                        )
                    except Exception as e:
                        print(f"[WARN] robot_error_resolved 로그 실패: {e}")


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
    """last_heartbeat 기준 네트워크 상태 판정 (임계는 ONLINE_MAX_AGE/ERROR_MAX_AGE).
    - 한 번도 heartbeat 없으면 → "-" (미확인)
    - ONLINE_MAX_AGE 이내 → "Online"
    - ONLINE_MAX_AGE ~ ERROR_MAX_AGE → "Error" (불안정 과도기, 직전 상태 유지)
    - ERROR_MAX_AGE 초과 → "Offline"
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


def _is_at_dock(is_charging: bool, charge_st: int, is_navigating: bool, docked_idle: bool) -> bool:
    """로봇이 충전소 도킹을 점유 중인지 판정 — '충전 해제(언도킹)' 버튼 노출 조건.

    = 자율 충전 중 OR 완충 후 충전소 위치 대기. (그 외는 '충전소 이동')
    - **주행 중이면 도크 점유가 아니다** → False.
    - 충전 중이거나 도킹 진행/충전 상태(state 1=부두로 이동, 2=충전 중)면 점유.
    - 완충 후 대기(비충전·비주행)는 `docked_idle`(충전 이력 추적, update_status)로 판정.
      위치(좌표) 기반은 부정확 + '자율주행 후 충전소 근처 정지' 오판이 있어 쓰지 않는다.
    """
    if is_navigating:
        return False
    if is_charging or charge_st in (1, 2):
        return True
    return docked_idle


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
    is_nav = _check_navigating(entry["robot_id"])
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
        # 현재 보행 — Standard: 0x1001 기본/0x1002 고장애물/0x1003 계단/0xf001 자세, Agile: 0x300X
        "gait": entry.get("gait"),
        "is_charging": entry.get("_is_charging", False),
        # 도킹 점유 여부 — 충전 중 또는 완충 후 충전소 위치 대기(비주행)일 때 True.
        # 관제 UI가 '충전 해제(언도킹)' 버튼 노출 조건으로 사용. 주행 중이면 False.
        "at_dock": _is_at_dock(entry.get("_is_charging", False), charge_st, is_nav,
                               entry.get("_docked_idle", False)),
        "charge_state": charge_st,
        "charge_state_label": _CHARGE_STATE_LABEL.get(charge_st, f"알 수 없음({charge_st})"),
        "charge_error_code": charge_err,
        "charge_error_msg": _CHARGE_ERROR_MSG.get(charge_err, f"알 수 없는 오류(0x{charge_err:04X})") if charge_st == 4 else None,
        "is_navigating": is_nav,
        "current_floor_id": entry.get("current_floor_id"),
        "current_map_id": entry.get("current_map_id"),
        # 위치 미초기화(자동 init_pose 수렴 실패) — True 면 위치 좌표 신뢰불가·자율주행 보류
        "initpose_pending": bool(entry.get("_initpose_pending", False)),
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


def get_charge_state(robot_id: int) -> int:
    """로봇의 현재 충전 상태머신 state 반환.
    0=대기, 1=부두로 이동, 2=충전 중, 3=부두에서 나가기, 4=오류, 5=부두·전류없음.
    """
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return 0
        return (entry.get("charge_state") or {}).get("state", 0)


def clear_charge_state(robot_id: int) -> None:
    """충전 상태를 능동적으로 '대기(0)'로 클리어.

    언도킹(도킹 이탈) 확정 시점에 호출한다. 로봇 ROS2 `/CHARGE_STATUS` 전환
    통보가 누락돼도 `is_charging`/`charge_state` 가 stale(충전 중)로 고정되지
    않도록 백엔드가 능동적으로 떨어뜨리는 fail-safe.
    """
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return
        entry["_is_charging"] = False
        entry["_charging_drop_count"] = 0
        entry["_docked_idle"] = False  # 언도킹 = 도크 떠남 → 도크 점유 해제
        cs = dict(entry.get("charge_state") or {})
        cs["state"] = 0
        entry["charge_state"] = cs


def update_floor(robot_id: int, floor_id: int, map_id: int = None) -> None:
    """로봇의 현재 층/맵 변경."""
    with _lock:
        entry = _runtime.get(robot_id)
        if entry:
            entry["current_floor_id"] = floor_id
            if map_id is not None:
                entry["current_map_id"] = map_id


# ── init_pose 미초기화(localization 신뢰불가) 플래그 ──────
# 전원 on 자동 init_pose 가 끝내 수렴에 실패하면(escalation) True 로 세팅된다.
# True 인 동안 해당 로봇의 위치 좌표는 신뢰할 수 없으므로 자율주행을 보류한다(안전 가드).
# 수동/자동 init_pose 가 수렴 성공하면 False 로 해제된다.

def set_initpose_pending(robot_id: int, pending: bool, reason: str = "") -> None:
    """init_pose 미초기화 상태 set/clear. 자율주행 안전 가드의 기준."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return
        entry["_initpose_pending"] = bool(pending)
        entry["_initpose_reason"] = reason if pending else ""


def is_initpose_pending(robot_id: int) -> bool:
    """해당 로봇의 위치가 미초기화(신뢰불가) 상태인지."""
    if robot_id is None:
        return False
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return False
        return bool(entry.get("_initpose_pending", False))


def get_position(robot_id: int) -> dict:
    """단일 로봇 위치 조회."""
    with _lock:
        entry = _runtime.get(robot_id)
        if not entry:
            return {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}
        return {
            "robot_id": entry["robot_id"],
            "robot_name": entry["robot_name"],
            "initpose_pending": bool(entry.get("_initpose_pending", False)),
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
    limit = int(robot.LimitBattery) if robot.LimitBattery is not None else 30
    with _lock:
        existing = _runtime.get(robot.id)
        if existing:
            existing["robot_name"] = robot.RobotName or ""
            existing["robot_type"] = robot.RobotType or ""
            existing["robot_ip"] = robot.RobotIP
            existing["robot_port"] = robot.RobotPort or 30000
            existing["limit_battery"] = limit
        else:
            _runtime[robot.id] = {
                "robot_id": robot.id,
                "robot_name": robot.RobotName or "",
                "robot_type": robot.RobotType or "",
                "robot_ip": robot.RobotIP,
                "robot_port": robot.RobotPort or 30000,
                "current_floor_id": robot.CurrentFloorId,
                "current_map_id": getattr(robot, "CurrentMapId", None),
                "limit_battery": limit,
                "position": {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0},
                "battery": {},
                "charge_state": {"state": 0, "error_code": 0, "timestamp": 0},
                "device_temp": {},
                "basic_status": {},
                "abnormal_codes": set(),
                "last_heartbeat": 0,
                "nav": {"arrived": False, "last_state": None, "timestamp": 0},
            }
        print(f"[OK] 런타임 갱신: robot_id={robot.id}, name={robot.RobotName}")
