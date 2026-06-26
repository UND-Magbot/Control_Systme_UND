"""위치·상태·네비게이션 폴링 스레드.

receiver.py(로봇 NOS에서 동작)에 JSON action을 보내 응답을 받는 방식이다.
ASDU 프로토콜로 로봇에 직접 요청하지 않는다.
"""

import json
import math
import os
import socket
import threading
import time

import app.robot_io.runtime as runtime
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id
from app.logs.service import log_event
from app.robot_io.config import (
    ROBOT_IP,
    RECEIVER_IP,
    RECEIVER_PORT,
    REQ_INTERVAL_POS,
    REQ_INTERVAL_HB,
)


# ─────────────────────────────────────────────────────────
# 관측성 · 수명주기 (C-8 / M-9)
# ─────────────────────────────────────────────────────────
# NAV 디버그 로깅 토글(C-8): 주행 중 매 폴링(1s)마다 출력되던 [NAV DEBUG] 로그를
# 환경변수 NAV_DEBUG=1 일 때만 남긴다. 평상시 IO/로그 용량을 줄인다.
NAV_DEBUG = os.environ.get("NAV_DEBUG", "0").strip().lower() in ("1", "true", "yes", "on")


def _navdbg(msg: str) -> None:
    if NAV_DEBUG:
        print(msg)


# 폴링 스레드 종료 신호(M-9): 서버 shutdown 시 set 되어 각 루프가 빠져나간다.
# (데몬 스레드라 프로세스 종료 시 강제 회수되긴 하나, --reload/재구성 시
#  좀비 루프가 남지 않도록 명시적 종료 경로를 둔다.)
_shutdown = threading.Event()
POSITION_JUMP_GUARD_M = 3.0


def stop_polling_threads() -> None:
    """폴링 데몬 스레드 3개에 종료를 요청한다(main shutdown 훅에서 호출)."""
    _shutdown.set()


def _is_navigating() -> bool:
    try:
        import app.navigation.send_move as nav_mod
        return bool(nav_mod.is_navigating)
    except Exception:
        return False


