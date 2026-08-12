"""반응 노드의 '순수 드라이버' — ROS2 비의존, 로봇 없이 pytest 검증 가능.

ROS2 래퍼(elevator_align_node.py)는 라이다 콜백/타이머/발행만 담당하고, **판단 로직은
전부 여기**에 둔다. 그래서 안전 동작(stale→zero, 예외→zero, 저속 상한 클램프)을
합성 스캔으로 완전 오프라인 검증할 수 있다.

안전(§12.1):
  - **stale→zero**: 라이다 최신 스캔이 stale_timeout 초과면 명령 0 (구독 끊김 방어).
  - **fault→zero**: 벽피팅/제어 중 예외면 명령 0.
  - **저속 상한**: 노드 CLI 상한(§9보다 낮게 시작)으로 코어 명령을 재클램프.
"""
from __future__ import annotations

from dataclasses import dataclass

from .align_target import AlignConfig, VelocityCmd, AlignStatus
from .scan_types import ScanFrame
from .wall_fit import fit_walls
from .sides_fit import fit_sides
from .control_law import compute_cmd, compute_cmd_sides

ZERO = VelocityCmd(0.0, 0.0, 0.0)


@dataclass
class DriveResult:
    cmd: VelocityCmd
    ok: bool           # 유효 명령(측정·수렴계산 성공)인가
    reason: str
    err_xy: float = 0.0
    err_yaw: float = 0.0
    wall_ok: bool = False           # fit ok (모드 공통)
    # 옆벽 모드 로깅용(sides 모드일 때)
    left: float | None = None
    right: float | None = None
    y_b: float | None = None
    yaw: float | None = None


def _clamp(v: float, lim: float) -> float:
    return max(-lim, min(lim, v))


class AlignDriver:
    """라이다 스캔을 받아 안전-클램프된 속도명령을 산출한다."""

    def __init__(self, cfg: AlignConfig | None = None, *,
                 max_vx: float = 0.55, max_vy: float = 0.55, max_wz: float = 1.6,
                 stale_timeout: float = 0.5):
        self.cfg = cfg or AlignConfig()
        self.max_vx = max_vx
        self.max_vy = max_vy
        self.max_wz = max_wz
        self.stale_timeout = stale_timeout
        self._pts: list | None = None
        self._t: float = -1e9
        self._odom_depth: float | None = None   # 문턱 기준 후진 깊이(옆벽 모드 앞뒤)

    def update_scan(self, points, now: float) -> None:
        """최신 라이다 스캔([x,y] body) + 수신 시각(단조초) 저장."""
        self._pts = points
        self._t = now

    def update_odom(self, depth: float | None) -> None:
        """옆벽 모드 앞뒤용 — 문턱에서 후진한 현재 깊이(m). None이면 앞뒤 hold."""
        self._odom_depth = depth

    def _fit_and_cmd(self):
        """모드에 따라 (cmd, status, ok, extra) 산출. self_mask 적용."""
        scan = ScanFrame(list(self._pts))
        if self.cfg.mode == "sides":
            sf = fit_sides(scan, self.cfg.wall, self_mask=self.cfg.self_mask)
            cmd, st = compute_cmd_sides(sf, self.cfg, odom_depth=self._odom_depth)
            extra = dict(left=sf.left, right=sf.right, y_b=sf.y_b, yaw=sf.yaw_err)
            return cmd, st, sf.ok, extra
        # walls(3벽) — 일반/sim
        wf = fit_walls(scan, self.cfg.wall, self_mask=self.cfg.self_mask)
        cmd, st = compute_cmd(wf, self.cfg)
        return cmd, st, wf.ok, {}

    def compute(self, now: float) -> DriveResult:
        # stale/미수신 → zero (구독 끊김·노드 hang 방어의 소프트 측)
        if self._pts is None:
            return DriveResult(ZERO, ok=False, reason="스캔 미수신 → 0")
        if now - self._t > self.stale_timeout:
            return DriveResult(ZERO, ok=False, reason=f"스캔 stale({now - self._t:.2f}s) → 0")
        # fault → zero
        try:
            cmd, st, fit_ok, extra = self._fit_and_cmd()
        except Exception as e:  # noqa: BLE001 — 어떤 계산 오류든 안전측(0)로
            return DriveResult(ZERO, ok=False, reason=f"예외 → 0: {e}")
        if not fit_ok:
            return DriveResult(ZERO, ok=False, reason="벽 미확보 → 0",
                               err_xy=st.err_xy, err_yaw=st.err_yaw, wall_ok=False, **extra)
        # 저속 상한 재클램프(노드 CLI 상한)
        safe = VelocityCmd(
            vx=_clamp(cmd.vx, self.max_vx),
            vy=_clamp(cmd.vy, self.max_vy),
            wz=_clamp(cmd.wz, self.max_wz),
        )
        return DriveResult(safe, ok=True, reason=st.reason,
                           err_xy=st.err_xy, err_yaw=st.err_yaw, wall_ok=True, **extra)

    def zero(self) -> VelocityCmd:
        return ZERO
