"""모터/드라이버 온도 모니터링.

STATUS 응답의 DeviceTemperature(polling.status_thread에서 수집)에서 온도값을
추출해 과열 시 실시간 로그(stdout → docker logs)와, 위험 수준에서는 DB 이벤트/
알림을 남긴다.

DeviceTemperature 구조는 로봇 펌웨어가 그대로 내려주는 값이라 키 이름이 환경마다
다를 수 있다. 따라서 특정 키에 의존하지 않고 숫자 온도값을 재귀적으로 추출한 뒤
모터/드라이버/조인트 관련 센서만 임계값과 비교한다. 모터 키워드가 하나도 없으면
전체 온도의 최고값으로 폴백한다.
"""

import time

from app.robot_io.config import (
    MOTOR_TEMP_WARN_C,
    MOTOR_TEMP_CRITICAL_C,
    MOTOR_TEMP_VALID_MAX_C,
    MOTOR_TEMP_WARN_LOG_INTERVAL_SEC,
)

# 모터/드라이버/조인트로 간주할 센서 키 토큰(소문자/원문 비교).
_MOTOR_KEY_TOKENS = ("motor", "driver", "drive", "joint", "모터", "드라이버", "조인트")

# 최초 수신 구조를 1회만 출력하기 위한 플래그.
_structure_logged = False
# robot_id → 마지막 경고 stdout 로그 시각(폴링 스팸 방지).
_last_warn_log: dict[int, float] = {}


def _extract_temps(device_temp) -> list[tuple[str, float]]:
    """중첩 dict/list를 순회하며 (센서경로, 온도값) 쌍을 추출한다.

    0 이하 또는 비정상 과대값(센서 오류 추정)은 제외한다.
    """
    out: list[tuple[str, float]] = []

    def walk(prefix: str, obj) -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                walk(f"{prefix}.{key}" if prefix else str(key), value)
        elif isinstance(obj, list):
            for idx, value in enumerate(obj):
                walk(f"{prefix}[{idx}]", value)
        elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
            out.append((prefix, float(obj)))

    walk("", device_temp or {})
    return [(name, val) for name, val in out if 0 < val < MOTOR_TEMP_VALID_MAX_C]


def _is_motor_sensor(name: str) -> bool:
    """센서 경로 이름이 모터/드라이버/조인트 관련인지 판정한다."""
    low = name.lower()
    return any(token in low for token in _MOTOR_KEY_TOKENS)


def check_and_log_thermal(robot_id: int, device_temp: dict) -> None:
    """모터 온도 과열을 검사하고 실시간 로그를 남긴다.

    - 경고(WARN) 이상: stdout 로그(센서별 온도). 폴링 스팸 방지를 위해
      robot 단위로 최소 간격(MOTOR_TEMP_WARN_LOG_INTERVAL_SEC)을 둔다.
    - 위험(CRITICAL) 이상: stdout + DB 이벤트(robot_error_code 유형 → 알림 자동
      생성). DB 측 중복 억제는 logs.service의 30초 쿨다운이 담당한다.

    Args:
        robot_id: 대상 로봇 ID.
        device_temp: STATUS 응답의 DeviceTemperature dict.
    """
    global _structure_logged

    if not device_temp:
        return

    # 최초 수신 시 실제 키 구조를 1회 출력해 운영자가 센서 이름을 파악하도록 돕는다.
    if not _structure_logged:
        _structure_logged = True
        print(f"[THERMAL] DeviceTemperature 최초 수신 구조: {device_temp}")

    temps = _extract_temps(device_temp)
    if not temps:
        return

    motor_temps = [(n, v) for n, v in temps if _is_motor_sensor(n)]
    candidates = motor_temps or temps  # 모터 키워드 없으면 전체 온도로 폴백

    hot = [(n, v) for n, v in candidates if v >= MOTOR_TEMP_WARN_C]
    if not hot:
        return

    hot.sort(key=lambda item: item[1], reverse=True)
    peak_name, peak_val = hot[0]
    detail = ", ".join(f"{n}={v:.1f}°C" for n, v in hot)

    if peak_val >= MOTOR_TEMP_CRITICAL_C:
        print(f"🔥 [THERMAL] 모터 과열 위험! {peak_name}={peak_val:.1f}°C "
              f"(임계 {MOTOR_TEMP_CRITICAL_C}°C) — {detail}")
        try:
            from app.logs.service import log_event
            from app.user_cache import get_robot_name, get_robot_business_id
            log_event(
                "error", "robot_error_code",
                f"모터 과열 위험: {peak_name}={peak_val:.1f}°C",
                detail=f"임계 {MOTOR_TEMP_CRITICAL_C}°C 초과",
                error_json=detail,
                robot_id=robot_id,
                robot_name=get_robot_name(),
                business_id=get_robot_business_id(),
            )
        except Exception as exc:
            print(f"[THERMAL] DB 로그 실패: {exc}")
    else:
        now = time.time()
        if now - _last_warn_log.get(robot_id, 0) >= MOTOR_TEMP_WARN_LOG_INTERVAL_SEC:
            _last_warn_log[robot_id] = now
            print(f"⚠️ [THERMAL] 모터 온도 경고: {peak_name}={peak_val:.1f}°C "
                  f"(경고 {MOTOR_TEMP_WARN_C}°C) — {detail}")
