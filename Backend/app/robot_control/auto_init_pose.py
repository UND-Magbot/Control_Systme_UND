"""전원 자동 on(부팅) 시 robot init_pose 자동 산정·주입 (ERR-07).

status_thread 가 매 heartbeat 마다 `check_and_init_pose(robot_id)` 를 호출하고,
오프라인 확정 시 `mark_offline(robot_id)` 를 호출한다.

트리거:
  로봇이 '꺼짐/오프라인' → '켜짐(Sleep=0)+온라인' 으로 올라오는 상승에지(rising edge).
  (백엔드 시작 시점에 이미 켜져 있던 로봇은 baseline 으로 기록만 하고 주입하지 않는다.)

정책:
  - init_pose 소스 우선순위: robot_last_status(마지막 위치) → map_init_pose(맵 등록) → config.INIT_POSE
  - 맵 정합 가드: last_status 의 CurrentFloorId 가 현재 로봇 층과 일치할 때만 last_status 채택
    (다른 층/맵 프레임에 잘못 찍는 것 방지 — ERR-04/05 연계).
  - 주행 중(is_navigating)·미점등(Sleep!=0) 이면 보류.
  - 쿨다운: 한 번 주입 후 AUTO_INIT_POSE_COOLDOWN_SEC 동안 재트리거 금지(플래핑 방지).
  - 주입 후 수렴 검증: /robot/position 가 신선하고 주입 좌표 근처로 수렴했는지 확인.
    실패 시 운영자 알림 로그(error) → 수동 확인 유도.
  - 실제 송신·검증은 별도 worker 스레드에서 수행(status_thread 블로킹 방지).

⚠️ last_status 는 전원 off 동안 로봇이 물리적으로 옮겨졌으면 틀릴 수 있다.
   그래서 자동 주입은 '보조'이며, 수렴 검증 실패 시 운영자에게 알린다.
"""
from __future__ import annotations

import json
import math
import socket
import threading
import time

import app.robot_io.runtime as runtime
from app.robot_io.config import (
    ROBOT_IP,
    RECEIVER_IP,
    RECEIVER_PORT,
    INIT_POSE,
    AUTO_INIT_POSE_ENABLED,
    AUTO_INIT_POSE_COOLDOWN_SEC,
    AUTO_INIT_POSE_SETTLE_SEC,
    AUTO_INIT_POSE_VERIFY_TOLERANCE_M,
    AUTO_INIT_POSE_RETRY_INTERVAL_SEC,
    AUTO_INIT_POSE_READY_TIMEOUT_SEC,
    AUTO_INIT_POSE_MAX_CONVERGE_FAIL,
    AUTO_INIT_POSE_STABILITY_SEC,
    AUTO_INIT_POSE_STABILITY_SAMPLES,
    AUTO_INIT_POSE_STABILITY_EPS_M,
    AUTO_INIT_POSE_ORIGIN_GUARD_M,
    AUTO_INIT_POSE_CHARGE_GRACE_SEC,
    AUTO_INIT_POSE_DOCK_CHECK_TICKS,
)
from app.database.database import SessionLocal
from app.database.models import MapInitPose, RobotLastStatus, LocationInfo
from app.logs.service import log_event
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id

_lock = threading.Lock()
# robot_id → {"prev_powered": bool, "last_trigger_ts": float, "in_progress": bool}
_state: dict[int, dict] = {}
_NONCHARGE_YAW_TOLERANCE_RAD = math.radians(30.0)


def _yaw_diff(a: float, b: float) -> float:
    """두 yaw 라디안 값의 최소 절대 차이."""
    return abs(math.atan2(math.sin(a - b), math.cos(a - b)))


# ── 상태 전이 ─────────────────────────────────────────

def mark_offline(robot_id: int) -> None:
    """오프라인 확정 시 호출 — 다음 온라인 복귀를 상승에지로 잡기 위해 powered=False 로 내림."""
    with _lock:
        st = _state.setdefault(
            robot_id,
            {"prev_powered": False, "prev_near_origin": False, "last_trigger_ts": 0.0, "in_progress": False},
        )
        st["prev_powered"] = False


def force_power_on_edge(robot_id: int) -> None:
    """[디버그] 전원 사이클 없이 '전원 on 상승에지'를 강제한다.

    상태를 prev_powered=False + 쿨다운/in_progress 해제로 리셋해, 로봇이 online(Sleep=0)
    인 동안 다음 status heartbeat 의 check_and_init_pose 가 상승에지로 인식하도록 만든다.
    → 실제 전원 off/on 없이 ①트리거 + ②주입 전체 흐름을 검증할 수 있다.
    (로봇/리시버가 응답 중이어야 heartbeat 가 들어와 트리거가 발화한다.)
    """
    with _lock:
        _state[robot_id] = {
            "prev_powered": False, "prev_near_origin": False,
            "last_trigger_ts": 0.0, "in_progress": False,
        }


_POS_FRESH_SEC = 10.0  # 이 시간 내 수신된 위치만 '신선'으로 간주(재부팅 판정용)
# 주입 후 수렴 판정 전, 위치 보고가 신선해질 때까지 최대 이만큼 대기(초). 초기 폴링 지연으로
# stale 이 떠도 재주입/재시도 카운트 없이 신선 좌표를 기다린다(초기 1회 주입을 낭비하지 않음).
_POS_FRESH_WAIT_SEC = 8.0


