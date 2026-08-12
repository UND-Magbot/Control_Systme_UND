"""엘리베이터 전이 상태머신 (S3~S9) — Stage 2 (백엔드 오케스트레이션).

설계: DESIGN-ELEVATOR-TRANSITION §2(FSM)·§5(재측위·폴백)·§8.3(백엔드↔노드).

★ 이 모듈은 **로봇 모터를 직접 구동하지 않는다.**
  - 실제 속도(vx,vy,ωz)는 Stage 3 ROS2 노드가 라이다 옆에서 10Hz로 발행한다.
  - 여기(백엔드)는 **상태 결정 + 코스 트리거**(정렬 시작/버튼/맵전환·seed/정지)와
    상태 판독(정렬 수렴·문 열림·층 합의·재측위 스코어)만 담당한다.
  - 그래서 모든 외부 작용은 `Ports` 인터페이스로 주입 → 로봇 없이 mock 으로 검증.

의존성: 표준 라이브러리만(top-level). 실코드 연동(floor_transition/runtime 등)은
`BackendPorts` 안에서 **lazy import** → 단독 import 가능(테스트가 app 전체를 안 켬).

좌표/측위 규약과 안전(측위 off ≠ estop 무력화, 워치독)은 §8.0·§12.1 참조.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol


class Phase(enum.Enum):
    APPROACH = "approach"       # S1 로비 진입점 접근 (assisted=사람이 데려옴)
    DOOR_WAIT = "door_wait"     # S2 문 열림 대기
    ENTER = "enter"             # S3 진입 — ★측위 freeze 시작
    ALIGN = "align"             # S4 내부 정렬(반응 제어, 노드가 수행)
    SELECT = "select"           # S5 목적층 버튼(자율만; assisted 생략)
    RIDE = "ride"               # S6 이동·층표시등 모니터
    ARRIVE = "arrive"           # S7 도착 — 3자 합의
    EXIT = "exit"               # S8 하차 — ★freeze 해제
    RELOCALIZE = "relocalize"   # S9 도착층 맵전환 + 로비 seed 재측위
    DONE = "done"               # NORMAL 복귀(성공)
    FAILED = "failed"           # 안전 정지 유지(실패)


TERMINAL = {Phase.DONE, Phase.FAILED}
FREEZE_PHASES = {Phase.ENTER, Phase.ALIGN, Phase.SELECT, Phase.RIDE, Phase.ARRIVE, Phase.EXIT}


class Fallback(enum.Enum):
    NONE = "none"
    F1_RESEED = "f1_reseed"          # 재시드·탐색확대
    F2_REOBSERVE = "f2_reobserve"    # 능동 재관측(문턱 밖 소폭 전진)
    F3_CROSSCHECK = "f3_crosscheck"  # intent+vision+IMU 고도 교차검증
    F4_OPERATOR = "f4_operator"      # 조작자 확정
    F5_ESTOP = "f5_estop"            # 안전 정지 유지


@dataclass
class FsmConfig:
    target_floor: str                       # 목적층(intent)
    seed_pose: dict                         # S9 로비 진입점 seed {x,y,yaw,map_id}
    align_target: dict = field(default_factory=dict)
    assisted: bool = True                   # True=S1/S5(RM) 생략(사람이 태워줌)
    # 상태별 타임아웃(tick 수 = 폴링 횟수)
    t_approach: int = 60
    t_door: int = 40
    t_enter: int = 40
    t_align: int = 80
    t_select: int = 30
    t_ride: int = 400
    t_arrive: int = 60
    t_exit: int = 40
    t_reloc_level: int = 20                  # 폴백 각 단계 창(tick)
    # 재측위 임계(§5.1) — 실측 확정 전 잠정
    score_thresh: float = 0.60
    cov_thresh: float = 0.50
    multimap_margin: float = 0.15


@dataclass
class Step:
    phase: Phase
    fallback: Fallback
    note: str


class Ports(Protocol):
    """FSM 외부작용 인터페이스. 실환경=BackendPorts, 테스트=Mock 구현."""
    # ── 판독(상태) ──
    def at_lobby(self) -> bool: ...
    def door_open(self) -> bool: ...
    def inside_elevator(self) -> bool: ...
    def align_converged(self) -> bool: ...
    def button_confirmed(self) -> bool: ...
    def indicated_floor(self) -> Optional[str]: ...       # 층표시등(vision)
    def scan_candidate_floor(self) -> Optional[str]: ...  # 후보맵 스캔매칭 최고점
    def altitude_floor(self) -> Optional[str]: ...        # IMU 고도 추정 층(F3)
    def exited(self) -> bool: ...
    def relocalize_status(self) -> dict: ...              # {score,covariance,multimap_margin,converged}
    def operator_confirmed(self) -> bool: ...
    # ── 작용(코스 트리거) ──
    def freeze_localization(self) -> None: ...            # S3
    def start_align(self, target: dict) -> None: ...      # S4
    def press_button(self, floor: str) -> None: ...       # S5
    def switch_map_and_seed(self, seed: dict) -> None: ...# S9
    def widen_search(self) -> None: ...                   # F1
    def nudge_out(self, dist: float) -> None: ...         # F2
    def operator_prompt(self, info: dict) -> None: ...    # F4
    def hold_safe(self, reason: str) -> None: ...         # F5/abort
    def unfreeze_and_resume(self) -> None: ...            # DONE


class ElevatorFSM:
    """틱 구동 결정론 상태머신. `tick()` 1회 = 1 폴링 주기."""

    def __init__(self, ports: Ports, config: FsmConfig, start: Phase = Phase.APPROACH):
        self.ports = ports
        self.cfg = config
        self.phase = start
        self.fallback = Fallback.NONE
        self.ticks = 0                  # 현재 phase 진입 후 경과 tick
        self.log: list[Step] = []
        self._frozen = False
        self._exit_started = False      # 하차 시작 후 재승선 금지 가드
        self._reloc_seeded = False
        self._level_ticks = 0           # 폴백 현재 단계 경과 tick
        self._record("초기화")

    # ────────────────────── 공용 ──────────────────────
    def run(self, max_ticks: int = 2000) -> Phase:
        n = 0
        while self.phase not in TERMINAL and n < max_ticks:
            self.tick()
            n += 1
        return self.phase

    def is_frozen(self) -> bool:
        return self._frozen

    def _record(self, note: str):
        self.log.append(Step(self.phase, self.fallback, note))

    def _goto(self, phase: Phase, note: str = ""):
        # 재승선 금지 가드(§5.1) — 하차 이후 진입/정렬로 되돌아가지 않는다.
        if self._exit_started and phase in {Phase.ENTER, Phase.ALIGN, Phase.SELECT, Phase.RIDE, Phase.ARRIVE}:
            raise AssertionError(f"재승선 금지 위반: {self.phase}→{phase}")
        self.phase = phase
        self.ticks = 0
        self._level_ticks = 0
        if phase != Phase.RELOCALIZE:
            self.fallback = Fallback.NONE
        self._record(note or f"→ {phase.value}")

    def _fail(self, reason: str):
        # 안전 정지 유지 + freeze 해제 금지(미확정이면 nav 보류 유지).
        self.ports.hold_safe(reason)
        self._goto(Phase.FAILED, f"실패: {reason}")

    def _timed_out(self, limit: int) -> bool:
        return self.ticks >= limit

    # ────────────────────── 틱 ──────────────────────
    def tick(self) -> Phase:
        if self.phase in TERMINAL:
            return self.phase
        self.ticks += 1
        handler = getattr(self, f"_on_{self.phase.value}")
        handler()
        return self.phase

    def _on_approach(self):
        if self.ports.at_lobby():
            self._goto(Phase.DOOR_WAIT, "로비 진입점 도달")
        elif self._timed_out(self.cfg.t_approach):
            self._fail("로비 접근 타임아웃")

    def _on_door_wait(self):
        if self.ports.door_open():
            # S3 진입 = 측위 freeze 시작(§2.1). 전이 시점에 원자적으로 적용
            # (phase 는 ENTER 인데 아직 미freeze 인 틱이 생기지 않도록).
            if not self._frozen:
                self.ports.freeze_localization()
                self._frozen = True
            self._goto(Phase.ENTER, "문 열림 감지 → 진입(측위 freeze·nav 보류)")
        elif self._timed_out(self.cfg.t_door):
            self._fail("문 열림 대기 타임아웃")

    def _on_enter(self):
        # 진입 중 문이 닫히면 위험 → 안전 정지(반쯤 낀 채 진행 금지)
        if not self.ports.door_open() and not self.ports.inside_elevator():
            self._fail("진입 중 문 닫힘")
            return
        if self.ports.inside_elevator():
            self.ports.start_align(self.cfg.align_target)
            self._goto(Phase.ALIGN, "진입 완료 → 정렬 시작")
        elif self._timed_out(self.cfg.t_enter):
            self._fail("진입 타임아웃")

    def _on_align(self):
        # S4 정렬은 노드(반응 제어)가 수행 — 여기선 수렴 여부만 판독.
        if self.ports.align_converged():
            if self.cfg.assisted:
                self._goto(Phase.RIDE, "정렬 완료(assisted: 버튼 생략) → 이동")
            else:
                self.ports.press_button(self.cfg.target_floor)
                self._goto(Phase.SELECT, "정렬 완료 → 버튼 누름")
        elif self._timed_out(self.cfg.t_align):
            self._fail("정렬 수렴 타임아웃")

    def _on_select(self):
        if self.ports.button_confirmed():
            self._goto(Phase.RIDE, "버튼 확인(점등) → 이동")
        elif self._timed_out(self.cfg.t_select):
            self._fail("버튼 누름 확인 타임아웃")

    def _on_ride(self):
        if self.ports.indicated_floor() == self.cfg.target_floor:
            self._goto(Phase.ARRIVE, "층표시등=목적층 → 도착 판정")
        elif self._timed_out(self.cfg.t_ride):
            self._fail("이동(층 도착) 타임아웃")

    def _on_arrive(self):
        # S7 3자 합의(intent·vision·scan) + 문 열림에서만 하차 승인(§3 G2).
        consensus = self._floor_consensus()
        if consensus and self.ports.door_open():
            self._exit_started = True
            self._goto(Phase.EXIT, "3자 합의 + 문 열림 → 하차")
        elif self._timed_out(self.cfg.t_arrive):
            # 합의 실패로 하차 안 함 — 반쯤 낀 채 정지 금지(아직 내부, 문 안 막음).
            self.ports.operator_prompt({"reason": "층 3자 합의 실패",
                                        "intent": self.cfg.target_floor,
                                        "vision": self.ports.indicated_floor(),
                                        "scan": self.ports.scan_candidate_floor()})
            self._fail("도착 3자 합의 실패(하차 보류)")

    def _on_exit(self):
        if self.ports.exited():
            # S8 하차 완료 = freeze 해제 → S9 재측위 시작(맵전환 + seed).
            self.ports.switch_map_and_seed(self.cfg.seed_pose)
            self._reloc_seeded = True
            self._goto(Phase.RELOCALIZE, "하차 완료 → 도착층 맵전환·seed 재측위")
        elif self._timed_out(self.cfg.t_exit):
            self._fail("하차 타임아웃")

    def _on_relocalize(self):
        # 이미 로비로 나온 상태(EXIT 이후) → 문 안 막음. NORMAL 복귀는 스코어∧합의에서만.
        if self._relocalize_converged():
            self._frozen = False
            self.ports.unfreeze_and_resume()
            self._goto(Phase.DONE, "재측위 수렴 + 층 합의 → NORMAL 복귀")
            return
        # 폴백 사다리 F1→F5 (§5.1)
        self._level_ticks += 1
        if self.fallback == Fallback.NONE:
            self._enter_fallback(Fallback.F1_RESEED)
        elif self._level_ticks >= self.cfg.t_reloc_level:
            self._escalate()

    # ────────────────────── 폴백 사다리 ──────────────────────
    def _enter_fallback(self, level: Fallback):
        self.fallback = level
        self._level_ticks = 0
        if level == Fallback.F1_RESEED:
            self.ports.widen_search()
            self._record("F1 재시드·탐색창 확대")
        elif level == Fallback.F2_REOBSERVE:
            self.ports.nudge_out(0.30)
            self._record("F2 능동 재관측(문턱 밖 0.30m)")
        elif level == Fallback.F3_CROSSCHECK:
            ok = self._crosscheck_floor()
            self._record(f"F3 교차검증: 층일치={ok} (측위만 미수렴 여부 판별)")
        elif level == Fallback.F4_OPERATOR:
            self.ports.operator_prompt({"reason": "재측위 미수렴",
                                        "intent": self.cfg.target_floor,
                                        "status": self.ports.relocalize_status()})
            self._record("F4 조작자 확정 요청")
        elif level == Fallback.F5_ESTOP:
            self._record("F5 안전 정지 유지")

    def _escalate(self):
        order = [Fallback.F1_RESEED, Fallback.F2_REOBSERVE, Fallback.F3_CROSSCHECK,
                 Fallback.F4_OPERATOR, Fallback.F5_ESTOP]
        # F4 에서 조작자 확정 시 즉시 NORMAL 복귀(기존 수동 activate 경로 재사용).
        if self.fallback == Fallback.F4_OPERATOR:
            if self.ports.operator_confirmed():
                self._frozen = False
                self.ports.unfreeze_and_resume()
                self._goto(Phase.DONE, "조작자 확정 → NORMAL 복귀")
                return
        idx = order.index(self.fallback)
        if idx + 1 < len(order):
            self._enter_fallback(order[idx + 1])
        else:
            # F5 도달 → 최종 실패(estop 유지, 재승선 금지 이미 보장).
            self._fail("재측위 폴백 소진(F5) — 조작자 개입 필요")

    # ────────────────────── 판정 헬퍼 ──────────────────────
    def _floor_consensus(self) -> bool:
        intent = self.cfg.target_floor
        vision = self.ports.indicated_floor()
        scan = self.ports.scan_candidate_floor()
        return vision == intent and scan == intent

    def _crosscheck_floor(self) -> bool:
        intent = self.cfg.target_floor
        return (self.ports.indicated_floor() == intent
                and self.ports.altitude_floor() == intent)

    def _relocalize_converged(self) -> bool:
        st = self.ports.relocalize_status() or {}
        score_ok = (st.get("score", 0.0) >= self.cfg.score_thresh
                    and st.get("covariance", 1.0) <= self.cfg.cov_thresh
                    and st.get("multimap_margin", 0.0) >= self.cfg.multimap_margin)
        consensus_ok = self.ports.indicated_floor() == self.cfg.target_floor
        # NORMAL 복귀 = 스코어 임계 통과 AND 층 합의(§5.1 가드레일)
        return bool(score_ok and consensus_ok)


# ─────────────────────── 실환경 어댑터(참고용, 미검증) ───────────────────────
class BackendPorts:
    """실코드 연동 어댑터 — S9(재측위)는 기존 floor_transition/runtime 재사용,
    노드(정렬)·비전은 Stage 3/4 미구현이라 NotImplementedError.

    ⚠️ 테스트에서 사용하지 않는다(로봇/DB 필요). lazy import 로 단독 import 안전.
    """

    def __init__(self, robot_id: int):
        self.robot_id = robot_id

    # 판독 — 노드/비전(Stage 3/4)
    def at_lobby(self) -> bool: raise NotImplementedError("Stage 3: nav 상태")
    def door_open(self) -> bool: raise NotImplementedError("Stage 4: 문 비전")
    def inside_elevator(self) -> bool: raise NotImplementedError("Stage 3/4")
    def align_converged(self) -> bool: raise NotImplementedError("Stage 3: 노드 상태")
    def button_confirmed(self) -> bool: raise NotImplementedError("Stage 4: 버튼 점등")
    def indicated_floor(self): raise NotImplementedError("Stage 4: 층표시등")
    def scan_candidate_floor(self): raise NotImplementedError("Stage 3: 후보맵 스캔")
    def altitude_floor(self): raise NotImplementedError("Stage 4: IMU 고도")
    def exited(self) -> bool: raise NotImplementedError("Stage 3/4")
    def operator_confirmed(self) -> bool: raise NotImplementedError("운영 UI")

    def relocalize_status(self) -> dict:
        # TODO Stage 3: 스캔매칭 스코어/공분산/멀티맵 마진 노출(현행 verify_and_clear는 검증+해제 결합).
        raise NotImplementedError("Stage 3: 재측위 상태 read-only 노출 필요")

    # 작용 — S9/freeze 는 기존 코드 재사용(lazy import)
    def freeze_localization(self) -> None:
        import app.robot_io.runtime as runtime
        runtime.set_initpose_pending(self.robot_id, True, "엘베 전이(측위 freeze)")

    def start_align(self, target: dict) -> None:
        raise NotImplementedError("Stage 3: 노드 ALIGN_START 트리거")

    def press_button(self, floor: str) -> None:
        raise NotImplementedError("Stage 4: RM 버튼 누름(TCP 8080)")

    def switch_map_and_seed(self, seed: dict) -> None:
        # 기존 S9 경로 재사용(floor_transition 참조).
        raise NotImplementedError("Stage 3: switch_active_map + _send_init_pose_via_receiver 연동")

    def widen_search(self) -> None: raise NotImplementedError("Stage 3: 파티클 분산 확대")
    def nudge_out(self, dist: float) -> None: raise NotImplementedError("Stage 3: 캔드 기동")

    def operator_prompt(self, info: dict) -> None:
        try:
            from app.logs.service import log_event
            log_event("schedule", "elevator_operator_prompt", str(info), robot_id=self.robot_id)
        except Exception:
            pass

    def hold_safe(self, reason: str) -> None:
        try:
            from app.navigation.send_move import stop_navigation_internal
            stop_navigation_internal(reason=f"엘베 전이 안전정지: {reason}")
        except Exception:
            pass

    def unfreeze_and_resume(self) -> None:
        import app.robot_io.runtime as runtime
        runtime.set_initpose_pending(self.robot_id, False, "엘베 전이 완료")
        try:
            from app.navigation.send_move import resume_after_transition
            resume_after_transition(self.robot_id)
        except Exception:
            pass
