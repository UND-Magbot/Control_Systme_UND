"""자동문 통과 상태머신 (E5 D3).

엘리베이터 FSM(11단계·측위 freeze·재측위 폴백 F1~F5)과 **의도적으로 분리**한다.
자동문은 층 이동이 없어 freeze도 맵 전환도 없고, 실패의 최악이 '문틀 끼임'이라
안전 동작이 다르다. 한 FSM에 합치면 엘리베이터 안전 로직이 오염된다.

    APPROACH → REQUEST → OPEN_WAIT → PASS → VERIFY → DONE
                            └ timeout ────────→ FALLBACK(조작자) ─┬→ 재개
                                                                  └→ ABORTED

★ 로봇 모터를 직접 구동하지 않는다. 외부 작용은 전부 Ports 로 주입 →
  하드웨어 없이 mock 으로 검증 가능(elevator_fsm.py 와 같은 규약).
표준 라이브러리만 사용한다(단독 import 가능).
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Optional, Protocol


class Phase(enum.Enum):
    APPROACH = "approach"       # 통과 대기점(Near) 접근
    REQUEST = "request"         # 개폐 호출(ControlType 별 드라이버)
    OPEN_WAIT = "open_wait"     # 열림 확인 — '열렸다고 가정'하지 않는다
    PASS = "pass"               # 통과 주행
    VERIFY = "verify"           # 문틀을 완전히 벗어났는지 확인
    DONE = "done"               # 통과 완료(주행 재개)
    FALLBACK = "fallback"       # 조작자 개입 대기(비터미널 — 개입으로 재개 가능)
    ABORTED = "aborted"         # 조작자 중단(안전 정지 유지)


TERMINAL = {Phase.DONE, Phase.ABORTED}

# 대시보드 오버레이가 표시하는 단계 칩 순서(엘리베이터와 같은 문법, 개수만 다름)
DISPLAY_PHASES = [Phase.APPROACH, Phase.REQUEST, Phase.OPEN_WAIT, Phase.PASS, Phase.VERIFY]


class Intent(enum.Enum):
    """FALLBACK 에서 조작자가 넣는 개입. API POST /door/op/{...} 와 1:1."""
    RETRY_OPEN = "retry-open"        # 열림 재요청 — 로봇을 움직이지 않음(무해)
    CONFIRM_PASSED = "confirm-passed"  # 사람이 문을 잡고 "통과해도 됨" 선언 → 이동 유발
    SKIP = "skip"                    # 통과했다고 간주하고 주행 재개 — 위험
    ABORT = "abort"                  # 중단(안전 정지 유지)


@dataclass
class DoorFsmConfig:
    door_id: int
    door_name: str = ""
    reverse: bool = False              # True = Far→Near 방향 통과
    detect_vision: bool = False        # DetectType=vision 이면 열림을 실제로 판독한다
    tick_sec: float = 1.0              # tick 1회가 몇 초인지(타임아웃 환산용)
    approach_timeout_sec: int = 60
    open_timeout_sec: int = 20         # DoorInfo.OpenTimeoutSec
    pass_timeout_sec: int = 30         # DoorInfo.PassTimeoutSec
    verify_timeout_sec: int = 15
    open_grace_sec: int = 3            # 열림 판독 수단이 없을 때의 대기(가정 진입 유예)

    def ticks(self, seconds: int) -> int:
        return max(1, int(round(seconds / self.tick_sec)))


@dataclass
class Step:
    phase: Phase
    note: str


class DoorPorts(Protocol):
    """FSM 외부작용 인터페이스. 실환경=드라이버 어댑터(S4c), 테스트=Mock."""
    # ── 판독 ──
    def at_entry(self) -> bool: ...              # 통과 대기점 도달
    def door_open(self) -> Optional[bool]: ...   # None = 판독 수단 없음
    def passed(self) -> bool: ...                # 반대편 지점 도달
    def clear_of_door(self) -> bool: ...         # 문틀을 완전히 벗어남
    # ── 작용 ──
    def request_open(self) -> None: ...          # 개폐 호출(manual/auto_sensor 는 no-op)
    def back_off(self) -> None: ...              # 후진 폴백 — 전진 강행 금지
    def hold_safe(self, reason: str) -> None: ...
    def operator_prompt(self, info: dict) -> None: ...
    def resume(self) -> None: ...                # 통과 완료 → 원래 경로 주행 재개


class DoorFSM:
    """틱 구동 결정론 상태머신. tick() 1회 = 폴링 1주기."""

    def __init__(self, ports: DoorPorts, config: DoorFsmConfig, start: Phase = Phase.APPROACH):
        self.ports = ports
        self.cfg = config
        self.phase = start
        self.ticks = 0
        self.total_ticks = 0
        self.log: list[Step] = []
        self.reason: Optional[str] = None      # FALLBACK/ABORTED 사유(오버레이 문구)
        self.assumed_open = False              # 판독 없이 '열렸다고 가정'하고 진입했는지
        self._pending: Optional[Intent] = None
        self._record("초기화")

    # ────────────────────── 공용 ──────────────────────
    def submit(self, intent: Intent) -> bool:
        """조작자 개입 접수. FALLBACK 이 아니면 중단(ABORT)만 받는다."""
        if intent == Intent.ABORT:
            self._pending = intent
            return True
        if self.phase != Phase.FALLBACK:
            return False
        self._pending = intent
        return True

    def run(self, max_ticks: int = 2000) -> Phase:
        n = 0
        while self.phase not in TERMINAL and n < max_ticks:
            self.tick()
            n += 1
        return self.phase

    def snapshot(self) -> dict:
        """오버레이(GET /door/op/state)가 그대로 쓰는 표시용 상태."""
        return {
            "phase": self.phase.name,
            "door_id": self.cfg.door_id,
            "door_name": self.cfg.door_name,
            "reverse": self.cfg.reverse,
            "fallback": self.phase == Phase.FALLBACK,
            "aborted": self.phase == Phase.ABORTED,
            "assumed_open": self.assumed_open,
            "message": self.reason,
            "elapsed_sec": int(self.total_ticks * self.cfg.tick_sec),
        }

    # ────────────────────── 내부 ──────────────────────
    def _record(self, note: str) -> None:
        self.log.append(Step(self.phase, note))

    def _goto(self, phase: Phase, note: str = "") -> None:
        self.phase = phase
        self.ticks = 0
        if phase not in (Phase.FALLBACK, Phase.ABORTED):
            self.reason = None
        self._record(note or f"→ {phase.value}")

    def _to_fallback(self, reason: str, back_off: bool = False) -> None:
        # 끼임 위험 구간에서는 멈추기 전에 물러난다(문틀에 반쯤 낀 채 정지 금지).
        if back_off:
            self.ports.back_off()
        self.reason = reason
        self.ports.operator_prompt({"door_id": self.cfg.door_id, "reason": reason})
        self._goto(Phase.FALLBACK, f"FALLBACK: {reason}")

    def _timed_out(self, seconds: int) -> bool:
        return self.ticks >= self.cfg.ticks(seconds)

    def _read_open(self) -> Optional[bool]:
        # 판독 수단이 없으면(DetectType=none) 열림 여부를 알 수 없다고 본다.
        return self.ports.door_open() if self.cfg.detect_vision else None

    # ────────────────────── 틱 ──────────────────────
    def tick(self) -> Phase:
        if self.phase in TERMINAL:
            return self.phase
        self.ticks += 1
        self.total_ticks += 1

        if self._pending is not None:
            intent, self._pending = self._pending, None
            self._apply_intent(intent)
            return self.phase

        getattr(self, f"_on_{self.phase.value}")()
        return self.phase

    def _apply_intent(self, intent: Intent) -> None:
        if intent == Intent.ABORT:
            self.reason = "조작자 중단"
            self.ports.hold_safe("자동문 통과 중단(조작자)")
            self._goto(Phase.ABORTED, "조작자 중단")
        elif intent == Intent.RETRY_OPEN:
            self._goto(Phase.REQUEST, "조작자: 열림 재요청")
        elif intent == Intent.CONFIRM_PASSED:
            self._goto(Phase.PASS, "조작자: 수동 열림 확인 → 통과")
        elif intent == Intent.SKIP:
            self.ports.resume()
            self._goto(Phase.DONE, "조작자: 통과 스킵(강제 진행)")

    def _on_approach(self) -> None:
        if self.ports.at_entry():
            self._goto(Phase.REQUEST, "통과 대기점 도달")
        elif self._timed_out(self.cfg.approach_timeout_sec):
            self._to_fallback("통과 대기점 접근 타임아웃")

    def _on_request(self) -> None:
        # 개폐 호출은 진입 시 1회. auto_sensor/manual 드라이버는 no-op 이다.
        self.ports.request_open()
        self._goto(Phase.OPEN_WAIT, "개폐 호출 → 열림 대기")

    def _on_open_wait(self) -> None:
        state = self._read_open()
        if state is True:
            self.assumed_open = False
            self._goto(Phase.PASS, "열림 확인 → 통과")
            return
        if state is None and self._timed_out(self.cfg.open_grace_sec):
            # 판독 수단이 없을 때만의 경로. '확인'이 아니라 '가정'이므로 상태에 남긴다.
            self.assumed_open = True
            self._goto(Phase.PASS, "열림 판독 없음 → 가정 진입(assumed_open)")
            return
        if self._timed_out(self.cfg.open_timeout_sec):
            self._to_fallback("열림 대기 타임아웃")

    def _on_pass(self) -> None:
        # 통과 중 닫힘 감지 = 끼임 직전. 전진을 강행하지 않고 물러난다.
        if self.cfg.detect_vision and self.ports.door_open() is False:
            self._to_fallback("통과 중 문 닫힘", back_off=True)
            return
        if self.ports.passed():
            self._goto(Phase.VERIFY, "반대편 도달 → 통과 확인")
        elif self._timed_out(self.cfg.pass_timeout_sec):
            self._to_fallback("통과 제한 시간 초과", back_off=True)

    def _on_verify(self) -> None:
        if self.ports.clear_of_door():
            self.ports.resume()
            self._goto(Phase.DONE, "문틀 이탈 확인 → 주행 재개")
        elif self._timed_out(self.cfg.verify_timeout_sec):
            self._to_fallback("통과 확인 실패(문틀 이탈 미확인)")

    def _on_fallback(self) -> None:
        # 조작자 개입을 기다리는 정지 상태. tick 은 경과 시간만 누적한다.
        pass
