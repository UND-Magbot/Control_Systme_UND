"""다층 경로 자동 층 전환.

크로스플로어 경로 실행 중 다음 웨이포인트가 다른 맵(층)이면, 이 모듈이:
  1) NOS active 맵을 대상 맵으로 교체(maps.switch_active_map)
  2) 해당 층 EV로비 좌표(=전환 waypoint)를 seed 로 init_pose 를 수렴할 때까지 폴링
     - 로봇이 아직 이전 층이면 scan-match 수렴 실패 → 대기
     - 사람이 로봇을 EV로비에 놓으면 수렴 성공 = 도착 자동감지(조작자 확정 불필요)
  3) 수렴하면 미초기화 플래그 해제 후 navigation_send_next 로 자율주행 재개
  4) 타임아웃이면 폴백(nav 보류 유지 + 알림)

auto_init_pose._inject_worker 와 동일한 데몬 스레드 + set_initpose_pending 게이트 패턴.
"""

import threading
import time

import app.robot_io.runtime as runtime
from app.robot_io.config import FLOOR_TRANSITION_ASSISTED as ASSISTED
from app.database.database import SessionLocal
from app.database.models import RobotInfo, RobotMapInfo
from app.logs.service import log_event

# 전환 파라미터
TRANSITION_TIMEOUT_SEC = 300  # EV로비 수렴 대기 최대(assisted 이동 시간 여유)
POLL_INTERVAL_SEC = 3         # init_pose 재시도 간격
SETTLE_WAIT_SEC = 4           # seed 주입 후 스캔매칭 안정 대기(경량: 재시작 측위 수렴 여유 ↑)

# 로봇별 전환 진행 플래그(중복 시작 방지)
_in_progress: dict[int, bool] = {}
# 로봇별 취소 요청 — 사용자/내부 정지 시 워커를 다음 폴링에서 즉시 끝낸다.
_cancelled: dict[int, bool] = {}
# 로봇별 억제 만료 시각 — 이 시각 전까지 auto_init_pose 전원-on(원점리셋) 오탐을 억제.
# (switch_active_map 의 localization 재시작이 위치를 원점으로 리셋시켜 재부팅으로 오인되는 것 방지)
_suppress_until: dict[int, float] = {}
SUPPRESS_GRACE_SEC = 60
_lock = threading.Lock()


def is_transitioning(robot_id: int) -> bool:
    with _lock:
        return bool(_in_progress.get(robot_id))


def _mark_suppress(robot_id: int) -> None:
    """전환에 의한 localization 재시작 오탐 억제 창을 지금부터 grace 만큼 연장."""
    with _lock:
        _suppress_until[robot_id] = time.time() + SUPPRESS_GRACE_SEC


def is_init_suppressed(robot_id: int) -> bool:
    """층 전환 중이거나 직후(grace)인지 — auto_init_pose 전원-on 오탐 억제 판정용.
    True 면 check_and_init_pose 가 이 로봇의 재부팅 감지를 건너뛴다."""
    if is_transitioning(robot_id):
        return True
    with _lock:
        return time.time() < _suppress_until.get(robot_id, 0.0)


def start_floor_transition(robot_id: int, wp: dict) -> bool:
    """층 전환을 비동기로 시작한다. 이미 진행 중이면 False.

    wp: 전환 대상(도착 층 EV로비) 웨이포인트 dict — {x, y, yaw, map_id, name, ...}
    """
    if not robot_id or not wp or wp.get("map_id") is None:
        return False
    with _lock:
        if _in_progress.get(robot_id):
            return False
        _in_progress[robot_id] = True
        _cancelled[robot_id] = False
    # 전환 동안 자율주행 보류(안전 가드) — 수렴하면 해제.
    runtime.set_initpose_pending(robot_id, True, "층 전환 중")
    threading.Thread(
        target=_worker, args=(robot_id, dict(wp)), daemon=True,
        name=f"floor_transition_{robot_id}",
    ).start()
    return True


def _clear(robot_id: int) -> None:
    with _lock:
        _in_progress[robot_id] = False


def cancel_transition(robot_id: int) -> bool:
    """진행 중인 층 전환에 취소를 요청한다(정지 요청 시). 진행 중이 아니었으면 False.

    워커가 다음 폴링 경계에서 스스로 끝나며, 이미 맵을 교체했을 수 있으므로 미초기화
    플래그는 유지한다(위치 신뢰불가 → 운영자 '위치 재조정' 대기).
    취소된 워커는 stop_navigation_internal 을 다시 부르지 않는다(정지 명령 중복 송신 방지).
    """
    with _lock:
        if not _in_progress.get(robot_id):
            return False
        _cancelled[robot_id] = True
    return True


