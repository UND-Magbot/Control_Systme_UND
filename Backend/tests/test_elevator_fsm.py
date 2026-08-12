"""엘리베이터 FSM (Stage 2) mock 기반 검증 — 로봇 무동작.

상태 전이·3자 합의 게이트·재측위 폴백 사다리(F1~F5)·가드레일(재승선 금지·
스코어∧합의에서만 NORMAL 복귀·측위 freeze 유지)을 순수 로직으로 검증한다.
"""
import elevator_fsm as efsm
from elevator_fsm import ElevatorFSM, FsmConfig, Phase, Fallback


# ─────────────────────── mock ports ───────────────────────
def _val(x, m):
    return x(m) if callable(x) else x


class MockPorts:
    """읽기 플래그 + 작용 기록. 값은 상수 또는 callable(mock)->값."""
    def __init__(self, **kw):
        self.actions = []            # (name, args)
        self.reads = {}
        d = dict(
            at_lobby=True, door_open=True, inside_elevator=True, align_converged=True,
            button_confirmed=True, indicated_floor="B2", scan_candidate_floor="B2",
            altitude_floor="B2", exited=True, operator_confirmed=False,
            relocalize_status={"score": 0.9, "covariance": 0.1, "multimap_margin": 0.3, "converged": True},
        )
        d.update(kw)
        self._d = d

    def _read(self, name):
        self.reads[name] = self.reads.get(name, 0) + 1
        return _val(self._d[name], self)

    # 판독
    def at_lobby(self): return self._read("at_lobby")
    def door_open(self): return self._read("door_open")
    def inside_elevator(self): return self._read("inside_elevator")
    def align_converged(self): return self._read("align_converged")
    def button_confirmed(self): return self._read("button_confirmed")
    def indicated_floor(self): return self._read("indicated_floor")
    def scan_candidate_floor(self): return self._read("scan_candidate_floor")
    def altitude_floor(self): return self._read("altitude_floor")
    def exited(self): return self._read("exited")
    def operator_confirmed(self): return self._read("operator_confirmed")
    def relocalize_status(self): return self._read("relocalize_status")

    # 작용
    def freeze_localization(self): self.actions.append(("freeze",))
    def start_align(self, t): self.actions.append(("start_align", t))
    def press_button(self, f): self.actions.append(("press_button", f))
    def switch_map_and_seed(self, s): self.actions.append(("switch_map_and_seed", s))
    def widen_search(self): self.actions.append(("widen_search",))
    def nudge_out(self, d): self.actions.append(("nudge_out", d))
    def operator_prompt(self, i): self.actions.append(("operator_prompt", i))
    def hold_safe(self, r): self.actions.append(("hold_safe", r))
    def unfreeze_and_resume(self): self.actions.append(("unfreeze",))


def _cfg(**kw):
    base = dict(target_floor="B2", seed_pose={"x": 1.0, "y": 2.0, "yaw": 0.0, "map_id": 7})
    base.update(kw)
    return FsmConfig(**base)


def _names(ports):
    return [a[0] for a in ports.actions]


def _phases(fsm):
    return [s.phase for s in fsm.log]


# ─────────────────────── happy path ───────────────────────
def test_happy_path_assisted_reaches_done():
    p = MockPorts()
    fsm = ElevatorFSM(p, _cfg(assisted=True))
    end = fsm.run()
    assert end == Phase.DONE
    seq = _phases(fsm)
    for ph in (Phase.ENTER, Phase.ALIGN, Phase.RIDE, Phase.ARRIVE, Phase.EXIT, Phase.RELOCALIZE, Phase.DONE):
        assert ph in seq, f"{ph} 누락"
    assert Phase.SELECT not in seq          # assisted 는 버튼 생략
    assert "freeze" in _names(p) and "unfreeze" in _names(p)
    assert "switch_map_and_seed" in _names(p)
    assert "hold_safe" not in _names(p)


def test_autonomous_presses_button():
    p = MockPorts()
    fsm = ElevatorFSM(p, _cfg(assisted=False))
    assert fsm.run() == Phase.DONE
    assert Phase.SELECT in _phases(fsm)
    assert ("press_button", "B2") in p.actions


# ─────────────────────── 게이트 ───────────────────────
def test_no_exit_without_3way_consensus():
    # scan 후보가 목적층과 불일치 → 하차 안 함(§G2). 반쯤 낀 채 정지 금지: EXIT 미진입.
    p = MockPorts(scan_candidate_floor="B1")
    fsm = ElevatorFSM(p, _cfg(t_arrive=5))
    assert fsm.run() == Phase.FAILED
    assert Phase.EXIT not in _phases(fsm)
    assert "switch_map_and_seed" not in _names(p)     # 하차 시작 안 함
    assert any(a[0] == "operator_prompt" for a in p.actions)
    assert not fsm._exit_started


