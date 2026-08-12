"""엘리베이터 내부 정렬(반응 제어) 코어 — Stage 1.

측위(전역 localization) OFF 상태에서, 라이다 body 스캔([x,y] 점군)으로 엘베 벽/문을
매 사이클 새로 읽어 목표 상대자세로 수렴시키는 폐루프(반응) 제어의 순수 알고리즘.

- 로봇/ROS2 비의존 → 합성 스캔으로 완전 오프라인 단위테스트 가능.
- 좌표 규약은 설계문서 DESIGN-ELEVATOR-TRANSITION §8.0(REP-103 기본)을 따른다.
  body: +x 전방, +y 좌, yaw CCW+.  box: 원점=뒷벽중앙, Xb=문 법선(전방), Yb=좌.

공개 API:
  parse_scan / ScanFrame            (scan_types)
  fit_walls -> WallFit              (wall_fit)
  compute_cmd -> VelocityCmd, AlignStatus   (control_law)
  step / simulate_run              (align_core)
"""

from .align_target import (
    BoxSpec, WallParams, Gains, AlignTarget, AlignConfig,
    WallFit, VelocityCmd, AlignStatus, default_config,
)
from .scan_types import ScanFrame, parse_scan
from .self_mask import SelfMask, calibrate, DEFAULT_SELF_MASK
from .wall_fit import fit_walls, wallfit_from_pose
from .sides_fit import fit_sides
from .control_law import compute_cmd, compute_cmd_sides, pose_from_wallfit
from .align_core import step, simulate_run

__all__ = [
    "BoxSpec", "WallParams", "Gains", "AlignTarget", "AlignConfig",
    "WallFit", "VelocityCmd", "AlignStatus", "default_config",
    "ScanFrame", "parse_scan",
    "SelfMask", "calibrate", "DEFAULT_SELF_MASK",
    "fit_walls", "wallfit_from_pose", "fit_sides",
    "compute_cmd", "compute_cmd_sides", "pose_from_wallfit",
    "step", "simulate_run",
]
