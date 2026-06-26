"""로봇 통신 네트워크 설정.

Docker 이미지를 다시 빌드하지 않고 현장 공유기/로봇망 IP를 맞출 수 있도록
환경변수를 우선 사용한다. 미설정 시 기존 운영 기본값으로 동작한다.
"""

import os


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        print(f"[ROBOT CONFIG] {name}={value!r} 값이 정수가 아니어서 기본값 {default} 사용")
        return default

# 로봇 본체 (ASDU 프로토콜 엔드포인트)
ROBOT_IP = _env_str("ROBOT_IP", "10.21.31.103")
ROBOT_PORT = _env_int("ROBOT_PORT", 30000)

# receiver.py (로봇 NOS에서 동작하는 중계기)
RECEIVER_IP = _env_str("RECEIVER_IP", _env_str("NOS_HOST", "10.21.31.106"))
RECEIVER_PORT = _env_int("RECEIVER_PORT", 40000)
# 신뢰성 명령(NAV) 전용 TCP 채널 포트. WiFi(PC↔NOS) 구간 패킷 유실/순단에
# 강하도록 NAV는 TCP로 보장 전송한다. receiver.py의 동일 상수와 반드시 일치해야 한다.
# STOP·긴급정지·폴링 등 지연 민감/손실 허용 트래픽은 RECEIVER_PORT(UDP)를 그대로 쓴다.
RECEIVER_TCP_PORT = _env_int("RECEIVER_TCP_PORT", 40001)

# PC 측 수신 포트
PC_PORT_POS = _env_int("PC_PORT_POS", 35000)
PC_PORT_STATUS = _env_int("PC_PORT_STATUS", 35001)
PC_PORT_NAV = _env_int("PC_PORT_NAV", 35002)

# 폴링 주기
REQ_INTERVAL_POS = 2.0
REQ_INTERVAL_HB = 1.0

# 기본 초기 pose
INIT_POSE = {"PosX": 3.965, "PosY": -2.395, "PosZ": 0.0, "Yaw": -1.664}

# ── 전원 자동 on(부팅) 시 init_pose 자동 주입 (ERR-07) ──
AUTO_INIT_POSE_ENABLED = True          # 자동 주입 기능 on/off
AUTO_INIT_POSE_COOLDOWN_SEC = 120      # 한 번 주입 후 재트리거 금지 구간(플래핑 방지)
AUTO_INIT_POSE_SETTLE_SEC = 3.0        # 주입 후 수렴 대기 시간
# 주입 좌표(도킹포인트 ch-1) 대비 허용 오차(수렴 성공 판정, m).
# 실측: 충전 도킹 시 로봇 scan-match 가 등록 도킹포인트에서 ~1.9m 떨어진 위치로 안정 수렴한다
# (등록 좌표 vs 로봇 측위 프레임 편차). 도킹 구역 안이면 정상으로 보고 2m 이내를 확정 처리한다.
# (이보다 더 벗어나면 비정상으로 보고 거부 → 수동 재조정.)
AUTO_INIT_POSE_VERIFY_TOLERANCE_M = 2.0
# 준비 대기 재시도: 부팅 직후 로봇은 INIT_POSE 를 timeout(미수락) 시키므로,
# status:ok ACK 가 올 때까지 일정 간격으로 재시도한다(= "받을 준비가 된 순간"에 주입).
AUTO_INIT_POSE_RETRY_INTERVAL_SEC = 5.0   # status:ok 못 받았을 때 재시도 간격
AUTO_INIT_POSE_READY_TIMEOUT_SEC = 90.0   # 이 시간 내 status:ok 못 받으면 escalation(수동 알림)
AUTO_INIT_POSE_MAX_CONVERGE_FAIL = 3      # ok 받았으나 수렴 실패가 N회면 escalation(수동 알림)
# 시드 후 '현재 좌표가 로봇 실위치인지' 신뢰 확인용 안정성 검사.
# 시드 직후 로봇은 idle(정지) 이므로 위치가 안정적이어야 한다. scan-match(라이다↔저장맵)가
# 시드를 인정하면 제자리, 불일치면 위치가 끌려가 움직인다 → EPS 이상 움직이면 좌표 신뢰불가.
# (dock_anchor 는 물리적으로 도킹 위치가 확정이라 이 검사를 건너뛴다.)
AUTO_INIT_POSE_STABILITY_SEC = 4.0        # 시드 후 위치 안정성 관찰 시간
AUTO_INIT_POSE_STABILITY_SAMPLES = 4      # 관찰 샘플 수
AUTO_INIT_POSE_STABILITY_EPS_M = 0.15     # idle 허용 이동량(이상이면 scan-match 불일치 의심)
# 시드(last_status)와 로봇 보고 위치가 다른데도 안정적이면 = off 중 옮겨졌고 로봇이 스스로
# 재측위한 것으로 보고 그 위치를 채택(update)한다. 단 (0,0,0) 부근이면 로봇이 시드를 무시하고
# 리셋값에 머문 것이므로 채택하지 않고 미초기화로 본다(원점 가드).
AUTO_INIT_POSE_ORIGIN_GUARD_M = 0.3       # 이 거리 안(원점 부근)이면 유효 위치로 채택 안 함
# 전원 on 직후 충전 감지가 1~2초 지연될 수 있어, 이 시간 동안 충전 여부를 기다린다.
# 끝까지 비충전이면 자동으로 위치를 못 잡으므로 '미확정 + 운영자 맵 클릭 지정' 으로 넘긴다.
AUTO_INIT_POSE_CHARGE_GRACE_SEC = 15.0

# ── 모터/드라이버 온도 모니터링 (STATUS 응답의 DeviceTemperature 검사) ──
# 운영 환경의 실제 모터 온도 특성에 맞게 조정한다. 단위는 로봇이 내려주는 값
# (일반적으로 °C) 기준이며, 최초 수신 시 thermal 모듈이 원본 구조를 1회 로깅한다.
MOTOR_TEMP_WARN_C = 60.0       # 경고 임계값(°C) — 실시간 stdout 로그
MOTOR_TEMP_CRITICAL_C = 75.0   # 위험 임계값(°C) — stdout + DB 이벤트/알림
MOTOR_TEMP_VALID_MAX_C = 200.0 # 이 값 초과는 비정상 센서값으로 보고 무시(오탐 방지)
MOTOR_TEMP_WARN_LOG_INTERVAL_SEC = 10.0  # 경고 stdout 로그 최소 간격(폴링 스팸 방지)
