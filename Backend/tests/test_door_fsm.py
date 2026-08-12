"""자동문 통과 FSM (E5 D3) mock 기반 검증 — 로봇 무동작.

핵심은 '전진 강행 금지'다. 열림을 확인하지 못했거나 통과 중 문이 닫히면
반드시 물러나거나(back_off) 멈춰서 조작자를 부른다.
"""
import door_fsm as dfsm
from door_fsm import DoorFSM, DoorFsmConfig, Intent, Phase


# ─────────────────────── mock ports ───────────────────────
class MockPorts:
    """읽기 값 + 작용 기록. 값은 상수 또는 callable(mock)->값."""

    def __init__(self, **kw):
        self.actions = []
        d = dict(at_entry=True, door_open=True, passed=True, clear_of_door=True)
        d.update(kw)
        self._d = d

    def _read(self, name):
        v = self._d[name]
        return v(self) if callable(v) else v

    def at_entry(self): return self._read("at_entry")
    def door_open(self): return self._read("door_open")
    def passed(self): return self._read("passed")
    def clear_of_door(self): return self._read("clear_of_door")

    def request_open(self): self.actions.append("request_open")
    def back_off(self): self.actions.append("back_off")
    def hold_safe(self, reason): self.actions.append(("hold_safe", reason))
    def operator_prompt(self, info): self.actions.append(("operator_prompt", info.get("reason")))
    def resume(self): self.actions.append("resume")


def _fsm(ports, **cfg):
    base = dict(door_id=1, door_name="본관 1층 정문", detect_vision=True, tick_sec=1.0)
    base.update(cfg)
    return DoorFSM(ports, DoorFsmConfig(**base))


# ─────────────────────── 정상 경로 ───────────────────────
def test_happy_path_reaches_done():
    p = MockPorts()
    f = _fsm(p)
    assert f.run() == Phase.DONE
    assert "request_open" in p.actions and "resume" in p.actions
    assert "back_off" not in p.actions       # 정상 통과에 후진은 없다
    assert f.assumed_open is False           # 비전으로 실제 확인함


def test_phase_order_is_five_steps():
    p = MockPorts()
    f = _fsm(p)
    f.run()
    seen = [s.phase for s in f.log]
    for ph in (Phase.APPROACH, Phase.REQUEST, Phase.OPEN_WAIT, Phase.PASS, Phase.VERIFY, Phase.DONE):
        assert ph in seen
    # 엘리베이터와 달리 맵 전환·freeze 단계가 없다
    assert not any("freeze" in s.note for s in f.log)


# ─────────────────────── 열림 판독 ───────────────────────
def test_no_detector_enters_on_assumption_and_marks_it():
    """DetectType=none 이면 '열렸다고 가정'하고 진입하되 상태에 남긴다(조작자가 알 수 있게)."""
    p = MockPorts()
    f = _fsm(p, detect_vision=False, open_grace_sec=2)
    assert f.run() == Phase.DONE
    assert f.assumed_open is True


def test_open_timeout_goes_to_fallback_without_moving():
    p = MockPorts(door_open=False)
    f = _fsm(p, open_timeout_sec=5)
    f.run(max_ticks=50)
    assert f.phase == Phase.FALLBACK
    assert f.reason == "열림 대기 타임아웃"
    assert "back_off" not in p.actions       # 아직 진입 전 — 물러날 것도 없다
    assert ("operator_prompt", "열림 대기 타임아웃") in p.actions


# ─────────────────────── 끼임 방어 ───────────────────────
def test_door_closing_during_pass_backs_off():
    # 열림 확인 후 통과 시작 → 통과 중 닫힘. 전진하지 않고 물러난다.
    state = {"ticks": 0}

    def door_open(_m):
        state["ticks"] += 1
        return state["ticks"] <= 2

    p = MockPorts(door_open=door_open, passed=False)
    f = _fsm(p)
    f.run(max_ticks=50)
    assert f.phase == Phase.FALLBACK
    assert f.reason == "통과 중 문 닫힘"
    assert "back_off" in p.actions


def test_pass_timeout_backs_off():
    p = MockPorts(passed=False)
    f = _fsm(p, pass_timeout_sec=4)
    f.run(max_ticks=50)
    assert f.phase == Phase.FALLBACK
    assert f.reason == "통과 제한 시간 초과"
    assert "back_off" in p.actions


def test_verify_timeout_holds_for_operator():
    p = MockPorts(clear_of_door=False)
    f = _fsm(p, verify_timeout_sec=3)
    f.run(max_ticks=50)
    assert f.phase == Phase.FALLBACK
    assert "resume" not in p.actions          # 확인 못 했으면 주행 재개하지 않는다


def test_approach_timeout():
    p = MockPorts(at_entry=False)
    f = _fsm(p, approach_timeout_sec=3)
    f.run(max_ticks=50)
    assert f.phase == Phase.FALLBACK
    assert f.reason == "통과 대기점 접근 타임아웃"


# ─────────────────────── 조작자 개입 ───────────────────────
def _in_fallback():
    p = MockPorts(door_open=False)
    f = _fsm(p, open_timeout_sec=3)
    f.run(max_ticks=30)
    assert f.phase == Phase.FALLBACK
    return p, f


def test_retry_open_reissues_request():
    p, f = _in_fallback()
    before = p.actions.count("request_open")
    assert f.submit(Intent.RETRY_OPEN)
    f.tick()                      # 개입 반영 → REQUEST
    assert f.phase == Phase.REQUEST
    f.tick()                      # REQUEST → 개폐 재호출
    assert p.actions.count("request_open") == before + 1


def test_confirm_passed_moves_to_pass():
    p, f = _in_fallback()
    assert f.submit(Intent.CONFIRM_PASSED)
    f.tick()
    assert f.phase == Phase.PASS


def test_skip_resumes_driving():
    p, f = _in_fallback()
    assert f.submit(Intent.SKIP)
    f.tick()
    assert f.phase == Phase.DONE
    assert "resume" in p.actions


def test_abort_holds_safe_and_is_accepted_anytime():
    p = MockPorts(at_entry=False)
    f = _fsm(p, approach_timeout_sec=100)
    f.tick()
    assert f.phase == Phase.APPROACH          # 아직 FALLBACK 아님
    assert f.submit(Intent.ABORT)             # 중단은 언제나 받는다
    f.tick()
    assert f.phase == Phase.ABORTED
    assert any(a[0] == "hold_safe" for a in p.actions if isinstance(a, tuple))


def test_non_abort_intent_rejected_outside_fallback():
    p = MockPorts(at_entry=False)
    f = _fsm(p, approach_timeout_sec=100)
    f.tick()
    assert f.submit(Intent.SKIP) is False      # 진행 중에 강제 진행을 끼워 넣지 못한다


def test_snapshot_shape_for_overlay():
    p, f = _in_fallback()
    snap = f.snapshot()
    assert snap["phase"] == "FALLBACK" and snap["fallback"] is True
    assert snap["door_name"] == "본관 1층 정문"
    assert snap["message"] == "열림 대기 타임아웃"
    assert snap["elapsed_sec"] >= 1
