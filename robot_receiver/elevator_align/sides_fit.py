"""옆벽(좌·우) 피팅 — self-mask 후 남는 양옆 벽으로 좌우 중앙·heading 추정.

이 로봇은 몸이 앞/뒤를 가려(§12-F) 뒷벽을 못 본다. 대신 **양옆은 트여** 좌·우 벽이
보이므로, 그 2개 평행벽으로:
  - yaw_err : 벽 방향(box Xb) 대비 heading
  - y_b     : 좌우 중앙 오차 (좌·우 거리 차)
  - left/right/width
앞뒤(x_b)는 옆벽으로 못 구함 → 오도메트리(후진 거리)로 별도(control_law.compute_cmd_sides).

방법: 2 평행벽은 정렬각 α에서 '수평 2밴드(y=const)'가 된다. y-잔차 최소화로 α 탐색.
"""
from __future__ import annotations

import math

from .align_target import WallParams, SidesFit
from .wall_fit import _rotate, _trimmed_bounds


def _side_residual(points, trim):
    """y-축 2밴드(좌·우 벽) 정렬도 — 각 점의 '가까운 y-경계까지 거리' 평균."""
    ys = [p[1] for p in points]
    miny, maxy = _trimmed_bounds(ys, trim)
    tot = 0.0
    for (_, y) in points:
        tot += min(abs(y - miny), abs(maxy - y))
    return tot / len(points), (miny, maxy)


def _search_side_angle(points, p: WallParams):
    best_a, best_r = 0.0, math.inf
    n = int(p.coarse_deg / p.coarse_step_deg)
    for i in range(-n, n + 1):
        a = math.radians(i * p.coarse_step_deg)
        r, _ = _side_residual(_rotate(points, a), p.trim)
        if r < best_r:
            best_r, best_a = r, a
    fn = int(p.fine_span_deg / p.fine_step_deg)
    base = best_a
    for i in range(-fn, fn + 1):
        a = base + math.radians(i * p.fine_step_deg)
        r, _ = _side_residual(_rotate(points, a), p.trim)
        if r < best_r:
            best_r, best_a = r, a
    return best_a


def fit_sides(scan, params: WallParams | None = None, self_mask=None,
              max_range: float = 2.5, min_side_inliers: int = 8) -> SidesFit:
    """body 스캔 → SidesFit. self_mask로 self 제거 후 옆벽만으로 피팅."""
    p = params or WallParams()
    points = getattr(scan, "points", scan)
    if self_mask is not None:
        points = self_mask.apply(points)
    # 옆벽 후보: 근접(엘베 폭 범위). 먼 잡음 제외.
    near = [(x, y) for (x, y) in points if math.hypot(x, y) < max_range]
    if len(near) < min_side_inliers * 2:
        return SidesFit(0.0, 0.0, 0.0, 0.0, 0.0, len(near), ok=False)

    a = _search_side_angle(near, p)
    rot = _rotate(near, a)
    _, (miny, maxy) = _side_residual(rot, p.trim)
    left = maxy          # +Yb 벽
    right = -miny        # -Yb 벽

    eps = p.edge_eps
    have_left = sum(1 for (_, y) in rot if abs(y - maxy) < eps)
    have_right = sum(1 for (_, y) in rot if abs(y - miny) < eps)
    ok = (have_left >= min_side_inliers and have_right >= min_side_inliers
          and left > 0 and right > 0)
    y_b = (right - left) / 2.0        # 좌우 중앙 오차 (left=right → 0)
    return SidesFit(left=left, right=right, yaw_err=a, y_b=y_b,
                    width=left + right, inliers=have_left + have_right, ok=ok)
