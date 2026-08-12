"""제어 법칙 — WallFit(현재 자세) → 속도명령 (P 폐루프, §8.0-C6/C7/C8).

흐름:
  1) WallFit → box 프레임 로봇 pose (x_b, y_b, th_b)   [pose_from_wallfit]
  2) 오차 e = target − pose  (box 프레임)
  3) box 속도 v_box = (Kp·ex, Kp·ey), wz = Kpw·eθ  → clamp
  4) 로봇은 body 속도를 받으므로 v_body = R(−th_b)·v_box  (§8.0-C7)

부호는 '음의 피드백'으로 고정: Δ>0 이면 그 방향으로 + 속도 → |오차| 감소.
tests/test_control_law.py 의 부호 회귀(§8.0-C10)가 이를 강제한다.
"""
from __future__ import annotations

import math

from .align_target import AlignConfig, VelocityCmd, AlignStatus, wrap_angle


def pose_from_wallfit(wf, box):
    """WallFit → (x_b, y_b, th_b). §8.0-C5 역산."""
    x_b = wf.back
    # left = W/2 - y_b, right = W/2 + y_b  → y_b = (right - left)/2
    y_b = (wf.right - wf.left) / 2.0
    th_b = wf.yaw_err
    return x_b, y_b, th_b


def _clamp(v, lim):
    return max(-lim, min(lim, v))


def compute_cmd(wf, cfg: AlignConfig | None = None):
    """WallFit → (VelocityCmd, AlignStatus)."""
    c = cfg or AlignConfig()
    x_b, y_b, th_b = pose_from_wallfit(wf, c.box)
    t = c.target
    g = c.gains

    # ② 오차 (box 프레임)
    ex = t.d_back - x_b
    ey = t.y_target - y_b
    eth = wrap_angle(t.heading - th_b)

    # ③ box 속도 (P)
    vbx = _clamp(g.kp * ex, g.v_max)
    vby = _clamp(g.kp * ey, g.v_max)
    wz = _clamp(g.kpw * eth, g.w_max)

    # ④ box → body : v_body = R(−th_b)·v_box
    cth, sth = math.cos(th_b), math.sin(th_b)
    vx = vbx * cth + vby * sth
    vy = -vbx * sth + vby * cth

    err_xy = math.hypot(ex, ey)
    err_yaw = abs(eth)
    converged = err_xy < c.tol_xy and err_yaw < c.tol_yaw
    if not wf.ok:
        reason = "wall_fit 미확보(측정 불충분)"
    elif converged:
        reason = "수렴"
    else:
        reason = "정렬 중"
    return (VelocityCmd(vx=vx, vy=vy, wz=wz),
            AlignStatus(err_xy=err_xy, err_yaw=err_yaw, converged=converged, reason=reason))


def compute_cmd_sides(sides, cfg: AlignConfig | None = None, odom_depth: float | None = None):
    """옆벽 모드 제어 — 좌우 중앙·heading은 옆벽으로, 앞뒤는 오도메트리(§ 옆벽 모드).

    sides: SidesFit(fit_sides 결과). odom_depth: 문에서 후진한 현재 깊이(m). None이면 앞뒤 hold(vx=0).
    좌표/부호 규약은 §8.0 동일(v_body = Rot(−yaw)·v_box).
    """
    c = cfg or AlignConfig()
    t = c.target
    g = c.gains
    th_b = sides.yaw_err

    # ② 오차 (box 프레임)
    ey = t.y_target - sides.y_b                 # 좌우: 목표 오프셋 − 현재 중앙오차
    eth = wrap_angle(t.heading - th_b)          # heading
    if odom_depth is None:
        ex = 0.0                                # 앞뒤 hold (오도메트리 없음)
    else:
        ex = t.d_target - odom_depth            # 앞뒤: 목표 깊이 − 현재 깊이

    # ③ box 속도 (P)
    vbx = _clamp(g.kp * ex, g.v_max)
    vby = _clamp(g.kp * ey, g.v_max)
    wz = _clamp(g.kpw * eth, g.w_max)

    # ④ box → body : v_body = R(−th_b)·v_box
    cth, sth = math.cos(th_b), math.sin(th_b)
    vx = vbx * cth + vby * sth
    vy = -vbx * sth + vby * cth

    # 수렴: 좌우+heading 필수, 앞뒤는 오도메트리 있을 때만 포함
    lat_ok = abs(ey) < c.tol_xy and abs(eth) < c.tol_yaw
    depth_ok = (odom_depth is None) or (abs(ex) < c.tol_xy)
    converged = bool(sides.ok and lat_ok and depth_ok)
    err_xy = math.hypot(ex, ey)
    if not sides.ok:
        reason = "옆벽 미확보"
    elif converged:
        reason = "수렴(옆벽)"
    else:
        reason = "정렬 중(옆벽)"
    return (VelocityCmd(vx=vx, vy=vy, wz=wz),
            AlignStatus(err_xy=err_xy, err_yaw=abs(eth), converged=converged, reason=reason))
