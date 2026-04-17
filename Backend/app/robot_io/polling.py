"""위치·상태·네비게이션 폴링 스레드.

receiver.py(로봇 NOS에서 동작)에 JSON action을 보내 응답을 받는 방식이다.
ASDU 프로토콜로 로봇에 직접 요청하지 않는다.
"""

import json
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
# 위치 스레드
# ─────────────────────────────────────────────────────────
def position_thread():
    print(f"[LISTEN] 위치 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    while True:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.0)
        try:
            msg = json.dumps({"action": "POSITION"}).encode("utf-8")
            sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))

            data, addr = sock.recvfrom(4096)
            pos = json.loads(data.decode("utf-8"))

            if pos.get("timestamp", 0) > 0:
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    runtime.update_position(rid, pos["x"], pos["y"], pos["yaw"])

        except socket.timeout:
            pass
        except Exception as e:
            print("[ERR POS]", e)
            log_event("error", "position_recv_error", "로봇 위치 수신 실패",
                      error_json=str(e),
                      robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        finally:
            sock.close()

        time.sleep(REQ_INTERVAL_POS)


# ─────────────────────────────────────────────────────────
# 상태 스레드
# ─────────────────────────────────────────────────────────
_was_online: dict[int, bool] = {}  # robot_id → 이전 온라인 상태

# 시간 기반 임계값 — 마지막 성공 시각으로부터 경과한 시간으로 판정
UNSTABLE_ALARM_AFTER_SEC = 15.0   # 15초 이상 끊김 → 불안정 알람 (1회)
OFFLINE_AFTER_SEC = 20.0          # 20초 이상 끊김 → 오프라인 확정


def _try_status_once() -> dict | None:
    """STATUS 요청 1회 시도. 성공 시 응답 dict, 실패 시 None."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(1.0)
    try:
        msg = json.dumps({"action": "STATUS"}).encode("utf-8")
        sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))
        data, addr = sock.recvfrom(8192)
        return json.loads(data.decode("utf-8"))
    except socket.timeout:
        return None
    except Exception as e:
        print("[ERR STATUS]", e)
        return None
    finally:
        sock.close()


BOOT_GRACE_SEC = 30.0  # 백엔드 시작 후 이 시간 동안은 불안정 알람 억제


def status_thread():
    """receiver.py 경유로 배터리 상태 폴링 + 온라인/오프라인 전환 로그.

    시간 기반 판정: 마지막 성공 시각 기준 경과 시간으로 불안정/오프라인 알람.
    - 10초 이상 끊김 → 불안정 알람 (1회만)
    - 12초 이상 끊김 → 오프라인 확정
    """
    print(f"[LISTEN] 상태 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    boot_time = time.time()            # 스레드 시작(≈백엔드 시작) 시각
    last_success_time = time.time()    # 마지막 성공 수신 시각
    unstable_alarm_fired = False       # 이 끊김 구간에서 불안정 알람 이미 발생했는가
    ever_succeeded = False             # 한 번이라도 STATUS 수신 성공했는가

    while True:
        resp = _try_status_once()

        success = False
        if resp is not None:
            battery = resp.get("BatteryStatus", {}) or {}
            charge_state = resp.get("ChargeStatus")
            device_temp = resp.get("DeviceTemperature", {})
            basic_status = resp.get("BasicStatus", {}) or {}
            # 응답이 도달했으면 last_heartbeat는 반드시 갱신한다
            # (battery가 아직 비어있을 수 있지만 네트워크는 살아있음).
            rid = runtime.get_robot_id_by_ip(ROBOT_IP)
            if rid is not None:
                runtime.update_status(
                    rid, battery, time.time(),
                    charge_state=charge_state,
                    device_temp=device_temp,
                    basic_status=basic_status,
                )
                success = True
                last_success_time = time.time()
                ever_succeeded = True
                unstable_alarm_fired = False  # 성공 시 알람 플래그 리셋

                # 오프라인 → 온라인 전환 감지
                if not _was_online.get(rid, False):
                    _was_online[rid] = True
                    log_event("robot", "robot_online", "로봇 온라인",
                              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

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

        time.sleep(REQ_INTERVAL_HB)


# ─────────────────────────────────────────────────────────
# 네비게이션 스레드
# ─────────────────────────────────────────────────────────
ARRIVAL_COOLDOWN = 1.5
NAV_POLL_INTERVAL = 1.0
NAV_RETRY_TIMEOUT = 30.0   # 전송 후 N초 내 이동 시작 안 하면 재전송
NAV_MAX_RETRIES = 3        # 최대 재전송 횟수
ARRIVAL_CONFIRM_COUNT = 3  # status==0 연속 N회 확인 후 도착 판정 (오판 방지)
NEAR_SKIP_DISTANCE = 0.5   # 목표 웨이포인트까지 이 거리(m) 이내면 이미 도착으로 간주


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

    print(f"[LISTEN] 네비 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    while True:
        arrived = False

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

            status = nav.get("status")
            nav_ts = nav.get("timestamp", 0)

            # stale 데이터 무시 (5초 이상 오래된 데이터)
            if nav_ts > 0 and (time.time() - nav_ts) > 5.0:
                if is_nav_active():
                    print(f"[NAV DEBUG] stale 데이터 무시 (age={time.time() - nav_ts:.1f}s)")
                time.sleep(NAV_POLL_INTERVAL)
                continue

            if is_nav_active():
                sent_time = get_nav_sent_time()
                cooldown_ok = sent_time > 0 and (time.time() - sent_time) > ARRIVAL_COOLDOWN
                elapsed = time.time() - sent_time if sent_time > 0 else 0
                print(f"[NAV DEBUG] status={status}, last={last_status}, cooldown={cooldown_ok}, moved={ever_moved}, zero={zero_count}/{ARRIVAL_CONFIRM_COUNT}, elapsed={elapsed:.1f}s")

            if status is not None:
                if last_status != status:
                    print(f"[SYNC] NAV 상태 변화: {last_status} → {status}")

                # 이동 감지 (한 번이라도 non-zero면 기록)
                if status != 0:
                    ever_moved = True
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

                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    runtime.update_nav(rid, False, status, time.time())
                last_status = status

        except socket.timeout:
            if is_nav_active():
                print("[NAV DEBUG] NAV_STATUS 응답 타임아웃")
        except Exception as e:
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

        if arrived and is_nav_active():
            rid = runtime.get_robot_id_by_ip(ROBOT_IP)
            if rid is not None:
                runtime.update_nav(rid, True, last_status, time.time())
            try:
                navigation_send_next()
                # 네비게이션이 완료되었으면 스케줄러 콜백 호출
                if not is_nav_active() and get_active_schedule_id() is not None:
                    on_navigation_complete()
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

        time.sleep(NAV_POLL_INTERVAL)


# ─────────────────────────────────────────────────────────
# 런처
# ─────────────────────────────────────────────────────────
def start_polling_threads() -> None:
    """위치/상태/네비 폴링 데몬 스레드 3개를 기동한다."""
    threading.Thread(target=position_thread, daemon=True).start()
    threading.Thread(target=status_thread, daemon=True).start()
    threading.Thread(target=nav_thread, daemon=True).start()