def check_and_init_pose(robot_id: int) -> None:
    """heartbeat 성공 직후 호출. 로봇 재부팅(전원 on)을 감지해 init_pose 자동 주입을 트리거한다.

    재부팅 신호(둘 중 하나):
      1) Sleep 상승에지 — Sleep!=0 → 0 (네트워크 offline→online 포함).
      2) 위치 원점 리셋 — 로봇이 부팅 시 SLAM 을 (0,0,0)으로 리셋하므로, 보고 위치가
         비원점 → 원점(0,0,0 부근)으로 점프하면 재부팅으로 본다.
    ⚠️ NOS receiver 가 STATUS(Sleep)를 캐시로 계속 응답하면 신호 1이 안 잡힐 수 있어,
       receiver 캐시와 무관한 신호 2(위치 리셋)를 함께 본다.
    """
    if not AUTO_INIT_POSE_ENABLED:
        return

    # 런타임 스냅샷 — 락 보유 시간 최소화
    with runtime._lock:
        entry = runtime._runtime.get(robot_id)
        if not entry:
            return
        basic = entry.get("basic_status") or {}
        sleep_val = basic.get("Sleep")
        pos = entry.get("position") or {}
        charge_st = (entry.get("charge_state") or {}).get("state", 0)
        is_chg_now = entry.get("_is_charging", False)

    powered = (sleep_val == 0)  # Sleep=0 == 로봇 켜짐. heartbeat 성공 = 네트워크 online.
    now = time.time()
    pos_ts = pos.get("timestamp", 0) or 0
    pos_fresh = pos_ts > 0 and (now - pos_ts) < _POS_FRESH_SEC
    near_origin = pos_fresh and math.hypot(pos.get("x", 0.0), pos.get("y", 0.0)) < AUTO_INIT_POSE_ORIGIN_GUARD_M

    with _lock:
        st = _state.get(robot_id)
        if st is None:
            # 첫 관측: baseline 만 기록(부팅 시 이미 켜져 있던 로봇은 주입하지 않음).
            _state[robot_id] = {
                "prev_powered": powered,
                "prev_near_origin": near_origin,
                "last_trigger_ts": 0.0,
                "in_progress": False,
                "dock_check_remaining": 0,  # 재접속 후 도크 점유 관측 창(tick)
            }
            return

        prev_powered = st["prev_powered"]
        prev_near_origin = st.get("prev_near_origin", False)
        st["prev_powered"] = powered
        st["prev_near_origin"] = near_origin

        # 매핑 중에는 SLAM 이 새 맵을 원점부터 작성하느라 위치가 (0,0) 부근으로 리셋된다.
        # 이를 재부팅(원점 리셋)으로 오인하면 매핑 중에 '위치 재조정' 모달이 뜬다.
        # baseline 만 현재값으로 갱신(위에서 완료)하고 트리거는 건너뛴다 — 매핑 종료 직후에도
        # prev_near_origin==near_origin 이라 잘못된 상승에지가 발생하지 않는다.
        if _is_mapping():
            return

        # 층 전환 중/직후: floor_transition 이 의도적으로 localization 을 재시작해 위치가 원점으로
        # 리셋되고, init_pose(EV로비 seed)도 이미 처리한다. 이 원점 리셋을 재부팅으로 오인하면
        # '위치 재조정' 모달·nav 보류가 뜬다 → 매핑과 동일하게 baseline 만 갱신(위)하고 트리거 건너뜀.
        try:
            from app.navigation.floor_transition import is_init_suppressed
            if is_init_suppressed(robot_id):
                return
        except Exception:
            pass

        rising_power = powered and not prev_powered          # Sleep!=0 → 0 (전원 on 또는 네트워크 복구)
        reset_to_origin = near_origin and not prev_near_origin  # 위치 원점 점프(SLAM 리셋)

        # 전원 off→on(재부팅)과 네트워크 두절→복구(offline→online)를 구분한다.
        #   - 전원 off→on: 로봇이 부팅하며 SLAM 위치를 (0,0,0) 부근으로 리셋 → near_origin.
        #   - 네트워크 두절→복구: 로봇이 계속 켜져 있어 위치가 유지됨(원점 아님).
        # mark_offline 이 offline 시 prev_powered 를 내리므로 네트워크 복구만으로도
        # rising_power 가 뜬다. 따라서 rising_power 는 위치가 원점으로 리셋됐을 때만
        # 재부팅으로 인정하여, 네트워크 복구 시 불필요한 위치 초기화를 막는다.
        # 도크 점유(is_charging 또는 charge_state∈{1,2,5}) 상태로 재접속/전원on 하면,
        # near_origin(원점 리셋) 여부와 무관하게 재조정을 트리거한다 — 로봇이 도크에 있으면
        # 위치가 충전소로 확정이라 안전. (state 5=완충 트리클도 도크로 인정)
        # ⚠️ charge_state 는 로봇 relay_charge.py 실행 시에만 유효(미실행 시 0 → 이 경로 미동작,
        #    기존 near_origin 경로만 동작).
        # 재접속 순간엔 charge_state 가 아직 안 들어와 docked=False 일 수 있으므로, 재접속(rising_power)
        # 후 DOCK_CHECK_TICKS 틱 동안 관측해 한 번이라도 도크로 잡히면 '도크 재접속'으로 인정한다.
        docked = is_chg_now or charge_st in (1, 2, 5)
        if rising_power:
            st["dock_check_remaining"] = AUTO_INIT_POSE_DOCK_CHECK_TICKS
        dock_reconnect = False
        if st.get("dock_check_remaining", 0) > 0:
            if docked:
                dock_reconnect = True
                st["dock_check_remaining"] = 0   # 도크 확인됨 → 관측 창 닫기
            else:
                st["dock_check_remaining"] -= 1
        reboot_detected = reset_to_origin or (rising_power and near_origin) or dock_reconnect
        if not reboot_detected:
            return  # 전원on/도크 재접속 아님(네트워크 두절 복구 등) — init_pose 트리거 안 함

        # 쿨다운·중복 가드
        if st["in_progress"]:
            return
        if now - st["last_trigger_ts"] < AUTO_INIT_POSE_COOLDOWN_SEC:
            return
        st["last_trigger_ts"] = now
        st["in_progress"] = True
        trigger_reason = ("위치 원점 리셋(SLAM 재부팅)" if reset_to_origin
                          else "도크 재접속(충전소 점유)" if dock_reconnect
                          else "Sleep 상승에지+위치 원점")

    # 주행 중이면 보류(움직이는 중 좌표 리셋 금지)
    if _is_navigating():
        print(f"[AUTO-INITPOSE] robot {robot_id} 전원 on 감지 — 주행 중이라 보류")
        _clear_in_progress(robot_id)
        return

    print(f"[AUTO-INITPOSE] robot {robot_id} 전원 on 감지({trigger_reason}) → 자동 init_pose 주입 시작")

    # 전원 on 보고 위치 캡처(조사용) — 부팅 직후 로봇이 보고하는 좌표를 last_status 와 함께 기록.
    # 이 값이 쓸만하면(예: 원점 리셋이 아니라 실위치 보고) last_status 대신/비교해 자동 주입 검토 가능.
    try:
        from app.robot_control.poweron_capture import capture as _capture_poweron
        _capture_poweron(
            robot_id, "trigger",
            reported=dict(pos) if pos else None,
            last_status=_laststatus_snapshot(robot_id),
            extra={"trigger": trigger_reason, "near_origin": near_origin, "powered": powered},
        )
    except Exception as e:
        print(f"[POWERON-CAPTURE] trigger 캡처 실패: {e}")

    t = threading.Thread(
        target=_inject_worker, args=(robot_id,), daemon=True, name=f"auto_initpose_{robot_id}"
    )
    t.start()


