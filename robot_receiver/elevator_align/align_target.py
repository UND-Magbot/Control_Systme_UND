"""정렬 코어의 데이터 구조·파라미터 (설계문서 §8.0 규약 / §9 기본값).

모든 상수의 단일 진실원천. wall_fit·control_law·align_core·tests 가 공유한다.
단위: 거리 m, 각 rad, 속도 m/s·rad/s (§8.0-C9).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .self_mask import SelfMask, DEFAULT_SELF_MASK


# ─────────────────────────── 기하 ───────────────────────────
@dataclass(frozen=True)
class BoxSpec:
    """엘베 내부 직사각형(box 프레임, §8.0-C3).

    Xb 0..depth (뒷벽=0, 문/앞벽=depth), Yb -width/2..+width/2 (좌=+, 우=-).
    door_w = 앞벽(Xb=depth) 중앙의 문 개구 폭(스캔에서 빈 구멍으로 관측).
    """
    depth: float = 2.2   # Xb 방향 깊이(뒷벽→문)
    width: float = 2.2   # Yb 방향 폭(좌↔우)
    door_w: float = 0.72


# ─────────────────────────── 벽피팅 ───────────────────────────
@dataclass(frozen=True)
class WallParams:
    """fit_walls 파라미터 (§9)."""
    coarse_deg: float = 40.0      # 방위 탐색 범위 ±deg (로봇이 문을 대략 향한다는 전제)
    coarse_step_deg: float = 2.0
    fine_step_deg: float = 0.25
    fine_span_deg: float = 2.5
    edge_eps: float = 0.05        # 이 거리 내면 벽 인라이어(m)
    trim: float = 0.03            # min/max 산출 시 이상치 절삭 비율(양끝 각각)
    min_inliers: int = 24


@dataclass(frozen=True)
class WallFit:
    """벽피팅 결과 — 로봇(=body 원점)에서 각 벽까지 거리 + box 대비 heading.

    back/left/right = box 프레임 뒷벽/좌벽/우벽까지 수직거리(§8.0-C4/C5).
    yaw_err = box Xb(문 법선) 대비 로봇 heading(rad). 0 = 문 정면.
    """
    back: float
    left: float
    right: float
    yaw_err: float
    inliers: int
    ok: bool
    front: float | None = None    # 문벽까지(문 구멍 때문에 신뢰도 낮음 — 제어 미사용)


# ─────────────────────────── 목표·게인 ───────────────────────────
@dataclass(frozen=True)
class AlignTarget:
    """목표 상대자세 (box 프레임, 저장맵 좌표 아님 — §8.0-C6, §9)."""
    d_back: float = 0.34          # [3벽 모드] 뒷벽에서 목표 이격(Xb)
    lateral_offset: float = 0.42  # 패널쪽 좌우 오프셋(m)
    lateral_sign: int = -1        # 패널 위치: 우벽(-Yb)이면 -1, 좌벽(+Yb)이면 +1
    heading: float = 0.0          # 목표 heading(문 정면=0)
    # [옆벽 모드] 앞뒤 깊이 목표(문에서 뒤로). 뒷벽 못 봐서 오도메트리로 맞춤(§ 옆벽 모드).
    # 로봇(팔 반경) 기준 기본값 — 엘베별 override 가능(설계 P2). 입력 없어도 이 값으로 동작.
    d_target: float = 0.55

    @property
    def y_target(self) -> float:
        """box Yb 목표 좌표."""
        return self.lateral_sign * self.lateral_offset


@dataclass(frozen=True)
class SidesFit:
    """옆벽(좌·우) 전용 피팅 — self-mask로 앞/뒤가 사라진 이 로봇의 기본 모드.

    뒷벽은 로봇 몸에 가려 못 봄 → 좌우 중앙·heading만 옆벽으로, 앞뒤(x_b)는 오도메트리.
    """
    left: float          # 좌벽(+Yb)까지
    right: float         # 우벽(-Yb)까지
    yaw_err: float       # box Xb 대비 heading(rad)
    y_b: float           # 좌우 중앙 오차 (0=정중앙)
    width: float         # 추정 폭(left+right)
    inliers: int
    ok: bool


@dataclass(frozen=True)
class Gains:
    """P 제어 게인·한계 (§9)."""
    kp: float = 0.9      # 위치 P
    kpw: float = 1.4     # heading P
    v_max: float = 0.55  # m/s
    w_max: float = 1.6   # rad/s


@dataclass(frozen=True)
class AlignConfig:
    box: BoxSpec = field(default_factory=BoxSpec)
    target: AlignTarget = field(default_factory=AlignTarget)
    gains: Gains = field(default_factory=Gains)
    wall: WallParams = field(default_factory=WallParams)
    tol_xy: float = 0.05          # 수렴 허용(위치, m) §9
    tol_yaw: float = 0.052        # 수렴 허용(각, rad ≈3°)
    dt: float = 0.1               # 제어 주기(s, 10Hz)
    # ── 정렬 모드 = 로봇 센서 성질(환경 무관, §12.3) ──
    # "sides": 이 로봇 기본. 몸이 앞/뒤 가림 → 좌·우 옆벽으로 중앙·heading, 앞뒤는 오도메트리.
    # "walls": 뒤·좌·우 3벽 다 보이는 일반 로봇/sim용.
    mode: str = "sides"
    self_mask: SelfMask | None = DEFAULT_SELF_MASK   # self-return 제거(§12-F). None이면 미적용


def default_config() -> AlignConfig:
    return AlignConfig()


# ─────────────────────────── 출력 ───────────────────────────
@dataclass(frozen=True)
class VelocityCmd:
    """로봇 속도 setpoint (body 프레임, §8.0-C8). vx=전방+, vy=좌+, wz=CCW+."""
    vx: float
    vy: float
    wz: float


@dataclass(frozen=True)
class AlignStatus:
    err_xy: float     # 위치 오차 크기(m)
    err_yaw: float    # heading 오차 크기(rad)
    converged: bool
    reason: str


def wrap_angle(a: float) -> float:
    """[-π, π] 로 정규화 (§8.0-C2)."""
    return math.atan2(math.sin(a), math.cos(a))