def _is_cancelled(robot_id: int) -> bool:
    with _lock:
        return bool(_cancelled.get(robot_id))


def clear_transition(robot_id: int) -> None:
    """전환 진행 플래그 해제 + 억제 창 연장.

    해제와 자율주행 재개 사이에 nav_thread 가 끼어들어 같은 경계를 재감지하고 층 전환을
    다시 시작하는 레이스를 막기 위해, send_move.resume_after_transition 이 '해제 → 경계
    스킵 → 재개' 를 이어서 수행하도록 공개한다.
    """
    _clear(robot_id)
    _mark_suppress(robot_id)  # 완료 직후에도 grace — 폴링 지연 오탐 흡수


def _reported(robot_id: int) -> str:
    """로봇이 현재 보고 중인 좌표 — 미수렴 원인(오정합 vs 미도착) 판별용 진단 문자열."""
    try:
        p = runtime.get_position(robot_id) or {}
        if not p.get("timestamp"):
            return "(위치 미수신)"
        return f"({p.get('x', 0.0):.3f},{p.get('y', 0.0):.3f},yaw={p.get('yaw', 0.0):.3f})"
    except Exception:
        return "(조회 실패)"


def _worker(robot_id: int, wp: dict) -> None:
    map_id = wp.get("map_id")
    seed = {"PosX": float(wp["x"]), "PosY": float(wp["y"]), "PosZ": 0.0,
            "Yaw": float(wp.get("yaw", 0.0) or 0.0)}
    name = wp.get("name", "")
    mode = "assisted(사람이 태워줌)" if ASSISTED else "겹침 매핑(로봇 자율주행)"
    print(f"🛗 [FLOOR-TRANS] robot {robot_id} 층 전환 시작 → map {map_id} "
          f"[{mode}] (경계 '{name}' seed={seed})")

    if _is_cancelled(robot_id):
        _abort(robot_id, "시작 직후 정지 요청")
        return

    # 1) NOS active 맵 교체
    db = SessionLocal()
    try:
        robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
        map_row = db.query(RobotMapInfo).filter(RobotMapInfo.id == map_id).first()
        if not robot or not map_row:
            _fallback(robot_id, f"로봇/맵 조회 실패 (robot={robot_id}, map={map_id})")
            return
        from app.map.maps import switch_active_map
        switch_active_map(db, robot, map_row)
        _mark_suppress(robot_id)  # localization 재시작 → 원점리셋 오탐 억제 시작
        print(f"🛗 [FLOOR-TRANS] robot {robot_id} active 맵 교체 완료 → {map_row.MapName}")
    except Exception as e:
        _fallback(robot_id, f"활성 맵 교체 실패: {e}")
        return
    finally:
        db.close()

    # 2) seed 주입 후 측위 확정 폴링.
    #    assisted(실엘베): 사람이 로봇을 도착층 EV로비에 놓을 때까지 seed 수렴을 기다린다.
    #    겹침 매핑:        로봇은 아직 출발 EV로비에 서 있다. seed 는 초기 추정일 뿐이고,
    #                      scan-match 가 새 맵에서 잡아낸 위치가 정착하면 그 좌표를 채택한다.
    from app.robot_control.auto_init_pose import _send_init_pose_via_receiver
    deadline = time.time() + TRANSITION_TIMEOUT_SEC
    attempt = 0
    while time.time() < deadline:
        if _is_cancelled(robot_id):
            _abort(robot_id, "정지 요청")
            return
        attempt += 1
        status = _send_init_pose_via_receiver(seed)
        if status == "ok":
            time.sleep(SETTLE_WAIT_SEC)
            confirmed, reason = (_confirm_assisted(robot_id, seed) if ASSISTED
                                 else _confirm_selflocalized(robot_id, seed))
            if confirmed:
                print(f"🛗 [FLOOR-TRANS] robot {robot_id} 측위 확정(시도 {attempt}): {reason} — 자율주행 재개")
                log_event("schedule", "floor_transition_done",
                          f"층 전환 완료 — '{name}' {reason}, 맵 전환·자율주행 재개",
                          robot_id=robot_id)
                # 3) 진행 플래그 해제 + 인덱스 조정 + 자율주행 재개.
                #    해제를 resume 에 위임해 그 사이 nav_thread 의 경계 재감지를 막는다.
                #    assisted 면 경계 waypoint 는 로봇이 이미 그 자리라 스킵하고,
                #    겹침 매핑이면 그 waypoint 로 실제 주행해야 하므로 스킵하지 않는다.
                try:
                    from app.navigation.send_move import resume_after_transition
                    resume_after_transition(robot_id, skip_boundary=ASSISTED)
                except Exception as e:
                    print(f"[FLOOR-TRANS] nav 재개 실패: {e}")
                    _clear(robot_id)
                return
            print(f"🛗 [FLOOR-TRANS] robot {robot_id} 미확정(시도 {attempt}): {reason} "
                  f"— seed=({seed['PosX']:.3f},{seed['PosY']:.3f},yaw={seed['Yaw']:.3f}) "
                  f"보고={_reported(robot_id)} — 대기")
        else:
            print(f"🛗 [FLOOR-TRANS] robot {robot_id} init_pose 미수락(시도 {attempt}): {status} — 대기")
        time.sleep(POLL_INTERVAL_SEC)

    _fallback(robot_id,
              f"측위 확정 타임아웃({TRANSITION_TIMEOUT_SEC}s) — "
              f"seed=({seed['PosX']:.3f},{seed['PosY']:.3f}) 보고={_reported(robot_id)}")