# ── 워커(별도 스레드): 소스 결정 → 준비대기 재시도 → 수렴 검증 ──────

def _inject_worker(robot_id: int) -> None:
    """전원 on 감지 후 위치 초기화.

    - [충전 중] 충전소(dock_anchor)가 '접지 진실'이므로 자동 주입·수렴 검증 후 확정(nav 허용).
  - [비충전] last_status 시드 후 로봇이 seed 근처를 유지할 때만 자동 확정한다.
      seed와 다른 위치로 안정돼도 로봇 localization 오인 가능성이 있으므로 자동 채택/DB 갱신하지 않고
      운영자 '위치 재조정'(현재 보고 위치로 확정) 대기.
    """
    try:
        # 트리거~워커 사이에 매핑이 시작된 경우(레이스) — 매핑 중 위치 리셋은 재부팅이 아니므로
        # 자동 주입/escalation 을 하지 않는다(잘못된 '위치 재조정' 모달 방지).
        if _is_mapping():
            print(f"[AUTO-INITPOSE] robot {robot_id} 매핑 진행 중 — init_pose 주입 보류")
            return

        runtime.set_initpose_pending(robot_id, True, "전원 on 위치 초기화 진행")

        # 도크 감지(충전/완충 트리클)가 전원 on 직후 지연될 수 있어 grace 동안 대기하며 확인한다.
        # is_docked = is_charging OR charge_state∈{1,2,5} — 완충 트리클(state 5)도 도크로 인정.
        grace = time.time() + AUTO_INIT_POSE_CHARGE_GRACE_SEC
        while time.time() < grace and not runtime.is_docked(robot_id):
            time.sleep(min(1.0, AUTO_INIT_POSE_RETRY_INTERVAL_SEC) if AUTO_INIT_POSE_RETRY_INTERVAL_SEC else 1.0)

        if not runtime.is_docked(robot_id):
            # 비충전 전원 on/재연결 분기(사용자 정책).
            #   (1) 보고 위치가 신선·비원점이면 SLAM 이 자기 위치를 유지(=재부팅/리셋 아님,
            #       네트워크 순단 복구 등) → 조용히 확정. 모달/알림 없음, 자율주행 허용.
            #   (2) 원점 부근/위치 미수신(SLAM 리셋류) → 위치 신뢰불가. 모달+알림을 띄워
            #       운영자에게 '관리자 문의'를 안내하고 nav 보류(자동·수동 확정은 하지 않음).
            #       (매핑 중은 워커 진입부 _is_mapping() 가드로 이미 제외됨)
            stable, why = _noncharge_position_stable(robot_id)
            if stable:
                runtime.set_initpose_pending(robot_id, False)
                print(f"[AUTO-INITPOSE] robot {robot_id} 비충전 위치 안정({why}) — 조용히 확정(모달 없음)")
                return
            print(f"[AUTO-INITPOSE] robot {robot_id} 비충전 위치 신뢰불가({why}) — 모달+알림(관리자 문의)")
            _escalate_confirm(robot_id, f"비충전 위치 신뢰불가({why}) — 관리자 문의 필요")
            return

        # ── 도크 점유: 충전소(dock_anchor) 재주입 후 '위치 수렴'만으로 확정 ──
        # 확정 기준은 오직 '보고 위치가 dock 좌표 유효범위(tolerance) 안인가'다.
        #   · init_pose ACK 의 ErrorCode 는 신뢰하지 않는다 — 벤더 노트상 리턴코드는 명령 접수
        #     여부일 뿐 측위 결과가 아니고(측위는 5초 뒤 별도 확인 권장), 실측도 성공 시 1,
        #     실패 시 57354 로 명세(0=성공)와 어긋나 판정 근거로 못 쓴다.
        #   · 그래서 주입 후 relocalization 시간(SETTLE)을 기다린 뒤, 로봇이 충전소 좌표
        #     tolerance 안으로 잡히면 성공으로 보고 확정한다. 아니면 충전소와 동일하게 재시도.
        if not _has_charge_station():
            _alert_no_charge_station(robot_id)

        deadline = time.time() + AUTO_INIT_POSE_READY_TIMEOUT_SEC
        fail_count = 0
        prev_source = None

        while time.time() < deadline:
            pose, source = resolve_init_pose(robot_id)   # 도크 점유 → dock_anchor(없으면 폴백)
            if pose is None:
                _escalate_confirm(robot_id, f"자동 산정 불가({source})")
                return
            if source != prev_source:
                print(f"[AUTO-INITPOSE] robot {robot_id} source={source} pose={pose}")
                prev_source = source

            send_status = _send_init_pose_via_receiver(pose)
            if send_status != "ok":
                # timeout/error/no_ack — 부팅 중/통신 순단(receiver 미전달). 카운트 없이 재시도.
                print(
                    f"[AUTO-INITPOSE] robot {robot_id} 미전달(status={send_status}) — "
                    f"{AUTO_INIT_POSE_RETRY_INTERVAL_SEC:.0f}s 후 재시도"
                )
                time.sleep(AUTO_INIT_POSE_RETRY_INTERVAL_SEC)
                continue

            # 주입 전달됨 → relocalization 대기(SETTLE).
            time.sleep(AUTO_INIT_POSE_SETTLE_SEC)
            # 위치가 신선해질 때까지 잠깐 더 대기한다 — 초기 폴링 지연으로 좌표는 맞는데 timestamp 만
            # stale 인 경우 재주입/재시도 카운트를 낭비하지 않기 위함(관측: after=(0.73,1.00)인데 stale).
            after = _await_fresh_position(robot_id, _POS_FRESH_WAIT_SEC)
            if after is None:
                # 끝내 신선한 위치 미수신(폴링 두절 등) → 판정 불가로 재시도 카운트.
                fail_count += 1
                print(
                    f"[AUTO-INITPOSE] robot {robot_id} 위치 미수신(신선 좌표 대기 실패) "
                    f"{fail_count}/{AUTO_INIT_POSE_MAX_CONVERGE_FAIL}"
                )
                if fail_count >= AUTO_INIT_POSE_MAX_CONVERGE_FAIL:
                    _escalate_confirm(robot_id, f"충전소 위치 수렴 실패 {fail_count}회(위치 미수신)")
                    return
                time.sleep(AUTO_INIT_POSE_RETRY_INTERVAL_SEC)
                continue
            converged, creason = _verify_converged(pose, after)
            if converged:
                _confirm_position(
                    robot_id, source,
                    f"위치 수렴(충전소 확정), pose={pose}, "
                    f"after=({after.get('x', 0.0):.2f}, {after.get('y', 0.0):.2f})",
                )
                return
            fail_count += 1
            print(
                f"[AUTO-INITPOSE] robot {robot_id} 위치 미수렴 "
                f"{fail_count}/{AUTO_INIT_POSE_MAX_CONVERGE_FAIL}: {creason} (after={after})"
            )
            if fail_count >= AUTO_INIT_POSE_MAX_CONVERGE_FAIL:
                _escalate_confirm(robot_id, f"충전소 위치 수렴 실패 {fail_count}회({creason})")
                return
            time.sleep(AUTO_INIT_POSE_RETRY_INTERVAL_SEC)

        # 시간 상한 도달 — 끝내 충전소 좌표로 수렴하지 않음
        _escalate_confirm(
            robot_id,
            f"충전소 위치가 {AUTO_INIT_POSE_READY_TIMEOUT_SEC:.0f}s 내 미수렴",
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] robot {robot_id} 처리 오류: {e}")
    finally:
        _clear_in_progress(robot_id)