def test_door_wait_timeout_fails_before_freeze():
    p = MockPorts(door_open=False)
    fsm = ElevatorFSM(p, _cfg(t_door=4))
    assert fsm.run() == Phase.FAILED
    assert "freeze" not in _names(p)      # freeze 는 ENTER 에서만
    assert "hold_safe" in _names(p)


def test_enter_fails_if_door_closes_but_freeze_already_started():
    # DOOR_WAIT 는 통과(문 열림 1회)했다가 ENTER 에서 문 닫힘 → 진입 실패.
    seq = {"door_open": lambda m: m.reads["door_open"] < 2}   # 첫 판독만 True
    p = MockPorts(inside_elevator=False, **seq)
    fsm = ElevatorFSM(p, _cfg(t_enter=10))
    assert fsm.run() == Phase.FAILED
    assert "freeze" in _names(p)          # 진입 시작하며 freeze 됨
    assert Phase.ENTER in _phases(fsm)


# ─────────────────────── 재측위 폴백 사다리 ───────────────────────
def test_relocalize_fallback_escalates_to_f5():
    # 재측위 계속 미수렴 + 조작자 무응답 → F1→F2→F3→F4→F5→FAILED.
    p = MockPorts(relocalize_status={"score": 0.1, "covariance": 0.9, "multimap_margin": 0.0},
                  operator_confirmed=False)
    fsm = ElevatorFSM(p, _cfg(t_reloc_level=2))
    assert fsm.run() == Phase.FAILED
    levels = [s.fallback for s in fsm.log]
    for lv in (Fallback.F1_RESEED, Fallback.F2_REOBSERVE, Fallback.F3_CROSSCHECK,
               Fallback.F4_OPERATOR, Fallback.F5_ESTOP):
        assert lv in levels, f"{lv} 미도달"
    assert "widen_search" in _names(p) and "nudge_out" in _names(p)
    # 가드레일: 실패 전에 이미 하차 완료(문 안 막음) + 재승선 없음
    assert "switch_map_and_seed" in _names(p)
    assert Phase.ENTER not in _phases(fsm)[_phases(fsm).index(Phase.EXIT):]


def test_relocalize_operator_confirm_recovers_to_done():
    p = MockPorts(relocalize_status={"score": 0.2, "covariance": 0.9, "multimap_margin": 0.0},
                  operator_confirmed=True)
    fsm = ElevatorFSM(p, _cfg(t_reloc_level=2))
    assert fsm.run() == Phase.DONE
    assert Fallback.F4_OPERATOR in [s.fallback for s in fsm.log]
    assert "unfreeze" in _names(p)


def test_normal_only_if_score_and_consensus():
    # 스코어는 좋지만 vision 층이 목적층과 불일치 → 합의 실패 → 수렴 아님 → 폴백.
    p = MockPorts(indicated_floor="B1",
                  relocalize_status={"score": 0.95, "covariance": 0.05, "multimap_margin": 0.4})
    fsm = ElevatorFSM(p, _cfg(t_ride=3, t_reloc_level=2))
    # indicated!=B2 라 RIDE 에서 도착 판정 자체가 안 됨 → RIDE 타임아웃 실패
    assert fsm.run() == Phase.FAILED
    assert Phase.RELOCALIZE not in _phases(fsm)


def test_relocalize_consensus_gate_directly():
    # RELOCALIZE 진입 후 스코어 좋아도 층 불일치면 수렴 판정 False 여야 함(단위 확인).
    p = MockPorts()
    fsm = ElevatorFSM(p, _cfg())
    fsm.phase = Phase.RELOCALIZE
    p._d["relocalize_status"] = {"score": 0.99, "covariance": 0.01, "multimap_margin": 0.5}
    p._d["indicated_floor"] = "B2"
    assert fsm._relocalize_converged() is True
    p._d["indicated_floor"] = "B1"
    assert fsm._relocalize_converged() is False


# ─────────────────────── 가드레일 ───────────────────────
def test_reboard_guard_raises():
    p = MockPorts()
    fsm = ElevatorFSM(p, _cfg())
    fsm._exit_started = True
    for back in (Phase.ENTER, Phase.ALIGN, Phase.RIDE, Phase.ARRIVE):
        try:
            fsm._goto(back)
            assert False, f"{back} 재승선이 허용됨"
        except AssertionError as e:
            assert "재승선" in str(e)


def test_freeze_held_from_enter_until_done():
    p = MockPorts()
    fsm = ElevatorFSM(p, _cfg(assisted=True))
    saw_frozen = False
    for _ in range(2000):
        fsm.tick()
        if fsm.phase in efsm.FREEZE_PHASES:
            assert fsm.is_frozen(), f"{fsm.phase} 에서 freeze 안 됨"
            saw_frozen = True
        if fsm.phase in efsm.TERMINAL:
            break
    assert saw_frozen
    assert fsm.phase == Phase.DONE
    assert not fsm.is_frozen()             # DONE 에서 해제
