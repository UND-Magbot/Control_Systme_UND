"""배터리 임계치 기반 자동 충전 복귀.

status_thread 가 매 heartbeat 마다 `check_battery_and_return(robot_id)` 를 호출한다.
정책:
  - 작업 중 (is_navigating=True):
      현재 회차만 끝내고 복귀. 무한 반복은 1회로 줄이고,
      유한 반복은 nav_loop_remaining=0 으로 만든 뒤 auto_return_to_charge=True.
      → 현재 회차 종료 시 polling.nav_thread 가 _return_to_charge_internal(cancel_running=False) 호출.
  - 비작업 중:
      즉시 _return_to_charge_internal(cancel_running=False) 호출.
  - 한 번 트리거 후 5분 쿨다운: 사용자가 수동 정지해도 즉시 재트리거 안 함.
  - 회복 조건(쿨다운 해제):
      ① 충전 진입(is_charging=True), 또는
      ② 배터리가 임계치보다 5%p 이상 높게 회복 (히스테리시스).
"""
from __future__ import annotations

import threading
import time

# 한 번 트리거 후 재시도까지의 최소 간격 (초). 사용자 수동 정지/복귀 취소 후
# 즉시 재트리거되는 것을 막는다. 충전 진입 시 자연스럽게 armed로 회복되므로
# 정상 흐름에선 이 쿨다운이 닿지 않는다.
COOLDOWN_SEC = 600

# 임계치 위로 이 정도(%) 회복돼야 다시 armed 처리. 임계치 근처에서 깜빡거리는
# 충전 시작/해제로 인한 재트리거 방지(히스테리시스).
RECOVERY_HYSTERESIS = 5

_lock = threading.Lock()
_state: dict[int, dict] = {}  # robot_id → {"armed": bool, "last_trigger_ts": float}


def _battery_pct(battery: dict, robot_type: str) -> int | None:
    """현재 배터리 % 추출. 듀얼은 더 낮은 셀을 기준으로(보수적)."""
    from app.robot_io.runtime import _is_dual_battery

    if _is_dual_battery(robot_type):
        left = battery.get("BatteryLevelLeft")
        right = battery.get("BatteryLevelRight")
        vals = [int(v) for v in (left, right) if v is not None]
        return min(vals) if vals else None
    soc = battery.get("SOC")
    return int(soc) if soc is not None else None


def check_battery_and_return(robot_id: int) -> None:
    """heartbeat 직후 호출. 조건 충족 시 자동 복귀 트리거."""
    import app.robot_io.runtime as runtime
    import app.navigation.send_move as nav_mod

    # 런타임 스냅샷 — 락 보유 시간 최소화
    with runtime._lock:
        entry = runtime._runtime.get(robot_id)
        if not entry:
            return
        battery = dict(entry.get("battery") or {})
        robot_type = entry.get("robot_type", "")
        is_charging = entry.get("_is_charging", False)
        limit = int(entry.get("limit_battery") or 30)
        basic = entry.get("basic_status") or {}
        sleep_val = basic.get("Sleep")

    # 로봇이 꺼져있으면(Sleep != 0) 트리거 의미 없음. 깨우는 책임 없음.
    if sleep_val != 0:
        return
    # LimitBattery <= 0 이면 기능 비활성으로 간주
    if limit <= 0:
        return

    bat_pct = _battery_pct(battery, robot_type)
    if bat_pct is None:
        return

    now = time.time()
    should_trigger = False

    with _lock:
        state = _state.setdefault(robot_id, {"armed": True, "last_trigger_ts": 0.0})

        # 회복 조건: 충전 진입 또는 임계치+히스테리시스 이상으로 회복 → armed 복원
        if is_charging or bat_pct >= limit + RECOVERY_HYSTERESIS:
            state["armed"] = True

        # 쿨다운 종료 → armed 복원
        if not state["armed"] and (now - state["last_trigger_ts"]) > COOLDOWN_SEC:
            state["armed"] = True

        # 트리거 조건: 임계치 이하 & 충전 중 아님 & armed
        if bat_pct <= limit and not is_charging and state["armed"]:
            state["armed"] = False
            state["last_trigger_ts"] = now
            should_trigger = True

    if not should_trigger:
        return

    # ── 실제 트리거 (락 밖) ──────────────────────────────────────
    from app.logs.service import log_event
    from app.user_cache import get_robot_name, get_robot_business_id

    robot_name = get_robot_name()
    business_id = get_robot_business_id()

    if nav_mod.is_navigating:
        # 진행 중인 경우: 현재 회차만 끝내고 복귀
        nav_mod.nav_loop_infinite = False
        nav_mod.nav_loop_remaining = 0
        nav_mod.auto_return_to_charge = True
        print(
            f"🔋 [AUTO-RETURN] 배터리 {bat_pct}% ≤ 임계치 {limit}% — "
            f"현재 회차 종료 후 충전소 자동 복귀 예약"
        )
        log_event(
            "robot", "auto_return_armed",
            f"배터리 {bat_pct}% (임계치 {limit}%) — 현재 작업 완료 후 충전소 복귀 예약",
            robot_id=robot_id, robot_name=robot_name, business_id=business_id,
        )
        return

    # 비작업: 즉시 복귀
    try:
        from app.robot_control.charge import _return_to_charge_internal
        print(
            f"🔋 [AUTO-RETURN] 배터리 {bat_pct}% ≤ 임계치 {limit}% — 즉시 충전소 복귀"
        )
        result = _return_to_charge_internal(cancel_running=False)
        log_event(
            "robot", "auto_return_triggered",
            f"배터리 {bat_pct}% (임계치 {limit}%) — 충전소 복귀 시작: {result.get('msg')}",
            robot_id=robot_id, robot_name=robot_name, business_id=business_id,
        )
        # 실패해도 쿨다운(last_trigger_ts)은 유지 — 충전소 미등록 등 영구적 실패에서
        # 매 heartbeat 마다 재시도해 로그가 폭주하는 것을 막는다. 10분 후 자연 재시도.
    except Exception as e:
        print(f"[AUTO-RETURN ERR] 자동 충전 복귀 실패: {e}")