# ── 소스 결정 ─────────────────────────────────────────

def resolve_init_pose(robot_id: int):
    """init_pose 소스 결정. 반환: (pose_dict | None, source/사유 문자열).

    현재 충전 상태로 분기한다:
      [충전 중]  로봇이 물리적으로 충전소에 있음(확정) → dock_anchor(충전소 좌표)
      [비충전]   로봇은 마지막 위치 그대로일 가능성이 큼(off 중 정지) → last_status
    공통 폴백(위 소스가 없을 때): map_init_pose → last_status → config.INIT_POSE

    ⚠️ 로봇은 부팅 시 절대좌표를 스스로 못 잡으므로 시드가 곧 수렴 결과가 된다.
       그래서 '로봇이 실제로 있을 가능성이 가장 높은 좌표'를 시드로 골라야 한다.
       (충전이면 충전소, 아니면 마지막 위치. off 중 옮겨졌으면 수렴/안정성 검사에서 걸러진다.)
    """
    with runtime._lock:
        entry = runtime._runtime.get(robot_id)
        cur_floor = (entry or {}).get("current_floor_id")
        cur_map = (entry or {}).get("current_map_id")

    db = SessionLocal()
    try:
        # ── 분기: 도크 점유(충전 중/완충 트리클 state 5 포함)면 충전소 앵커 우선 ──
        if runtime.is_docked(robot_id):
            # [도크 점유] 현재 맵/층의 충전소(물리 확정) 우선
            dock = _resolve_dock_pose(db, cur_floor, cur_map)
            if dock is not None:
                return dock, "dock_anchor"
            print(f"[AUTO-INITPOSE] robot {robot_id} 충전 중이나 충전소 좌표 미등록 → 폴백")
        else:
            # [비충전] 마지막 알려진 위치 우선 (off 중 정지 가정)
            ls = _last_status_pose(db, robot_id, cur_floor)
            if ls is not None:
                return ls, "last_status"

        # ── 공통 폴백 ── (충전인데 충전소 미등록 / 비충전인데 last_status 없음·층불일치)
        if cur_map:
            mp = db.query(MapInitPose).filter(
                MapInitPose.RobotId == robot_id,
                MapInitPose.MapId == cur_map,
            ).first()
            if mp:
                return ({"PosX": mp.PosX, "PosY": mp.PosY, "PosZ": 0.0, "Yaw": mp.Yaw},
                        "map_init_pose")

        ls = _last_status_pose(db, robot_id, cur_floor)
        if ls is not None:
            return ls, "last_status"

        return (dict(INIT_POSE), "config_default")
    finally:
        db.close()


def _seed_last_status(robot_id: int) -> tuple[bool, dict | None]:
    """비충전 전원 on: 마지막 위치(last_status)를 '표시용'으로 best-effort 시드한다.

    로봇은 부팅 시 SLAM 을 (0,0,0)으로 리셋하므로, 시드하지 않으면 맵에 원점으로 찍힌다.
    마지막 위치를 시드해 맵에 '가장 그럴듯한 위치'를 표시하되, 자가측위 부정확으로 정확성을
    보장할 수 없어 **자동 확정하지 않는다**(운영자 확인 필요).

    반환 (시드 성공?, pose|None).
      - last_status 없음/현재 층과 불일치 → (False, None): 시드 생략.
      - status:ok 까지 수락 → (True, pose).
      - READY_TIMEOUT 내 미수락 → (False, pose): 시드는 못 했으나 좌표는 운영자 안내에 사용.
    """
    with runtime._lock:
        entry = runtime._runtime.get(robot_id)
        cur_floor = (entry or {}).get("current_floor_id")

    db = SessionLocal()
    try:
        pose = _last_status_pose(db, robot_id, cur_floor)
    finally:
        db.close()

    if pose is None:
        print(f"[AUTO-INITPOSE] robot {robot_id} 비충전 — last_status 없음/층 불일치 → 시드 생략")
        return False, None

    # 부팅 직후 로봇이 INIT_POSE 를 미수락(timeout)할 수 있어 status:ok 까지 재시도(READY_TIMEOUT 상한).
    print(f"[AUTO-INITPOSE] robot {robot_id} 비충전 last_status 표시용 시드 시도 pose={pose}")
    deadline = time.time() + AUTO_INIT_POSE_READY_TIMEOUT_SEC
    while time.time() < deadline:
        st = _send_init_pose_via_receiver(pose)
        if st == "ok":
            time.sleep(AUTO_INIT_POSE_SETTLE_SEC)
            print(f"[AUTO-INITPOSE] robot {robot_id} 비충전 last_status 시드 완료(표시용, 미확정)")
            return True, pose
        print(
            f"[AUTO-INITPOSE] robot {robot_id} 비충전 시드 미준비(status={st}) — "
            f"{AUTO_INIT_POSE_RETRY_INTERVAL_SEC:.0f}s 후 재시도"
        )
        time.sleep(AUTO_INIT_POSE_RETRY_INTERVAL_SEC)

    print(f"[AUTO-INITPOSE] robot {robot_id} 비충전 시드 미수락(시간 초과) — 좌표만 운영자 안내")
    return False, pose