def _guard_untrusted_position_jump(robot_id: int, pos: dict) -> None:
    """비주행 중 갑작스러운 큰 위치 점프는 localization 오인으로 보고 DB 저장을 보류한다."""
    if runtime.is_initpose_pending(robot_id) or _is_navigating():
        return
    prev = runtime.get_position(robot_id) or {}
    prev_ts = prev.get("timestamp", 0) or 0
    if not prev_ts:
        return
    dx = float(pos.get("x", 0.0)) - float(prev.get("x", 0.0))
    dy = float(pos.get("y", 0.0)) - float(prev.get("y", 0.0))
    dist = math.hypot(dx, dy)
    if dist < POSITION_JUMP_GUARD_M:
        return

    detail = (
        f"비주행 중 위치가 {dist:.2f}m 급변하여 자동 위치 확정을 보류합니다. "
        f"이전=({prev.get('x', 0.0):.2f}, {prev.get('y', 0.0):.2f}), "
        f"보고=({pos.get('x', 0.0):.2f}, {pos.get('y', 0.0):.2f})"
    )
    runtime.set_initpose_pending(robot_id, True, "위치 급변 감지")
    print(f"[AUTO-INITPOSE] robot {robot_id} 위치 급변 감지 — {detail}")
    try:
        log_event(
            "error", "robot_initpose_manual_needed", "로봇 위치 확인 필요",
            error_json=detail,
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 위치 급변 알림 로그 실패: {e}")


# ─────────────────────────────────────────────────────────
# 위치 스레드
# ─────────────────────────────────────────────────────────
def position_thread():
    print(f"[LISTEN] 위치 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    # 소켓 재사용(M-6): 매 폴링마다 UDP 소켓을 생성/파기하던 비효율을 제거한다.
    # 타임아웃은 정상 상황이므로 소켓을 유지하고, 그 외 예외에서만 재생성한다.
    sock = None
    while not _shutdown.is_set():
        try:
            if sock is None:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock.settimeout(2.0)

            msg = json.dumps({"action": "POSITION"}).encode("utf-8")
            sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))

            data, addr = sock.recvfrom(4096)
            pos = json.loads(data.decode("utf-8"))

            if pos.get("timestamp", 0) > 0:
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    _guard_untrusted_position_jump(rid, pos)
                    runtime.update_position(rid, pos["x"], pos["y"], pos["yaw"])
                    # 미확정(전원 on 직후) 동안 보고 위치 추이를 JSON 캡처(조사용)
                    try:
                        if runtime.is_initpose_pending(rid):
                            from app.robot_control.poweron_capture import capture_poll_if_pending
                            capture_poll_if_pending(rid, pos)
                    except Exception:
                        pass

        except socket.timeout:
            pass
        except Exception as e:
            print("[ERR POS]", e)
            log_event("error", "position_recv_error", "로봇 위치 수신 실패",
                      error_json=str(e),
                      robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
            # 소켓이 손상됐을 수 있으니 닫고 다음 루프에서 재생성한다.
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass
                sock = None

        time.sleep(REQ_INTERVAL_POS)

    if sock is not None:
        try:
            sock.close()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────
# 상태 스레드
# ─────────────────────────────────────────────────────────
_was_online: dict[int, bool] = {}  # robot_id → 이전 온라인 상태
_status_source_stale: dict[int, bool] = {}  # robot_id → receiver STATUS source timestamp stale 상태

# 시간 기반 임계값 — 마지막 성공 시각으로부터 경과한 시간으로 판정
UNSTABLE_ALARM_AFTER_SEC = 15.0   # 15초 이상 끊김 → 불안정 알람 (1회)
OFFLINE_AFTER_SEC = 35.0          # 35초 이상 끊김 → 오프라인 확정 (runtime ERROR_MAX_AGE와 일치)

# STATUS UDP 재시도 — 혼잡 무선에서 패킷 1~2개 유실로 즉시 실패 처리되어
# Offline로 깜빡이는 것을 막기 위해 한 폴링 사이클 안에서 짧게 여러 번 시도한다.
STATUS_RETRY_ATTEMPTS = 3
STATUS_RETRY_TIMEOUT = 0.7

# receiver 캐시(basic_status)가 이보다 오래되면 로봇 heartbeat 실패로 간주
STATUS_SOURCE_STALE_AFTER_SEC = 8.0


def _try_status_once(sock: socket.socket) -> dict | None:
    """STATUS 요청 1회 시도(소켓 재사용, M-6). 성공 시 응답 dict, 타임아웃 시 None.

    타임아웃 외 예외는 소켓 손상 가능성이 있으므로 호출자가 재생성하도록 전파한다.
    """
    msg = json.dumps({"action": "STATUS"}).encode("utf-8")
    sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))
    try:
        data, addr = sock.recvfrom(8192)
        return json.loads(data.decode("utf-8"))
    except socket.timeout:
        return None


def _source_timestamp(payload: dict | None) -> float:
    if not payload:
        return 0.0
    try:
        return float(payload.get("timestamp") or 0.0)
    except (TypeError, ValueError):
        return 0.0


BOOT_GRACE_SEC = 30.0  # 백엔드 시작 후 이 시간 동안은 불안정 알람 억제