def _confirm_assisted(robot_id: int, seed: dict) -> tuple[bool, str]:
    """실엘베: 로봇이 도착층 EV로비(seed 좌표)로 수렴해야 '도착'으로 본다.

    사람이 로봇을 아직 안 옮겼으면 수렴하지 않으므로, 이 검증이 곧 도착 자동감지다.
    """
    from app.robot_control.auto_init_pose import verify_and_clear
    converged, reason = verify_and_clear(robot_id, seed)
    return converged, ("EV로비 도착 자동감지" if converged else reason)


def _confirm_selflocalized(robot_id: int, seed: dict) -> tuple[bool, str]:
    """겹침 매핑: 로봇이 새 맵에서 스스로 잡은 위치가 정착하면 그 좌표를 채택한다.

    로봇은 아직 출발 EV로비에 서 있으므로 seed(=도착 waypoint) 와는 애초에 어긋나 있다.
    두 맵이 경계 구간에서 겹치므로 scan-match 가 현재 물리 위치를 새 맵 좌표로 찾아낸다.
    정지 상태에서 위치가 흔들리지 않고 정착했는지만 확인하고, 그 좌표를 신뢰 위치로 채택한다.

    ⚠️ '안정적으로 틀린' 좌표(대칭 구조 오정합)는 이 검사로 걸러지지 않는다.
       실엘베처럼 두 맵이 겹치지 않는 환경에서는 절대 쓰면 안 된다(ASSISTED=True).
    """
    from app.robot_control.auto_init_pose import _adopt_and_confirm, _settle_position
    settled, reason = _settle_position(robot_id)
    if settled is None:
        return False, reason
    import math
    moved = math.hypot(settled["x"] - seed["PosX"], settled["y"] - seed["PosY"]) > 0.2
    _adopt_and_confirm(robot_id, settled, moved)
    return True, f"새 맵 자가측위 정착({settled['x']:.2f}, {settled['y']:.2f}) {reason}"


def _abort(robot_id: int, reason: str) -> None:
    """정지 요청으로 전환 중단 — 주행은 이미 정지됐으므로 다시 정지시키지 않는다.

    맵이 이미 교체됐을 수 있어 미초기화 플래그는 유지한다(운영자 '위치 재조정' 대기).
    """
    _clear(robot_id)
    _mark_suppress(robot_id)
    print(f"🛗 [FLOOR-TRANS] robot {robot_id} 층 전환 중단 — {reason} (위치 미확정 유지)")
    try:
        log_event("schedule", "floor_transition_cancel",
                  f"층 전환 중단: {reason} — 맵이 교체됐을 수 있어 위치 확인이 필요합니다",
                  robot_id=robot_id)
    except Exception:
        pass


def _fallback(robot_id: int, reason: str) -> None:
    """전환 실패 — 미초기화 플래그 유지(자율주행 보류) + 알림."""
    _clear(robot_id)
    _mark_suppress(robot_id)  # 실패해도 localization 재시작됐을 수 있어 원점리셋 오탐 억제
    # 진행 중 주행 정지
    try:
        from app.navigation.send_move import stop_navigation_internal
        stop_navigation_internal(reason=f"층 전환 실패: {reason}")
    except Exception:
        pass
    print(f"⚠️ [FLOOR-TRANS] robot {robot_id} 전환 실패 — {reason} (자율주행 보류)")
    try:
        log_event("schedule", "floor_transition_fail",
                  f"층 전환 실패: {reason} — 자율주행 보류, 확인 필요",
                  robot_id=robot_id)
    except Exception:
        pass