def _laststatus_snapshot(robot_id: int) -> dict | None:
    """robot_last_status 행을 캡처/비교용 dict 로 반환(층 가드 없이 원본). 없으면 None."""
    db = SessionLocal()
    try:
        ls = db.query(RobotLastStatus).filter(RobotLastStatus.RobotId == robot_id).first()
        if not ls:
            return None
        return {
            "PosX": ls.PosX, "PosY": ls.PosY, "PosYaw": ls.PosYaw,
            "CurrentFloorId": ls.CurrentFloorId,
            "LastHeartbeat": str(getattr(ls, "LastHeartbeat", None)),
            "UpdatedAt": str(getattr(ls, "UpdatedAt", None)),
        }
    except Exception:
        return None
    finally:
        db.close()


def _last_status_pose(db, robot_id, cur_floor):
    """robot_last_status 의 마지막 위치를 pose 로 반환(층 정합 가드 포함). 없으면 None."""
    ls = db.query(RobotLastStatus).filter(RobotLastStatus.RobotId == robot_id).first()
    if not ls or ls.PosX is None or ls.PosY is None:
        return None
    # 맵 정합 가드: 마지막 기록 층 == 현재 층일 때만 채택(맵 프레임 불일치 방지)
    if cur_floor is not None and ls.CurrentFloorId is not None and ls.CurrentFloorId != cur_floor:
        print(f"[AUTO-INITPOSE] robot {robot_id} last_status 층 불일치"
              f"(last={ls.CurrentFloorId}, cur={cur_floor}) → 미사용")
        return None
    return {"PosX": ls.PosX, "PosY": ls.PosY, "PosZ": 0.0, "Yaw": ls.PosYaw or 0.0}


def _resolve_dock_pose(db, cur_floor, cur_map):
    """충전 중 로봇의 물리 위치 = '현재 맵/층' 충전 앵커(충전소 본체 '{충전소}') 좌표. 없으면 None.

    ⚠️ 실제 충전(전류)은 충전소 본체(ch, 예: ch03)에서 이뤄지고 로봇이 물리적으로 앉는 자리다.
       도킹포인트 '{충전소}-1'(ch03-1)은 그 앞 접근점이므로, init_pose 시드는 충전소(ch) 좌표를 쓴다.
       (실측: ch03=(0.744,1.003), ch03-1=(1.868,0.901) — 충전 중 로봇은 ch03 에 위치.)
    ⚠️ 멀티층: 층마다 충전소가 따로 등록되므로 현재 맵(우선)·현재 층으로 필터해 그 층 충전소를 집는다
       (.first() 로 임의 충전소를 집으면 다른 층 것을 잡는 버그).
    """
    q = db.query(LocationInfo).filter(LocationInfo.Category == "charge")
    if cur_map is not None:
        station = q.filter(LocationInfo.MapId == cur_map).first()
    elif cur_floor is not None:
        station = q.filter(LocationInfo.FloorId == cur_floor).first()
    else:
        station = q.first()
    if not station:
        return None
    # 안전 가드(필터 우회·데이터 이상 대비): 현재 맵/층과 다르면 미사용
    if cur_map is not None and getattr(station, "MapId", None) is not None and station.MapId != cur_map:
        return None
    if cur_floor is not None and getattr(station, "FloorId", None) is not None and station.FloorId != cur_floor:
        return None
    # 충전 중 로봇 실제 위치 = 충전 앵커 = 충전소 본체(ch) 좌표. (도킹포인트 ch-1 은 그 앞 접근점)
    if station.LocationX is None or station.LocationY is None:
        return None
    return {
        "PosX": station.LocationX,
        "PosY": station.LocationY,
        "PosZ": 0.0,
        "Yaw": float(station.Yaw or 0.0),
    }


# ── 송신(receiver 경유, POST /robot/initpose 와 동일 경로) ──

def _send_init_pose_via_receiver(pose: dict) -> str:
    """receiver.py(NOS)에 INIT_POSE action 전송하고 '전달 여부'를 반환한다.

    receiver 응답 형식:
      {"status": "ok", "response": ...}  → receiver 가 로봇에 전달하고 ACK 를 받음
      {"status": "timeout"}              → 로봇이 3초 내 무응답 — 보통 부팅 중
      {"status": "error", "msg": ...}    → 송신 예외

    반환: "ok" | "timeout" | "error" | "no_ack"
      ⚠️ 응답 안 ErrorCode 는 판정에 쓰지 않는다 — 벤더 노트상 리턴코드는 명령 접수 여부일 뿐
         측위 결과가 아니고, 실측도 명세(0=성공)와 어긋난다(성공 시 1, 실패 시 57354 관측).
         따라서 '전달 성공(status ok)'까지만 보고, 실제 성공/실패는 호출측이 위치 수렴으로 판정한다.
         (ACK 전문은 진단용으로 로그에 남긴다.)
    """
    msg = json.dumps({"action": "INIT_POSE", "items": pose}).encode("utf-8")
    # 응답 자체가 드롭될 수 있으니 '응답 무수신(no_ack)' 일 때만 1회 재전송한다.
    for attempt in range(1, 3):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(5.0)  # 로봇측 timeout(3s) 보다 길게
        try:
            sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))
            try:
                ack_data, _ = sock.recvfrom(4096)
                ack = json.loads(ack_data.decode("utf-8"))
                status = (ack or {}).get("status")
                print(f"[AUTO-INITPOSE] receiver ACK(시도 {attempt}): {ack}")
                if status == "ok":
                    return "ok"
                # timeout/error 는 재전송해도 같으므로 그대로 반환
                return status if status in ("timeout", "error") else "error"
            except socket.timeout:
                print(f"[AUTO-INITPOSE] receiver 무응답(시도 {attempt})")
        finally:
            sock.close()
    return "no_ack"


# ── 수렴 검증 ─────────────────────────────────────────

def _await_fresh_position(robot_id: int, max_wait_sec: float, fresh_sec: float = 3.0) -> dict | None:
    """위치 보고가 신선(fresh_sec 이내)해질 때까지 최대 max_wait_sec 대기 후 그 위치를 반환.

    못 얻으면 None. 주입 직후 위치 폴링(REQ_INTERVAL_POS≈2s)이 아직 갱신 안 돼 timestamp 가
    stale 일 때, 재주입/재시도 카운트 없이 '신선한 좌표'만 확보하려는 용도.
    fresh_sec 은 _verify_converged 의 신선도 기준(5s)보다 여유 있게 잡아, 반환 직후 판정에서
    다시 stale 로 걸리지 않게 한다.
    """
    deadline = time.time() + max_wait_sec
    while True:
        pos = runtime.get_position(robot_id) or {}
        ts = pos.get("timestamp", 0) or 0
        if ts and (time.time() - ts) <= fresh_sec:
            return pos
        if time.time() >= deadline:
            return None
        time.sleep(0.5)


