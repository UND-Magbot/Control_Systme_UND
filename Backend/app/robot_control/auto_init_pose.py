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
            }
            return

        prev_powered = st["prev_powered"]
        prev_near_origin = st.get("prev_near_origin", False)
        st["prev_powered"] = powered
        st["prev_near_origin"] = near_origin

        rising_power = powered and not prev_powered          # 신호 1: Sleep 상승에지
        reset_to_origin = near_origin and not prev_near_origin  # 신호 2: 위치 원점 점프(SLAM 리셋)
        if not (rising_power or reset_to_origin):
            return  # 재부팅 신호 아님

        # 쿨다운·중복 가드
        if st["in_progress"]:
            return
        if now - st["last_trigger_ts"] < AUTO_INIT_POSE_COOLDOWN_SEC:
            return
        st["last_trigger_ts"] = now
        st["in_progress"] = True
        trigger_reason = "Sleep 상승에지" if rising_power else "위치 원점 리셋(SLAM 재부팅)"

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
        runtime.set_initpose_pending(robot_id, True, "전원 on 위치 초기화 진행")

        # 충전 감지가 전원 on 직후 1~2초 지연될 수 있어 짧게 대기하며 확인한다.
        grace = time.time() + AUTO_INIT_POSE_CHARGE_GRACE_SEC
        while time.time() < grace and not runtime.is_charging(robot_id):
            time.sleep(min(1.0, AUTO_INIT_POSE_RETRY_INTERVAL_SEC) if AUTO_INIT_POSE_RETRY_INTERVAL_SEC else 1.0)

        if not runtime.is_charging(robot_id):
            # 비충전 — 시드 주입하지 않는다(사용자 결정). 비충전 지점엔 충전소 같은 신뢰 기준점이
            # 없고, 시드(last_status)가 틀렸을 때 로봇이 그 값을 붙잡아 '틀린 위치 자동 확정'이 되는
            # 위험(confidently-wrong)이 있어서다. 자동 주입/확정 없이 '미확정' 유지 +
            # 항상 운영자 확인('충전소 위치로 지정' 또는 '위치 재조정')으로 넘긴다.
            print(f"[AUTO-INITPOSE] robot {robot_id} 비충전 — 자동 주입 없이 운영자 확인 대기")
            _escalate_confirm(robot_id, "비충전 전원 on — 운영자 위치 확인 필요")
            return

        # ── 충전 중: 충전소(dock_anchor) 자동 주입 ──
        if not _has_charge_station():
            _alert_no_charge_station(robot_id)

        before = runtime.get_position(robot_id) or {}
        deadline = time.time() + AUTO_INIT_POSE_READY_TIMEOUT_SEC
        converge_fail = 0
        got_ok = False
        prev_source = None

        while time.time() < deadline:
            pose, source = resolve_init_pose(robot_id)   # 충전 중 → dock_anchor(없으면 폴백)
            if pose is None:
                _escalate_confirm(robot_id, f"자동 산정 불가({source})")
                return
            if source != prev_source:
                print(f"[AUTO-INITPOSE] robot {robot_id} source={source} pose={pose} (before={before})")
                prev_source = source

            send_status = _send_init_pose_via_receiver(pose)
            if send_status != "ok":
                print(
                    f"[AUTO-INITPOSE] robot {robot_id} 미준비(status={send_status}) — "
                    f"{AUTO_INIT_POSE_RETRY_INTERVAL_SEC:.0f}s 후 재시도"
                )
                time.sleep(AUTO_INIT_POSE_RETRY_INTERVAL_SEC)
                continue

            got_ok = True
            time.sleep(AUTO_INIT_POSE_SETTLE_SEC)
            after = runtime.get_position(robot_id) or {}
            converged, creason = _verify_converged(pose, after)
            if converged:
                _confirm_position(robot_id, source, f"수렴(충전소 확정), pose={pose}")
                return

            converge_fail += 1
            print(
                f"[AUTO-INITPOSE] robot {robot_id} 충전소 위치 미확정 "
                f"{converge_fail}/{AUTO_INIT_POSE_MAX_CONVERGE_FAIL}: {creason} (after={after})"
            )
            if converge_fail >= AUTO_INIT_POSE_MAX_CONVERGE_FAIL:
                _escalate_confirm(robot_id, f"충전소 위치 수렴 실패 {converge_fail}회({creason})")
                return
            time.sleep(AUTO_INIT_POSE_RETRY_INTERVAL_SEC)

        # 시간 상한 도달
        _escalate_confirm(
            robot_id,
            "충전소 위치 수렴 실패(시간 초과)" if got_ok
            else f"로봇이 INIT_POSE 를 {AUTO_INIT_POSE_READY_TIMEOUT_SEC:.0f}s 내 미수락",
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
        # ── 분기: 현재 충전 상태로 1순위 소스를 가른다 ──
        if runtime.is_charging(robot_id):
            # [충전 중] 현재 맵/층의 충전소(물리 확정) 우선
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
    """충전 중 로봇의 물리 위치 = '현재 맵/층' 충전소의 도킹포인트 '{충전소}-1' 좌표. 없으면 None.

    ⚠️ 충전 시 로봇은 **도킹포인트(ch-1)** 에 있고, 충전소(ch)는 그 0.866m '앞' 이다(운영 확인).
       따라서 시드는 도킹포인트 좌표를 써야 한다(충전소 ch 좌표가 아님).
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
    # 충전 도킹 시 로봇 실제 위치 = 도킹포인트 '{충전소}-1'
    dock = (
        db.query(LocationInfo)
        .filter(LocationInfo.LacationName == f"{station.LacationName}-1")
        .first()
    )
    if not dock or dock.LocationX is None or dock.LocationY is None:
        return None
    return {
        "PosX": dock.LocationX,
        "PosY": dock.LocationY,
        "PosZ": 0.0,
        "Yaw": float(dock.Yaw or 0.0),
    }


# ── 송신(receiver 경유, POST /robot/initpose 와 동일 경로) ──

def _send_init_pose_via_receiver(pose: dict) -> str:
    """receiver.py(NOS)에 INIT_POSE action 전송하고 결과 상태를 반환한다.

    receiver 응답 형식:
      {"status": "ok", "response": ...}  → 로봇이 실제로 수락(ACK)함
      {"status": "timeout"}              → 로봇이 3초 내 무응답(미수락) — 보통 부팅 중
      {"status": "error", "msg": ...}    → 송신 예외

    반환: "ok" | "timeout" | "error" | "no_ack"
      ⚠️ 과거 버그: receiver 가 'timeout' 을 돌려줘도 "응답만 오면 성공"으로 보고
         재시도하지 않아, 시드가 실제로 안 먹혔는데 종료됐다. 이제 status 를 그대로 판정한다.
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
                # timeout/error 는 로봇 미수락 — 재전송해도 같으므로 그대로 반환
                return status if status in ("timeout", "error") else "error"
            except socket.timeout:
                print(f"[AUTO-INITPOSE] receiver 무응답(시도 {attempt})")
        finally:
            sock.close()
    return "no_ack"


# ── 수렴 검증 ─────────────────────────────────────────

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
