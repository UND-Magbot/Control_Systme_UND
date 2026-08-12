"""경유지 도착 상호작용 게이트 (PRD-Waypoint-Arrival-Interaction).

도착 → 발화(TTS) → 사람 확인 대기 → 확인 시 다음. 원칙:
- 사람 우선: 최대 대기가 남아도 확인되면 즉시 통과.
- 정지 우선: 대기 중 정지 감지 시 즉시 중단.
- 4족 과열 보호: 오래 서서 대기하면 SIT, 진행 시 STAND.
navigation_send_next 의 '도착 후 대기' 지점에서 호출된다.
"""
import threading
import time

from app.database.database import SessionLocal
from app.database.models import RobotInfo

# 4족: 이보다 오래 서서 대기하면 SIT (관절 정적부하 과열 보호). PRD §5.
SIT_AFTER_SEC = 40
# 확인인데 최대 대기가 0(미설정)이면 이 기본값을 쓴다.
DEFAULT_MAX_WAIT_SEC = 60
# onTimeout='wait'(계속 대기)의 절대 상한. 이게 없으면 무인 시간대의 1회 미응답이
# 스케줄 락을 잡은 채 그날 남은 회차를 전부 막는다(PRD-Schedule-Execution §2.1 G3).
GATE_HARD_CAP_SEC = 600

# 확인 게이트 상태 — navigation 은 단일 로봇 컨텍스트라 1개면 충분.
#
# 화면(관제)과 로봇(음성 에이전트)이 **"지금 확인 대기 중인가"** 를 알아야 하므로
# 내부 플래그만 두지 않고 표시에 필요한 것까지 담는다. 이게 없어서
# confirm='button'/'voice' 를 설정해도 아무도 확인할 수 없었다(M-05·M-06).
_gate_lock = threading.Lock()
_EMPTY_GATE = {
    "active": False,
    "robot_id": None,
    "confirmed": False,
    "confirm_mode": None,     # 'button' | 'voice'
    "wp_name": None,
    "announce_text": None,
    "started_at": 0.0,
    "max_wait_sec": 0,
    "confirmed_by": None,     # 'button' | 'voice' — 감사·로그용
}
_gate = dict(_EMPTY_GATE)


def gate_status() -> dict:
    """게이트 상태 + 남은 시간. 남은 시간은 화면이 카운트다운을 그릴 근거다."""
    with _gate_lock:
        g = dict(_gate)
    if not g["active"]:
        return {"active": False}

    waited = int(time.time() - g["started_at"]) if g["started_at"] else 0
    max_wait = g["max_wait_sec"] or DEFAULT_MAX_WAIT_SEC
    return {
        "active": True,
        "robotId": g["robot_id"],
        "confirmMode": g["confirm_mode"],
        "wpName": g["wp_name"],
        "announceText": g["announce_text"],
        "waitedSec": waited,
        "maxWaitSec": max_wait,
        # onTimeout='wait' 면 이 값이 0 이 돼도 재발화 후 계속 기다린다
        "remainingSec": max(0, max_wait - (waited % max_wait if max_wait else 0)),
        # 절대 상한 — 이걸 넘기면 onTimeout 과 무관하게 작업이 중단된다
        "hardCapRemainingSec": max(0, GATE_HARD_CAP_SEC - waited),
    }


def confirm_arrival(robot_id: int, by: str = "button") -> bool:
    """현장/관제 [확인] — 대기 중인 게이트를 통과시킨다. 대기 게이트가 없으면 False.

    `by` 는 어느 채널로 확인됐는지(button/voice). 게이트 자체는 채널을 가리지 않는다 —
    음성 모드여도 관제 버튼으로 통과시킬 수 있어야 한다("사람 우선", PRD §5).
    """
    with _gate_lock:
        if _gate["active"] and (_gate["robot_id"] is None or _gate["robot_id"] == robot_id):
            _gate["confirmed"] = True
            _gate["confirmed_by"] = by
            return True
    return False


def _robot(robot_id: int) -> RobotInfo | None:
    db = SessionLocal()
    try:
        return db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
    finally:
        db.close()


def _is_quadruped(robot_id: int) -> bool:
    try:
        r = _robot(robot_id)
        rt = (r.RobotType or "") if r else ""
        return "QUAD" in rt.upper() or "4족" in rt or "사족" in rt
    except Exception:
        return False


def speak_only(robot_id: int, text: str) -> None:
    """로봇 스피커로 발화 (best-effort). 실패해도 흐름은 계속된다."""
    text = (text or "").strip()
    if not text:
        return
    try:
        import requests
        from app.database.routes.voice import _agent_base_url

        db = SessionLocal()
        try:
            robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
            base = _agent_base_url(db, robot) if robot else None
        finally:
            db.close()
        if base:
            requests.post(f"{base}/tts/say", json={"text": text}, timeout=40)
    except Exception as e:  # noqa: BLE001
        print(f"[arrival_gate] 발화 실패(무시): {str(e)[:80]}")


def _sit(robot_id: int) -> None:
    try:
        from app.robot_io.sender import send_to_robot
        send_to_robot("SIT")
        print("[arrival_gate] 장시간 대기 → SIT (과열 보호)")
    except Exception as e:  # noqa: BLE001
        print(f"[arrival_gate] SIT 실패(무시): {str(e)[:80]}")