def _verify_converged(pose: dict, after: dict):
    """주입 후 위치가 신선하고 주입 좌표 근처로 수렴했는지. 반환 (ok, reason)."""
    ts = after.get("timestamp", 0)
    if not ts or (time.time() - ts) > 5.0:
        return False, "위치 미수신/stale"
    dx = after.get("x", 0.0) - pose["PosX"]
    dy = after.get("y", 0.0) - pose["PosY"]
    dist = math.hypot(dx, dy)
    if dist > AUTO_INIT_POSE_VERIFY_TOLERANCE_M:
        return False, f"주입 좌표 대비 {dist:.2f}m 벗어남"
    return True, "ok"


def _settle_position(robot_id: int):
    """시드 후 로봇이 안정 위치로 '정착'했는지 관찰. 정착 시 그 위치({x,y,yaw}) 반환, 아니면 None.

    로봇은 시드를 받으면 일단 그 좌표를 보고하지만, 실제 환경(라이다 스캔)과 맞는지는 별개다.
    scan-match(저장맵 정합)가 시드를 인정하면 정지 상태에서 위치가 그대로 유지(=시드 유지, Case1)되고,
    틀리면 정합이 위치를 실제 쪽으로 끌어가 다른 곳에 정지(=재측위, Case2)한다. 어느 쪽이든
    STABILITY_SEC 동안 최대 이동량이 EPS 이내면 '정착'으로 보고, 마지막 표본 위치를 반환한다.

    반환 (pos|None, reason). pos = {"x","y","yaw"}.
    """
    samples = []
    last: dict = {}
    n = max(2, AUTO_INIT_POSE_STABILITY_SAMPLES)
    interval = AUTO_INIT_POSE_STABILITY_SEC / n
    for _ in range(n):
        time.sleep(interval)
        p = runtime.get_position(robot_id) or {}
        ts = p.get("timestamp", 0)
        if not ts or (time.time() - ts) > 5.0:
            return None, "위치 미수신/stale"
        samples.append((p.get("x", 0.0), p.get("y", 0.0)))
        last = p

    base = samples[0]
    max_dev = max(math.hypot(sx - base[0], sy - base[1]) for sx, sy in samples)
    if max_dev > AUTO_INIT_POSE_STABILITY_EPS_M:
        return None, f"{max_dev:.2f}m 이동 중(미정착)"
    return ({"x": last.get("x", 0.0), "y": last.get("y", 0.0), "yaw": last.get("yaw", 0.0)},
            f"안정({max_dev:.2f}m)")


