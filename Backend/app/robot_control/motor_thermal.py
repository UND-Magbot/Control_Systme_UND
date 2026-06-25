"""모터 과열 감지 및 보호 로직.

receiver STATUS 응답의 DeviceTemperature(관절별 모터 온도)를 임계값과 비교한다.
운영 로그(m20_motor_temp) 분석 결과 정상 관절 피크는 ~65°C, 이상 관절(RightBackHipY)이
89°C까지 관측되어 아래 임계를 잡았다.

- 경고(WARN, 75°C): 알림만. 정상 운영에서도 75~80°C는 흔히 머무는 밴드라 작업을
    중단시키지 않고 운영자 인지만 한다.
- 보호(DANGER, 80°C): 알림 + 보호 동작. 작업 중이면 현재 포인트까지 수행 후 충전소
    도킹 루트(ch-N→ch-1)로 이동해 도킹 포인트에서 SIT(충전은 안 함 — 모터 부하 제거/냉각).
    보호 동작은 charge 모듈에 위임. (75를 건너뛰고 80에 바로 도달해도 여기서 보호된다.)
- 회복: 70°C 미만(히스테리시스)으로 떨어지면 정상 복귀(해소 로그).

단발 센서 글리치를 거르기 위해 임계 초과/미만을 CONSEC_CONFIRM 회 연속 확인한 뒤에만
레벨을 전이한다(배터리 오독 필터와 동일 사상).
"""

import threading

# ── 임계값 (운영 로그 기반) ──────────────────────────
MOTOR_WARN_TEMP = 75.0      # 경고(알림만): 정상 피크(~65°C) + 마진. 75~80은 흔한 밴드라 작업 유지
MOTOR_DANGER_TEMP = 80.0    # 보호 동작: 충전소 도킹 루트 복귀 후 SIT (75~80 정상밴드 위에서만 개입)
MOTOR_RECOVER_TEMP = 70.0   # 이 아래로 떨어져야 정상 복귀(히스테리시스)
CONSEC_CONFIRM = 3          # N회 연속 확인 후 레벨 전이(글리치 차단)

_MOTOR_SUFFIX = "Motor"

_lock = threading.Lock()
# robot_id -> { joint -> {"level": "normal"|"warn"|"danger", "hot": int, "danger": int, "cool": int} }
_state: dict[int, dict] = {}


def _extract_motor_temps(device_temp: dict) -> dict[str, float]:
    """DeviceTemperature에서 관절 모터 온도만 {관절명: 온도}로 추출(드라이버/배열 제외)."""
    temps: dict[str, float] = {}
    for k, v in (device_temp or {}).items():
        if not isinstance(k, str) or not k.endswith(_MOTOR_SUFFIX) or k == _MOTOR_SUFFIX:
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        temps[k[: -len(_MOTOR_SUFFIX)]] = float(v)
    return temps


def check_motor_overheat(robot_id: int, device_temp: dict) -> None:
    """heartbeat마다 호출 — 관절별 모터 온도 임계 비교 후 경고/위험 전이 시 알림·보호.

    레벨 전이(정상↔경고↔위험)는 CONSEC_CONFIRM 회 연속 확인 시에만 발생하며,
    전이 순간 1회만 알림을 발화한다(폭주 없음).
    """
    temps = _extract_motor_temps(device_temp)
    if not temps:
        return

    warn_events: list[tuple[str, float]] = []
    danger_events: list[tuple[str, float]] = []
    resolved_events: list[tuple[str, float]] = []

    with _lock:
        rstate = _state.setdefault(robot_id, {})
        for joint, t in temps.items():
            js = rstate.setdefault(joint, {"level": "normal", "hot": 0, "danger": 0, "cool": 0})
            js["danger"] = js["danger"] + 1 if t >= MOTOR_DANGER_TEMP else 0
            js["hot"] = js["hot"] + 1 if t >= MOTOR_WARN_TEMP else 0
            js["cool"] = js["cool"] + 1 if t < MOTOR_RECOVER_TEMP else 0
            lvl = js["level"]

            if js["danger"] >= CONSEC_CONFIRM and lvl != "danger":
                js["level"] = "danger"
                danger_events.append((joint, t))
            elif js["hot"] >= CONSEC_CONFIRM and lvl == "normal":
                js["level"] = "warn"
                warn_events.append((joint, t))
            elif js["cool"] >= CONSEC_CONFIRM and lvl != "normal":
                js["level"] = "normal"
                resolved_events.append((joint, t))

    if warn_events or danger_events or resolved_events:
        _emit(robot_id, warn_events, danger_events, resolved_events)


def _emit(robot_id, warn_events, danger_events, resolved_events) -> None:
    """락 밖에서 알림 발화 + 위험 시 보호 동작 트리거."""
    try:
        from app.logs.service import log_event
        from app.user_cache import get_robot_name, get_robot_business_id
        rname = get_robot_name()
        rbiz = get_robot_business_id()
    except Exception as e:
        print(f"[WARN] motor_overheat 로그 준비 실패: {e}")
        return

    for joint, t in warn_events:
        log_event("error", "motor_overheat_warning",
                  f"[모터 과열 경고] {joint} {t:.1f}°C (≥{MOTOR_WARN_TEMP:.0f}°C)",
                  robot_id=robot_id, robot_name=rname, business_id=rbiz)
    for joint, t in danger_events:
        log_event("error", "motor_overheat_danger",
                  f"[모터 과열 위험] {joint} {t:.1f}°C (≥{MOTOR_DANGER_TEMP:.0f}°C) — 충전소 도킹 후 SIT",
                  robot_id=robot_id, robot_name=rname, business_id=rbiz)
    for joint, t in resolved_events:
        log_event("robot", "motor_overheat_resolved",
                  f"[모터 과열 해소] {joint} {t:.1f}°C (<{MOTOR_RECOVER_TEMP:.0f}°C)",
                  robot_id=robot_id, robot_name=rname, business_id=rbiz)

    # 보호 동작은 80°C(danger)부터. 75~80°C는 경고만(작업 유지). 급상승으로 warn을 건너뛰고
    # 바로 danger에 도달한 경우에도 danger_events가 발생하므로 보호된다(중복은 charge에서 가드).
    if danger_events:
        try:
            from app.robot_control.charge import trigger_overheat_protection
            trigger_overheat_protection()
        except Exception as e:
            print(f"[ERR] 모터 과열 보호 트리거 실패: {e}")