def _stand(robot_id: int) -> None:
    try:
        from app.robot_io.sender import send_to_robot
        send_to_robot("STAND")
        time.sleep(2)   # 일어서는 시간
    except Exception as e:  # noqa: BLE001
        print(f"[arrival_gate] STAND 실패(무시): {str(e)[:80]}")


def _notify_gate_timeout(wp_name: str) -> None:
    """게이트 절대 상한 도달을 스케줄러에 알린다 (회차를 aborted 로 마감 + 관제 알림)."""
    try:
        from app.scheduler.loop import on_gate_timeout
        on_gate_timeout(wp_name)
    except Exception as e:  # noqa: BLE001
        print(f"[arrival_gate] 게이트 상한 알림 실패(무시): {str(e)[:80]}")


def resolve_announce(stop_action: dict) -> str:
    """도착 발화 문구. **announceId 로 현재 문구를 다시 읽는다.**

    `StopActions` 는 등록 시점의 `announceText` 를 사본으로 들고 있다(오프라인 발화용
    스냅샷). 그런데 안내 멘트를 고쳐도 이 사본은 그대로라, 화면에는 새 문구가 보이는데
    로봇은 옛 문구를 말했다. 화면과 현장이 다른 말을 하는 건 그 자체로 사고다.

    id 로 못 찾으면(문구가 지워졌거나 직접 입력) 사본으로 폴백한다 — 말을 아예 안 하는
    것보다는 옛 문구라도 말하는 편이 낫다.
    """
    snapshot = (stop_action.get("announceText") or "").strip()
    ann_id = stop_action.get("announceId")
    if not ann_id:
        return snapshot

    from app.database.database import SessionLocal
    from app.database.models import VoiceAnnouncement
    db = SessionLocal()
    try:
        row = db.query(VoiceAnnouncement).filter(VoiceAnnouncement.id == ann_id).first()
        current = (row.Text or "").strip() if row else ""
        if current and current != snapshot:
            print(f"[arrival] 안내 멘트 갱신 반영: '{snapshot[:20]}…' → '{current[:20]}…'")
        return current or snapshot
    except Exception as e:  # noqa: BLE001
        print(f"[arrival] 안내 멘트 조회 실패(사본 사용): {str(e)[:80]}")
        return snapshot
    finally:
        db.close()


def run_gate(stop_action: dict, wait_sec: int, robot_id: int, is_navigating, wp_name: str) -> str:
    """도착 상호작용 실행. 반환: 'proceed' | 'abort'.

    is_navigating: 정지 감지 콜백(호출해 False 면 즉시 중단).
    """
    announce = resolve_announce(stop_action)
    confirm = stop_action.get("confirm") or "none"
    on_timeout = stop_action.get("onTimeout") or "wait"

    # 1) 도착 발화
    if announce:
        speak_only(robot_id, announce)

    # 확인 없음 → 고정 대기는 호출부가 처리한다. 바로 진행.
    if confirm == "none":
        return "proceed"

    # 2) 확인 대기 (버튼/음성) — 사람 우선, 최대 wait_sec
    max_wait = wait_sec if wait_sec > 0 else DEFAULT_MAX_WAIT_SEC
    with _gate_lock:
        _gate.update({
            "active": True,
            "robot_id": robot_id,
            "confirmed": False,
            # 화면·로봇이 "무엇을 확인해야 하는지"를 알 수 있게 함께 싣는다
            "confirm_mode": confirm,
            "wp_name": wp_name,
            "announce_text": announce or None,
            "started_at": time.time(),
            "max_wait_sec": max_wait,
            "confirmed_by": None,
        })

    is_quad = _is_quadruped(robot_id)
    sat = False
    try:
        elapsed = 0
        total_elapsed = 0
        while True:
            if not is_navigating():
                print(f"[arrival_gate] 정지 감지 — 게이트 중단 ({wp_name})")
                return "abort"
            with _gate_lock:
                if _gate["confirmed"]:
                    by = _gate.get("confirmed_by") or "button"
                    print(f"[arrival_gate] 확인됨({by}) → 진행 ({wp_name})")
                    break
            if is_quad and not sat and elapsed >= SIT_AFTER_SEC:
                _sit(robot_id)
                sat = True
            time.sleep(1)
            elapsed += 1
            total_elapsed += 1

            # 절대 상한: onTimeout 설정과 무관하게 여기서 끊는다. "모르면 멈춘다".
            if total_elapsed >= GATE_HARD_CAP_SEC:
                print(f"[arrival_gate] 확인 무응답 {GATE_HARD_CAP_SEC}초(절대 상한) → 중단 ({wp_name})")
                _notify_gate_timeout(wp_name)
                return "abort"

            if elapsed >= max_wait:
                print(f"[arrival_gate] 무응답 {max_wait}초 → onTimeout={on_timeout} ({wp_name})")
                if on_timeout == "abort":
                    return "abort"
                if on_timeout == "skip":
                    break
                # wait: 계속 대기 — 타이머 리셋 + 재발화
                elapsed = 0
                if announce:
                    speak_only(robot_id, announce)
    finally:
        with _gate_lock:
            _gate.update(_EMPTY_GATE)
        if sat:
            _stand(robot_id)   # 앉았으면 일어서서 이동

    return "proceed"