def _adopt_and_confirm(robot_id: int, settled: dict, moved: bool) -> None:
    """정착 위치 채택: last_status 즉시 갱신 + 미초기화 해제(자율주행 허용) + 로그.

    moved=True 면 scan-match 재측위(이동, Case2)로 시드와 다른 위치에 정착한 경우.
    확인한 /robot/position 값(settled)을 runtime 과 DB(robot_last_status)에 명시 반영한다.
    """
    try:
        from app.robot_io import persistence
        x = float(settled.get("x", 0.0))
        y = float(settled.get("y", 0.0))
        yaw = float(settled.get("yaw", 0.0))
        runtime.update_position(robot_id, x, y, yaw)
        persistence.flush_robot_position(robot_id, x, y, yaw)
    except Exception as e:
        print(f"[AUTO-INITPOSE] last_status 즉시 갱신 실패(주기 저장으로 대체): {e}")

    runtime.set_initpose_pending(robot_id, False)
    kind = "재측위 채택(이동)" if moved else "시드 유지(동일 위치)"
    detail = f"정착 위치=({settled['x']:.2f}, {settled['y']:.2f}) {kind}"
    print(f"[AUTO-INITPOSE] robot {robot_id} 위치 정착·자동 확정 — {detail}")
    try:
        log_event(
            "robot", "robot_initpose_auto", "전원 on 자동 위치 확정",
            error_json=detail,
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 확정 로그 실패: {e}")


def _confirm_seed_kept(robot_id: int, settled: dict, seed_pose: dict) -> None:
    """비충전 seed 유지 확정.

    seed와 거의 같은 위치로 안정된 경우에만 자동으로 미초기화를 해제한다.
    robot_last_status는 seed의 원천이므로 여기서는 위치를 다시 저장하지 않는다.
    """
    runtime.set_initpose_pending(robot_id, False)
    dx = settled["x"] - seed_pose["PosX"]
    dy = settled["y"] - seed_pose["PosY"]
    dist = math.hypot(dx, dy)
    yaw_diff = _yaw_diff(settled.get("yaw", 0.0), seed_pose.get("Yaw", 0.0))
    detail = (
        f"비충전 seed 유지 확인: last_status=({seed_pose['PosX']:.2f}, {seed_pose['PosY']:.2f}), "
        f"보고 위치=({settled['x']:.2f}, {settled['y']:.2f}), "
        f"차이={dist:.2f}m/yaw {math.degrees(yaw_diff):.1f}deg"
    )
    print(f"[AUTO-INITPOSE] robot {robot_id} 위치 seed 유지·자동 확정 — {detail}")
    try:
        log_event(
            "robot", "robot_initpose_auto", "전원 on 자동 위치 확정",
            error_json=detail,
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 확정 로그 실패: {e}")


# ── 보조 ──────────────────────────────────────────────

def _is_navigating() -> bool:
    try:
        import app.navigation.send_move as nav_mod
        return bool(nav_mod.is_navigating)
    except Exception:
        return False


def _noncharge_position_stable(robot_id: int) -> tuple[bool, str]:
    """비충전 전원 on 시, 보고 위치가 '재부팅/SLAM 리셋 아님'(=안정)인지 판정.

    반환 (stable, reason).
      - 신선(_POS_FRESH_SEC 내)하고 비원점이면 SLAM 이 자기 위치를 유지한 것 → 재연결로 보고
        조용히 확정 가능(stable=True). (네트워크 순단 복구 등)
      - 원점 부근(리셋 의심) 또는 위치 미수신/stale 이면 stable=False
        → 매핑류 리셋 상황으로 보고 모달 없이 보류.
    """
    pos = runtime.get_position(robot_id) or {}
    ts = pos.get("timestamp", 0) or 0
    if not ts or (time.time() - ts) >= _POS_FRESH_SEC:
        return False, "위치 미수신/stale"
    if math.hypot(pos.get("x", 0.0), pos.get("y", 0.0)) < AUTO_INIT_POSE_ORIGIN_GUARD_M:
        return False, "원점 부근(SLAM 리셋 의심)"
    return True, f"비원점 신선 위치({pos.get('x', 0.0):.2f}, {pos.get('y', 0.0):.2f})"


def _is_mapping() -> bool:
    """매핑(맵 작성) 진행 중인지.

    매핑 중에는 로봇 SLAM 이 원점에서 새 맵을 작성하느라 보고 위치가 (0,0) 부근으로
    리셋된다. 이는 전원 재부팅이 아니므로 init_pose 자동 트리거/주입에서 제외해야 한다
    (원점 리셋을 재부팅으로 오인해 '위치 재조정' 모달이 뜨는 것을 방지).
    """
    try:
        from app.map.mapping_control import mapping_state
        return bool(mapping_state.get("is_running"))
    except Exception:
        return False


def _clear_in_progress(robot_id: int) -> None:
    with _lock:
        st = _state.get(robot_id)
        if st:
            st["in_progress"] = False


def _confirm_position(robot_id: int, source: str, detail: str) -> None:
    """위치 확정 — 미초기화 해제(자율주행 허용) + 로그."""
    runtime.set_initpose_pending(robot_id, False)
    print(f"[AUTO-INITPOSE] robot {robot_id} 위치 확정·nav 허용 — {source}: {detail}")
    try:
        log_event(
            "robot", "robot_initpose_auto", "전원 on 자동 init_pose 주입",
            error_json=f"source={source}, {detail}",
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 확정 로그 실패: {e}")


def _has_charge_station() -> bool:
    """충전소(Category='charge')가 DB에 등록돼 있는지."""
    db = SessionLocal()
    try:
        return db.query(LocationInfo).filter(LocationInfo.Category == "charge").first() is not None
    finally:
        db.close()


def _alert_no_charge_station(robot_id: int) -> None:
    """충전 중인데 충전소 미등록(설정 미비) — 운영자 알림."""
    print(f"[AUTO-INITPOSE] robot {robot_id} 충전 중이나 충전소 미등록 — 위치 시드 신뢰 불가")
    try:
        log_event(
            "error", "robot_initpose_no_chargestation", "충전소 미등록 — 충전 중 위치 초기화 불가",
            detail="로봇이 충전 중이나 충전소(Category=charge) 좌표가 등록돼 있지 않아 "
                   "현재 위치를 신뢰성 있게 초기화할 수 없습니다. 충전소를 등록하세요.",
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 충전소 미등록 알림 실패: {e}")


def _escalate_confirm(robot_id: int, reason: str = "위치 미확정") -> None:
    """자동 확정 불가 시: '미초기화' 유지 + 운영자에게 '위치 재조정'(현재 보고 위치 확정) 요청(확인창).

    (맵 클릭 수동 마킹은 정확도 문제로 폐기 — 교정은 '위치 재조정' 으로 일원화.)
    """
    runtime.set_initpose_pending(robot_id, True, f"위치 확인 필요({reason})")
    print(f"[AUTO-INITPOSE] robot {robot_id} 자동 확정 불가 — 운영자 '위치 재조정' 대기: {reason}")
    try:
        log_event(
            "error", "robot_initpose_manual_needed", "로봇 위치 확인 필요",
            detail=f"로봇 위치를 자동으로 확정하지 못했습니다 — {reason}.\n"
                   "로봇이 실제 위치를 정확히 보고하는 상태에서 '위치 재조정'을 눌러 현재 위치로 확정하세요.\n"
                   "확정 전까지 자율주행은 보류됩니다.",
            error_json=reason,
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 위치 확인 알림 실패: {e}")


def _escalate_manual(robot_id: int, pose: dict | None, detail: str) -> None:
    """자동 init_pose 최종 실패 시 escalation:
    1) 미초기화 플래그 set → 자율주행 안전 가드 발동(위치 신뢰불가 동안 주행 보류)
    2) 운영자 화면 알림(robot_initpose_manual_needed → ALERT_TRIGGER_RULES 등록됨)
       → 사용자가 '위치 재조정'(수동 init_pose)으로 복구 유도.
    """
    runtime.set_initpose_pending(robot_id, True, detail)
    print(f"[AUTO-INITPOSE] robot {robot_id} escalation — 미초기화 플래그 set: {detail}")
    try:
        log_event(
            "error", "robot_initpose_manual_needed", "로봇 위치 초기화 필요",
            detail="자동 위치 초기화에 실패했습니다. 현재 맵 위치를 신뢰할 수 없어 자율주행을 보류합니다.\n"
                   "'위치 재조정'으로 로봇 위치를 수동 초기화하세요.",
            error_json=detail,
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 알림 로그 실패: {e}")


# ── 미확정 자동 복구(충전 중) / 운영자 수동 확정(비충전) ──────────────


def _confirm_current_position(robot_id: int, pos: dict, detail: str) -> None:
    """현재 보고 위치를 신뢰 위치로 확정 — DB 갱신 + 미확정 해제 + 복구 로그.

    rviz 등 외부 교정으로 localization 이 이미 회복된 상태에서 호출한다.
    로봇에 INIT_POSE 를 다시 주입하지 않고(교정을 흔들지 않음), 현재 보고 좌표를 채택만 한다.
    """
    was_pending = runtime.is_initpose_pending(robot_id)
    try:
        from app.robot_io import persistence
        persistence.flush_robot_position(
            robot_id,
            float(pos.get("x", 0.0)),
            float(pos.get("y", 0.0)),
            float(pos.get("yaw", 0.0)),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 복구 위치 DB 갱신 실패(주기 저장으로 대체): {e}")
    runtime.set_initpose_pending(robot_id, False)
    # pending 해제 후 현재 좌표를 신뢰 위치로 즉시 반영(맵 마커가 라이브로 곧장 전환되도록).
    runtime.update_position(
        robot_id, float(pos.get("x", 0.0)), float(pos.get("y", 0.0)), float(pos.get("yaw", 0.0))
    )
    # 확정 직후 위치 급변 가드가 다시 미확정으로 되돌리지 않도록 유예 구간을 건다.
    runtime.mark_manual_confirm(robot_id)
    print(f"[AUTO-INITPOSE] robot {robot_id} 위치 확정·nav 허용 — {detail}")
    # 미확정이었을 때만 '복구' 로그(미확정 아닌데 확정 버튼을 눌러도 잘못된 복구 로그를 남기지 않음).
    if not was_pending:
        return
    try:
        log_event(
            "robot", "robot_initpose_recovered", "로봇 위치 초기화 복구",
            error_json=detail,
            robot_id=get_robot_id(), robot_name=get_robot_name(),
            business_id=get_robot_business_id(),
        )
    except Exception as e:
        print(f"[AUTO-INITPOSE] 복구 로그 실패: {e}")


def check_and_recover_pending(robot_id: int) -> None:
    """status heartbeat 마다 호출 — 도크 점유 중 미확정이면 능동 재조정(dock_anchor 재주입)을 트리거한다.

    도크는 접지 진실이므로, 보고 위치가 맞아 보이든 아니든 미확정이면 무조건 충전소 좌표를 다시
    주입해 복구한다(사용자 정책: is_docked 면 무조건 자동 재조정, 위치가 맞더라도).
    실제 재주입·수락 판정·재시도(거부 시 최대 N회)는 _inject_worker 가 담당하고, 여기서는
    중복 실행·스팸을 막는 가드(in_progress / 쿨다운)만 둔다.
      · 과거의 '보고 위치가 dock 로 수렴했는지 관찰 후 확정' 방식은 폐기했다 — 충전소가 원점
        근처면 로봇이 부팅 리셋값(SLAM 원점)에 고착해도 tolerance 안이라 '수렴'으로 오판돼
        엉뚱한 좌표(예: 0,0)를 확정·저장하는 버그가 있었다(SLAM 리셋값이 항상 0,0,0 도 아님).

    ⚠️ 도크 점유 판정은 is_docked(= is_charging 또는 charge_state∈{1,2,5})를 쓴다.
       완충 트리클(state 5)도 물리적으론 도크에 있으므로 자동 복구 대상이다.

    ⚠️ 비도크 미확정은 접지 진실이 없어 자동 복구 대상이 아니다 —
       운영자 '현재 위치로 확정' 버튼(POST /robot/initpose/confirm-current)으로 해제한다.
    """
    if robot_id is None:
        return
    if not runtime.is_initpose_pending(robot_id):
        return
    # 도크 점유가 아니거나 주행/매핑 중이면 자동 재조정 보류
    if not runtime.is_docked(robot_id) or _is_navigating() or _is_mapping():
        return

    # 도크 점유 + 미확정 → dock_anchor 재주입 워커를 트리거. 진행 중이거나 쿨다운 중이면 대기
    # (한 워커가 이미 최대 N회 재시도/escalation 을 수행하므로 매 heartbeat 마다 새로 띄우지 않는다).
    now = time.time()
    with _lock:
        st = _state.setdefault(
            robot_id,
            {"prev_powered": True, "prev_near_origin": False,
             "last_trigger_ts": 0.0, "in_progress": False, "dock_check_remaining": 0},
        )
        if st.get("in_progress"):
            return
        if now - st.get("last_trigger_ts", 0.0) < AUTO_INIT_POSE_COOLDOWN_SEC:
            return
        st["last_trigger_ts"] = now
        st["in_progress"] = True

    print(f"[AUTO-INITPOSE] robot {robot_id} 도크 점유·미확정 → dock_anchor 재주입 트리거")
    t = threading.Thread(
        target=_inject_worker, args=(robot_id,), daemon=True,
        name=f"auto_initpose_recover_{robot_id}",
    )
    t.start()


def confirm_current_position_manual(robot_id: int) -> tuple[bool, str]:
    """운영자 '완료(위치 확정)' — 미확정 플래그를 무조건 해제한다(운영자 권한).

    운영자가 스캔 정합을 눈으로 확인하고 확정한 것이므로, 자동 수렴/신선도 검사로 막지 않는다.
    위치가 신선하면 그 좌표를 신뢰 위치로 채택하고, 미수신이어도 플래그만 해제한다.
    (로봇에 INIT_POSE 재주입은 하지 않음 — '적용'에서 이미 주입됨.) 반환 (성공, 사유).
    """
    if robot_id is None:
        return False, "로봇을 찾을 수 없습니다."
    pos = runtime.get_position(robot_id) or {}
    ts = pos.get("timestamp", 0) or 0
    fresh = bool(ts) and (time.time() - ts) <= 5.0
    if fresh:
        _confirm_current_position(
            robot_id, pos,
            f"운영자 확정(완료) — pos=({pos.get('x', 0.0):.2f}, {pos.get('y', 0.0):.2f})",
        )
    else:
        # 위치 미수신이어도 운영자 확정은 존중 — 플래그만 해제(유예 마킹 포함).
        runtime.set_initpose_pending(robot_id, False)
        runtime.mark_manual_confirm(robot_id)
        print(f"[AUTO-INITPOSE] robot {robot_id} 운영자 확정(완료) — 위치 미수신, 플래그만 해제")
        try:
            log_event(
                "robot", "robot_initpose_recovered", "로봇 위치 초기화 복구",
                error_json="운영자 확정(완료) — 위치 미수신 상태에서 수동 해제",
                robot_id=get_robot_id(), robot_name=get_robot_name(),
                business_id=get_robot_business_id(),
            )
        except Exception as e:
            print(f"[AUTO-INITPOSE] 확정 로그 실패: {e}")
    return True, "위치를 확정했습니다."


def verify_and_clear(robot_id: int, pose: dict) -> tuple[bool, str]:
    """수동 init_pose(/robot/initpose) 후 호출: 수렴 검증 성공 시 미초기화 플래그 해제.

    반환 (cleared, reason). 자동 워커와 동일한 수렴 기준을 사용한다.
    """
    time.sleep(AUTO_INIT_POSE_SETTLE_SEC)
    after = runtime.get_position(robot_id) or {}
    ok, reason = _verify_converged(pose, after)
    if ok:
        was_pending = runtime.is_initpose_pending(robot_id)
        try:
            from app.robot_io import persistence
            persistence.flush_robot_position(
                robot_id,
                float(pose["PosX"]),
                float(pose["PosY"]),
                float(pose.get("Yaw", 0.0)),
            )
        except Exception as e:
            print(f"[AUTO-INITPOSE] 수동 확정 위치 DB 갱신 실패: {e}")
        runtime.set_initpose_pending(robot_id, False)
        print(f"[AUTO-INITPOSE] robot {robot_id} 수동 init_pose 수렴 성공 — 미초기화 해제")
        if was_pending:
            try:
                log_event(
                    "robot", "robot_initpose_recovered", "로봇 위치 초기화 복구",
                    error_json=f"pose={pose}",
                    robot_id=get_robot_id(), robot_name=get_robot_name(),
                    business_id=get_robot_business_id(),
                )
            except Exception as e:
                print(f"[AUTO-INITPOSE] 복구 로그 실패: {e}")
    return ok, reason