def status_thread():
    """receiver.py 경유로 배터리 상태 폴링 + 온라인/오프라인 전환 로그.

    시간 기반 판정: 마지막 성공 시각 기준 경과 시간으로 불안정/오프라인 알람.
    - UNSTABLE_ALARM_AFTER_SEC 이상 끊김 → 불안정 알람 (1회만)
    - OFFLINE_AFTER_SEC 이상 끊김 → 오프라인 확정
    """
    print(f"[LISTEN] 상태 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    boot_time = time.time()            # 스레드 시작(≈백엔드 시작) 시각
    last_success_time = time.time()    # 마지막 성공 수신 시각
    unstable_alarm_fired = False       # 이 끊김 구간에서 불안정 알람 이미 발생했는가
    ever_succeeded = False             # 한 번이라도 STATUS 수신 성공했는가
    status_sock = None                 # 재사용 소켓 (M-6)

    while not _shutdown.is_set():
        try:
            if status_sock is None:
                status_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                status_sock.settimeout(1.0)
            resp = _try_status_once(status_sock)
        except Exception as e:
            # 소켓 손상(타임아웃 외 예외) → 닫고 재생성, 이번 사이클은 실패로 처리
            print("[ERR STATUS]", e)
            if status_sock is not None:
                try:
                    status_sock.close()
                except Exception:
                    pass
                status_sock = None
            resp = None

        success = False
        if resp is not None:
            battery = resp.get("BatteryStatus", {}) or {}
            charge_state = resp.get("ChargeStatus")
            device_temp = resp.get("DeviceTemperature", {})
            basic_status = resp.get("BasicStatus", {}) or {}
            motion_info = resp.get("MotionInfo", {}) or {}
            abnormal_status = resp.get("AbnormalStatus", []) or []
            # 응답이 도달했으면 last_heartbeat는 반드시 갱신한다
            # (battery가 아직 비어있을 수 있지만 네트워크는 살아있음).
            rid = runtime.get_robot_id_by_ip(ROBOT_IP)
            if rid is not None:
                basic_ts = _source_timestamp(basic_status)
                source_stale = (
                    basic_ts > 0
                    and (time.time() - basic_ts) >= STATUS_SOURCE_STALE_AFTER_SEC
                )
                if source_stale:
                    if not _status_source_stale.get(rid, False):
                        _status_source_stale[rid] = True
                        print(
                            f"[AUTO-INITPOSE] robot {rid} STATUS source stale "
                            f"({time.time() - basic_ts:.1f}s) — 다음 fresh STATUS를 전원 on edge로 준비"
                        )
                        try:
                            from app.robot_control.auto_init_pose import mark_offline
                            mark_offline(rid)
                        except Exception as e:
                            print(f"[AUTO-INITPOSE] stale mark_offline 실패: {e}")
                    resp = None
                else:
                    if _status_source_stale.pop(rid, False):
                        print(f"[AUTO-INITPOSE] robot {rid} STATUS source fresh 복귀")

            if resp is not None and rid is not None:
                runtime.update_status(
                    rid, battery, time.time(),
                    charge_state=charge_state,
                    device_temp=device_temp,
                    basic_status=basic_status,
                    gait=motion_info.get("gait"),
                    abnormal_status=abnormal_status,
                )
                success = True
                last_success_time = time.time()
                ever_succeeded = True
                unstable_alarm_fired = False  # 성공 시 알람 플래그 리셋

                # 관절 모터 과열 감지 + 위험 시 보호 동작(충전소 도킹 후 SIT)
                try:
                    from app.robot_control.motor_thermal import check_motor_overheat
                    check_motor_overheat(rid, device_temp)
                except Exception as e:
                    print(f"[WARN] 모터 과열 체크 실패: {e}")

                # 오프라인 → 온라인 전환 감지
                if not _was_online.get(rid, False):
                    _was_online[rid] = True
                    log_event("robot", "robot_online", "로봇 온라인",
                              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

                # 배터리 임계치 도달 시 자동 충전 복귀 트리거 (정책은 auto_return 모듈 참조)
                try:
                    from app.robot_control.auto_return import check_battery_and_return
                    check_battery_and_return(rid)
                except Exception as e:
                    print(f"[AUTO-RETURN] check 실패: {e}")

                # 전원 자동 on(부팅) 상승에지 시 init_pose 자동 주입 트리거 (ERR-07)
                try:
                    from app.robot_control.auto_init_pose import check_and_init_pose
                    check_and_init_pose(rid)
                except Exception as e:
                    print(f"[AUTO-INITPOSE] check 실패: {e}")

                # 모터/드라이버 온도 과열 감지 + 실시간 로그 (DeviceTemperature 검사)
                try:
                    from app.robot_control.thermal import check_and_log_thermal
                    check_and_log_thermal(rid, device_temp)
                except Exception as e:
                    print(f"[THERMAL] check 실패: {e}")

        if not success:
            elapsed = time.time() - last_success_time

            # 10초 이상 끊김 → 불안정 알람 (이 끊김 구간에서 1회만).
            # 단, 아래 경우에는 알람을 띄우지 않는다:
            #   1) 로봇이 마지막으로 알려진 상태가 '켜짐(Sleep=0)'이 아닌 경우
            #   2) 백엔드 시작 후 grace period(30초) 이내인 경우
            #   3) 한 번도 STATUS 수신에 성공한 적 없는 경우 (초기 연결 중)
            in_grace = (time.time() - boot_time) < BOOT_GRACE_SEC
            if (elapsed >= UNSTABLE_ALARM_AFTER_SEC
                    and not unstable_alarm_fired
                    and not in_grace
                    and ever_succeeded):
                unstable_alarm_fired = True
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    # 로봇이 켜진 상태였을 때만 알람 발화
                    with runtime._lock:
                        entry = runtime._runtime.get(rid)
                    last_basic = (entry or {}).get("basic_status") or {}
                    last_sleep = last_basic.get("Sleep")
                    if last_sleep == 0:
                        log_event("error", "robot_connection_error", "로봇 통신 연결 불안정",
                                  error_json=f"{elapsed:.1f}초 간 응답 없음",
                                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

            # 12초 이상 끊김 → 오프라인 확정
            if elapsed >= OFFLINE_AFTER_SEC:
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None and _was_online.get(rid, False):
                    _was_online[rid] = False
                    log_event("robot", "robot_offline", "로봇 오프라인",
                              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
                    # 다음 온라인 복귀를 전원 on 상승에지로 잡기 위해 powered 내림 (ERR-07)
                    try:
                        from app.robot_control.auto_init_pose import mark_offline
                        mark_offline(rid)
                    except Exception as e:
                        print(f"[AUTO-INITPOSE] mark_offline 실패: {e}")

        time.sleep(REQ_INTERVAL_HB)

    if status_sock is not None:
        try:
            status_sock.close()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────
# 네비게이션 스레드
# ─────────────────────────────────────────────────────────
ARRIVAL_COOLDOWN = 1.5
NAV_POLL_INTERVAL = 1.0       # 자율주행 중 폴링 주기 (도착/hang 감지 민감도 유지)
NAV_IDLE_POLL_INTERVAL = 5.0  # 비주행(대기) 시 폴링 주기 — 대기 로봇 상시 트래픽 완화 (C-1)
NAV_RETRY_TIMEOUT = 30.0   # 전송 후 N초 내 이동 시작 안 하면 재전송
NAV_HANG_TIMEOUT = 60.0    # 이동 시작 후 N초 내 도착 못 하면 hang 판정 → 현재 WP 재전송
NAV_MAX_RETRIES = 3        # 최대 재전송 횟수 (ever_moved=False / 255 일시정지 / hang 합산)
ARRIVAL_CONFIRM_COUNT = 3  # status==0 연속 N회 확인 후 도착 판정 (오판 방지)
NEAR_SKIP_DISTANCE = 0.5   # 목표 웨이포인트까지 이 거리(m) 이내면 이미 도착으로 간주
RECEIVER_UNRESPONSIVE_THRESHOLD = 30  # NAV_STATUS 연속 N회 타임아웃 시 receiver 응답 불능 로그(1회)
RECEIVER_LOST_RESEND_SEC = 8.0   # 통신 두절 후 복구되면, 이 시간 이상 끊겼던 경우 현재 WP 자동 재전송
RECEIVER_LOST_STOP_SEC = 60.0    # 통신 두절이 이 시간 이상 지속되면 자율주행 안전 정지 + 사용자 알림


def nav_thread():
    # 지연 import — 순환 참조 회피
    from app.navigation.send_move import (
        navigation_send_next, navigation_resend_current,
        is_nav_active, get_current_target, get_nav_sent_time, check_and_clear_reset_flag,
    )
    from app.scheduler.loop import (
        on_navigation_complete, on_navigation_error, get_active_schedule_id,
    )

    last_status = None
    ever_moved = False      # 현재 WP에서 이동(!=0)을 한 번이라도 감지했는지
    zero_count = 0          # status==0 연속 카운트
    pause_since = 0         # 255 연속 시작 시간
    last_stand_sent = 0     # 마지막 STAND 전송 시간
    retry_count = 0
    consecutive_timeouts = 0  # NAV_STATUS UDP 타임아웃 연속 횟수 (연결 끊김 감지)
    comm_lost_since = 0.0     # 통신 두절(타임아웃/송신실패) 시작 시각 (0=정상 수신 중)
    recv_lost_alerted = False  # 통신 두절 안전 정지 알림을 이번 두절 구간에서 이미 발생시켰는가

    print(f"[LISTEN] 네비 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    while not _shutdown.is_set():
        arrived = False
        comm_failed = False   # 이번 사이클에서 NAV_STATUS 통신(송신/수신)이 실패했는가

        # ── 리셋 신호 감지 (새 주행 시작 / 정지 / 다음 WP 전송 시) ──
        reset, is_full = check_and_clear_reset_flag()
        if reset:
            last_status = None
            ever_moved = False
            zero_count = 0
            pause_since = 0
            last_stand_sent = 0
            if is_full:
                retry_count = 0
                # 새 주행/정지 시 통신 두절 추적도 초기화 (다음 두절 때 다시 알림 가능하도록)
                comm_lost_since = 0.0
                recv_lost_alerted = False
            print(f"[NAV] 상태 리셋 (last_status=None, full={is_full})")

        # ── 상태 기반 도착 감지 ──
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(1.5)
            msg = json.dumps({"action": "NAV_STATUS"}).encode("utf-8")
            sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))

            data, addr = sock.recvfrom(4096)
            nav = json.loads(data.decode("utf-8"))

            # 연결 복구 직후: 끊김 구간의 stale 상태를 도착 판정에 쓰지 않도록 카운터 리셋
            if comm_lost_since > 0 and is_nav_active():
                lost_dur = time.time() - comm_lost_since
                print(f"[NAV] 통신 복구 — 도착 판정 상태 리셋 (두절 {lost_dur:.0f}s 후)")
                ever_moved = False
                zero_count = 0
                last_status = None
                # 두절이 길었으면 그 사이 로봇이 명령을 잃었을 수 있으므로 현재 WP 재전송하여 주행 재개
                if lost_dur >= RECEIVER_LOST_RESEND_SEC and retry_count < NAV_MAX_RETRIES:
                    retry_count += 1
                    print(f"[NAV] 통신 복구 후 현재 WP 재전송 ({retry_count}/{NAV_MAX_RETRIES})")
                    try:
                        navigation_resend_current()
                    except Exception as e:
                        print(f"[ERR] 복구 재전송 실패: {e}")
            consecutive_timeouts = 0
            comm_lost_since = 0.0
            recv_lost_alerted = False

            status = nav.get("status")
            nav_age = nav.get("age")  # receiver가 자기 monotonic 시계로 계산한 경과시간(초)

            # stale 데이터 무시 (5초 이상 오래된 데이터)
            # age는 receiver(로봇 NOS) 한 머신 안에서만 계산되므로 서버-로봇 시계 오프셋과 무관하다.
            # (이전 구현은 서버 time.time()에서 로봇 timestamp를 빼서, 두 시계가 어긋나면
            #  멀쩡한 데이터를 전부 stale로 폐기하는 버그가 있었다.)
            # 구버전 receiver(age 미전송, age=None)면 잘못된 cross-clock 비교 대신 필터를 건너뛴다.
            if nav_age is not None and nav_age > 5.0:
                if is_nav_active():
                    _navdbg(f"[NAV DEBUG] stale 데이터 무시 (age={nav_age:.1f}s)")
                time.sleep(NAV_POLL_INTERVAL)
                continue

            if is_nav_active():
                sent_time = get_nav_sent_time()
                cooldown_ok = sent_time > 0 and (time.time() - sent_time) > ARRIVAL_COOLDOWN
                elapsed = time.time() - sent_time if sent_time > 0 else 0
                _navdbg(f"[NAV DEBUG] status={status}, last={last_status}, cooldown={cooldown_ok}, moved={ever_moved}, zero={zero_count}/{ARRIVAL_CONFIRM_COUNT}, elapsed={elapsed:.1f}s")

            if status is not None:
                if last_status != status:
                    print(f"[SYNC] NAV 상태 변화: {last_status} → {status}")

                # 이동 감지 (한 번이라도 non-zero면 기록)
                # 단, 255(pause) → 0 전환은 "이동 완료 후 정지"가 아니라 "중도 포기 정지"일
                # 가능성이 커서 도착 카운터(zero_count)와 ever_moved를 리셋한다.
                # 실제 도착이면 로봇 위치가 목표 근처일 것이므로 아래 near-skip 로직이
                # 잡아준다. 멀면 재전송 경로로 빠져 stuck을 복구한다.
                if status != 0:
                    ever_moved = True
                    zero_count = 0
                else:
                    if last_status == 255:
                        print("[NAV] 255 → 0 전환 — 도착 판정 리셋 (중도 정지 가능성)")
                        ever_moved = False
                        zero_count = 0
                    else:
                        zero_count += 1

                sent_time = get_nav_sent_time()
                cooldown_ok = sent_time > 0 and (time.time() - sent_time) > ARRIVAL_COOLDOWN

                # 도착 판정: 이동한 적 있고, 연속 N회 status==0 확인
                if (ever_moved and zero_count >= ARRIVAL_CONFIRM_COUNT
                        and is_nav_active() and cooldown_ok):
                    arrived = True
                    print(f"🎉 NAV 도착! (상태 기반: 연속 {zero_count}회 status==0 확인)")
                    from app.navigation.send_move import current_wp_index, waypoints_list
                    wp_name = waypoints_list[current_wp_index - 1].get("name", f"WP{current_wp_index}") if current_wp_index > 0 else f"WP{current_wp_index}"
                    log_event("schedule", "nav_arrival",
                              f"{wp_name} 도착 ({current_wp_index}/{len(waypoints_list)})",
                              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

                # 이동 미감지: status=0이 지속될 때 처리
                sent_time = get_nav_sent_time()
                elapsed = time.time() - sent_time if sent_time > 0 else 0
                if (not arrived and not ever_moved
                        and zero_count >= ARRIVAL_CONFIRM_COUNT
                        and is_nav_active() and cooldown_ok):
                    # 이미 목표 근처에 있으면 바로 도착 처리 (재전송 불필요)
                    target = get_current_target()
                    if target:
                        rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                        pos = runtime.get_position(rid) if rid else {"x": 0, "y": 0}
                        dx = pos["x"] - target["x"]
                        dy = pos["y"] - target["y"]
                        dist = (dx**2 + dy**2) ** 0.5
                        if dist < NEAR_SKIP_DISTANCE:
                            arrived = True
                            print(f"[OK] NAV 이미 목표 근처 (거리={dist:.2f}m < {NEAR_SKIP_DISTANCE}m) — 다음 WP로 진행")

                    # 목표와 멀면 재전송 (5초 대기 후)
                    if not arrived and elapsed >= 5.0:
                        if retry_count < NAV_MAX_RETRIES:
                            retry_count += 1
                            print(f"[WARN] NAV 이동 미감지 — 재전송 ({retry_count}/{NAV_MAX_RETRIES})")
                            try:
                                navigation_resend_current()
                            except Exception as e:
                                print(f"[ERR] 재전송 실패: {e}")
                        else:
                            arrived = True
                            print(f"[WARN] NAV 이동 미감지 — 재전송 한도 초과, 다음 WP로 진행")

                # 충전 중 여부 확인
                _rid_for_charge = runtime.get_robot_id_by_ip(ROBOT_IP)
                _is_charging = runtime.is_charging(_rid_for_charge) if _rid_for_charge else False

                # 일시 정지(255) 추적 + 앉기 방지
                if status == 255:
                    if pause_since == 0:
                        pause_since = time.time()
                    # 5초마다 STAND 전송하여 앉기 방지 (충전 중이면 스킵)
                    if is_nav_active() and not _is_charging and (time.time() - last_stand_sent) >= 5.0:
                        last_stand_sent = time.time()
                        try:
                            from app.robot_io.sender import send_to_robot
                            send_to_robot("STAND")
                        except Exception as e:
                            print(f"[ERR] STAND 전송 실패: {e}")
                    elif _is_charging:
                        print(f"[NAV] 충전 중 — STAND 전송 스킵")
                else:
                    pause_since = 0

                # 일시 정지(255): 연속 10초 이상 지속 시 현재 WP 재전송 (충전 중이면 스킵)
                if (not arrived and status == 255 and pause_since > 0
                        and is_nav_active() and cooldown_ok
                        and not _is_charging
                        and (time.time() - pause_since) >= 10.0
                        and retry_count < NAV_MAX_RETRIES):
                    retry_count += 1
                    pause_since = time.time()  # 재전송 후 타이머 리셋
                    print(f"[WARN] NAV 일시정지(255) 연속 10초 지속 — 재전송 ({retry_count}/{NAV_MAX_RETRIES})")
                    try:
                        navigation_resend_current()
                    except Exception as e:
                        print(f"[ERR] 재전송 실패: {e}")

                # 재전송: 전송 후 N초 지났는데 이동을 한 번도 안 했으면 명령 재전송 (충전 중이면 스킵)
                if (is_nav_active() and not ever_moved and not arrived
                        and sent_time > 0
                        and not _is_charging
                        and (time.time() - sent_time) > NAV_RETRY_TIMEOUT
                        and retry_count < NAV_MAX_RETRIES):
                    retry_count += 1
                    print(f"[WARN] NAV 재전송 시도 ({retry_count}/{NAV_MAX_RETRIES}) — {NAV_RETRY_TIMEOUT}초 내 이동 미감지")
                    try:
                        navigation_resend_current()
                    except Exception as e:
                        print(f"[ERR] 재전송 실패: {e}")

                # Hang 감지: 이동은 시작했으나 도착 못한 채 일정 시간 경과
                # (status=3 무한 지속 등 NOS 측 정체 상태 복구)
                if (is_nav_active() and ever_moved and not arrived
                        and sent_time > 0
                        and not _is_charging
                        and cooldown_ok
                        and (time.time() - sent_time) > NAV_HANG_TIMEOUT):
                    from app.navigation.send_move import current_wp_index as h_idx, waypoints_list as h_list
                    hang_elapsed = time.time() - sent_time
                    if retry_count < NAV_MAX_RETRIES:
                        retry_count += 1
                        print(f"[WARN] NAV hang 감지 (elapsed={hang_elapsed:.0f}s, status={status}) — 현재 WP 재전송 ({retry_count}/{NAV_MAX_RETRIES})")
                        log_event("error", "nav_hang_retry",
                                  f"NAV hang 감지 — 현재 WP 재전송 ({retry_count}/{NAV_MAX_RETRIES})",
                                  detail=f"WP{h_idx}/{len(h_list)}, status={status}, elapsed={hang_elapsed:.0f}s",
                                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
                        try:
                            navigation_resend_current()
                        except Exception as e:
                            print(f"[ERR] hang 재전송 실패: {e}")
                    else:
                        arrived = True
                        print(f"[WARN] NAV hang 재전송 한도 초과 — 다음 WP로 강제 진행 (elapsed={hang_elapsed:.0f}s)")
                        log_event("error", "nav_hang_skip",
                                  f"NAV hang 재전송 한도 초과 — 다음 WP로 강제 진행",
                                  detail=f"WP{h_idx}/{len(h_list)}, elapsed={hang_elapsed:.0f}s",
                                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    runtime.update_nav(rid, False, status, time.time())
                last_status = status

        except socket.timeout:
            comm_failed = True
            consecutive_timeouts += 1
            if is_nav_active():
                _navdbg(f"[NAV DEBUG] NAV_STATUS 응답 타임아웃 ({consecutive_timeouts}회)")
            # NOS receiver 응답 불능 감지 — 임계값 도달 시 1회만 로그 기록 (alerts 발생 안 함)
            if consecutive_timeouts == RECEIVER_UNRESPONSIVE_THRESHOLD:
                log_event("error", "receiver_unresponsive",
                          f"NOS receiver 응답 불능 의심 (NAV_STATUS {consecutive_timeouts}회 연속 타임아웃)",
                          detail=f"NOS({RECEIVER_IP}:{RECEIVER_PORT}) receiver.py 점검 필요",
                          robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        except Exception as e:
            comm_failed = True
            print("[ERR NAV]", e)
            from app.navigation.send_move import current_wp_index as err_wp_idx, waypoints_list as err_wp_list
            err_route = " → ".join(wp.get("name", f"WP{i+1}") for i, wp in enumerate(err_wp_list)) if err_wp_list else ""
            err_detail = f"중단 지점: WP{err_wp_idx}/{len(err_wp_list)}"
            if err_route:
                err_detail += f"\n경로: {err_route}"
            log_event("error", "nav_error", "네비게이션 오류 발생",
                      detail=err_detail, error_json=str(e),
                      robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        finally:
            if sock:
                try: sock.close()
                except: pass

        # ── 통신 두절 지속 감지 (수신 성공/실패와 무관하게 경과 시간 기반) ──
        # 정상 수신 분기의 hang/재전송 로직은 "응답을 받아야만" 동작하므로,
        # receiver/네트워크 두절로 응답 자체가 끊기면 도착 판정이 영원히 불가능해
        # 자율주행이 무한 대기 상태로 멈춘다. 이를 경과 시간으로 직접 판정해 복구/정지한다.
        if comm_failed:
            if comm_lost_since == 0.0:
                comm_lost_since = time.time()
            lost_dur = time.time() - comm_lost_since
            if (is_nav_active() and not recv_lost_alerted
                    and lost_dur >= RECEIVER_LOST_STOP_SEC):
                recv_lost_alerted = True
                from app.navigation.send_move import (
                    current_wp_index as lost_wp_idx, waypoints_list as lost_wp_list,
                    stop_navigation_internal,
                )
                wp_total = len(lost_wp_list)
                print(f"[ALARM] 로봇 통신 두절 {lost_dur:.0f}s 지속 — 자율주행 안전 정지 (WP{lost_wp_idx}/{wp_total})")
                # 사용자 화면 알림 발생 (nav_comm_lost → ALERT_TRIGGER_RULES 등록됨)
                log_event("error", "nav_comm_lost",
                          "로봇 통신 두절로 자율주행이 정지되었습니다",
                          detail=f"NOS({RECEIVER_IP}:{RECEIVER_PORT}) 무응답 {lost_dur:.0f}s 지속\n"
                                 f"중단 지점: WP{lost_wp_idx}/{wp_total} — 통신 복구 후 작업을 다시 시작하세요.",
                          robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
                # 무한 대기 방지: 주행 상태를 정리하고 로봇에 정지/취소 전송
                try:
                    stop_navigation_internal("통신 두절 안전 정지")
                except Exception as e:
                    print(f"[ERR] 통신 두절 안전 정지 실패: {e}")

        if arrived and is_nav_active():
            rid = runtime.get_robot_id_by_ip(ROBOT_IP)
            if rid is not None:
                runtime.update_nav(rid, True, last_status, time.time())
            try:
                navigation_send_next()
                # 네비게이션이 완료되었으면 스케줄러 콜백 호출
                if not is_nav_active():
                    if get_active_schedule_id() is not None:
                        on_navigation_complete()
                    # 작업 완료 후 충전소 자동 복귀 (스케줄러 / 원격 startpath)
                    import app.navigation.send_move as nav_mod
                    if getattr(nav_mod, "auto_return_to_charge", False):
                        nav_mod.auto_return_to_charge = False
                        try:
                            from app.robot_control.charge import _return_to_charge_internal
                            result = _return_to_charge_internal(cancel_running=False)
                            if not result.get("ok"):
                                print(f"[AUTO-CHARGE] 복귀 스킵: {result.get('msg')}")
                        except Exception as e:
                            print(f"[AUTO-CHARGE ERR] 자동 충전소 복귀 실패: {e}")
            except Exception as e:
                print(f"[ERR] navigation_send_next 실패: {e}")
                from app.navigation.send_move import current_wp_index, waypoints_list
                err_route2 = " → ".join(wp.get("name", f"WP{j+1}") for j, wp in enumerate(waypoints_list)) if waypoints_list else ""
                err_detail2 = f"중단 지점: WP{current_wp_index}/{len(waypoints_list)}"
                if err_route2:
                    err_detail2 += f"\n경로: {err_route2}"
                log_event("error", "nav_error", "다음 웨이포인트 이동 실패",
                          detail=err_detail2, error_json=str(e),
                          robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
                if get_active_schedule_id() is not None:
                    on_navigation_error(str(e))

        # 적응형 폴링 주기 (C-1): 자율주행 중에는 1s로 민감하게, 대기 중에는 5s로
        # 완화하여 대기 로봇에 대한 상시 NAV_STATUS 트래픽을 줄인다.
        # 주행 시작 시 다음 사이클부터 즉시 1s로 복귀하므로 도착 감지에 영향 없다.
        time.sleep(NAV_POLL_INTERVAL if is_nav_active() else NAV_IDLE_POLL_INTERVAL)


# ─────────────────────────────────────────────────────────
# 런처
# ─────────────────────────────────────────────────────────
def start_polling_threads() -> None:
    """위치/상태/네비 폴링 데몬 스레드 3개를 기동한다."""
    threading.Thread(target=position_thread, daemon=True).start()
    threading.Thread(target=status_thread, daemon=True).start()
    threading.Thread(target=nav_thread, daemon=True).start()
