"""벽 피팅 — body 스캔([x,y])에서 뒷/좌/우 벽 거리 + box 대비 heading 추정.

방법(순수 파이썬, numpy 불필요):
  1) 방위 탐색 — 후보각 α로 점군을 R(+α) 회전하면, α가 로봇 heading(th_b)과
     같을 때 벽들이 축정렬(box 프레임 정렬)된다(§8.0-C5). 각 점의 '가장 가까운
     경계선까지 거리' 합(잔차)을 최소화하는 α를 coarse→fine 탐색으로 찾는다.
  2) 그 α에서 절삭 min/max 로 4벽 라인을 잡고 로봇(원점)까지 거리 산출.
     back=-min_x, left=max_y, right=-min_y, front=max_x, yaw_err=α.

문 개구(앞벽)는 점이 적어 front 신뢰도만 낮을 뿐, back/left/right 는 견고.
"""
from __future__ import annotations

import math

from .align_target import WallParams, WallFit


def _rotate(points, ang):
    c, s = math.cos(ang), math.sin(ang)
    return [(x * c - y * s, x * s + y * c) for (x, y) in points]  # R(+ang)


def _trimmed_bounds(vals, trim):
    """양끝 trim 비율을 절삭한 min/max (이상치 완화)."""
    if not vals:
        return 0.0, 0.0
    s = sorted(vals)
    k = int(len(s) * trim)
    lo = s[k] if k < len(s) else s[0]
    hi = s[-1 - k] if k < len(s) else s[-1]
    return lo, hi


def _residual(points, trim):
    """점군을 축정렬 사각형으로 봤을 때 '가장 가까운 경계선까지 거리' 평균."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    minx, maxx = _trimmed_bounds(xs, trim)
    miny, maxy = _trimmed_bounds(ys, trim)
    tot = 0.0
    for (x, y) in points:
        d = min(abs(x - minx), abs(maxx - x), abs(y - miny), abs(maxy - y))
        tot += d
    return tot / len(points), (minx, maxx, miny, maxy)


def _search_angle(points, p: WallParams):
    best_a, best_r = 0.0, math.inf
    # coarse
    n = int(p.coarse_deg / p.coarse_step_deg)
    for i in range(-n, n + 1):
        a = math.radians(i * p.coarse_step_deg)
        r, _ = _residual(_rotate(points, a), p.trim)
        if r < best_r:
            best_r, best_a = r, a
    # fine
    fn = int(p.fine_span_deg / p.fine_step_deg)
    base = best_a
    for i in range(-fn, fn + 1):
        a = base + math.radians(i * p.fine_step_deg)
        r, _ = _residual(_rotate(points, a), p.trim)
        if r < best_r:
            best_r, best_a = r, a
    return best_a


def fit_walls(scan, params: WallParams | None = None, self_mask=None) -> WallFit:
    """body 스캔 → WallFit. scan 은 ScanFrame 또는 [[x,y],...].

    self_mask: SelfMask 주면 벽피팅 전에 로봇 자기반사 점을 제거(§12-F).
    """
    p = params or WallParams()
    points = getattr(scan, "points", scan)
    if self_mask is not None:
        points = self_mask.apply(points)
    if len(points) < p.min_inliers:
        return WallFit(0.0, 0.0, 0.0, 0.0, len(points), ok=False)

    a = _search_angle(points, p)
    rot = _rotate(points, a)
    _, (minx, maxx, miny, maxy) = _residual(rot, p.trim)

    back = -minx
    front = maxx
    left = maxy
    right = -miny

    # 인라이어: 경계선 근처 점 수 (벽 확보 판정)
    eps = p.edge_eps
    inl = 0
    have_back = have_left = have_right = 0
    for (x, y) in rot:
        near = False
        if abs(x - minx) < eps:
            have_back += 1; near = True
        if abs(y - maxy) < eps:
            have_left += 1; near = True
        if abs(y - miny) < eps:
            have_right += 1; near = True
        if abs(maxx - x) < eps:
            near = True
        if near:
            inl += 1
    ok = (inl >= p.min_inliers and have_back >= 3 and have_left >= 3 and have_right >= 3
          and back > 0 and left > 0 and right > 0)
    return WallFit(back=back, left=left, right=right, yaw_err=a,
                   inliers=inl, ok=ok, front=front)


def wallfit_from_pose(pose, box) -> WallFit:
    """(x_b, y_b, th_b) 이상적 pose → 이론상 WallFit (테스트/제어 검증용).

    back=x_b, left=W/2 - y_b, right=W/2 + y_b, yaw_err=th_b (§8.0-C5).
    """
    x_b, y_b, th_b = pose
    W = box.width
    return WallFit(back=x_b, left=W / 2 - y_b, right=W / 2 + y_b,
                   yaw_err=th_b, inliers=999, ok=True, front=box.depth - x_b)
