"""정렬 코어 오케스트레이션 — 한 사이클 step() + 오프라인 시뮬 simulate_run().

step():  스캔 → 벽피팅 → 제어명령.  ROS2 노드가 10Hz로 호출할 대상(Stage 3).
simulate_run():  로봇/ROS2 없이 폐루프 수렴을 검증 — 매 사이클 합성 스캔을 새로
  생성(=매번 벽 재측정)하고, 명령을 box 프레임으로 되돌려 적용(+slip)한다.
  명령의 body→box 역변환이 맞아야 수렴하므로, 이 시뮬이 §8.0 부호/변환을 통째로 검증한다.
"""
from __future__ import annotations

import math
import random

from .align_target import AlignConfig, wrap_angle
from .wall_fit import fit_walls
from .control_law import compute_cmd
from .sim_scan import generate_scan


def step(scan, cfg: AlignConfig | None = None):
    """한 제어 사이클: 스캔 → WallFit → (VelocityCmd, AlignStatus)."""
    c = cfg or AlignConfig()
    wf = fit_walls(scan, c.wall)
    cmd, status = compute_cmd(wf, c)
    return wf, cmd, status


def _apply(pose, cmd, dt, th_b, slip, rng):
    """body 속도명령을 box 프레임 변위로 적용(R(+th_b)) + slip 잡음.

    R(−th_b)로 만든 명령을 R(+th_b)로 되돌리므로 실제 box 변위 = v_box·dt.
    변환/부호가 틀리면 발산 → simulate_run 이 실패로 잡는다.
    """
    vx, vy, wz = cmd.vx, cmd.vy, cmd.wz
    c, s = math.cos(th_b), math.sin(th_b)
    box_dx = vx * c - vy * s      # R(+th_b)
    box_dy = vx * s + vy * c
    x, y, th = pose
    ns = slip
    x += box_dx * dt + (rng.gauss(0, ns) if ns else 0.0)
    y += box_dy * dt + (rng.gauss(0, ns) if ns else 0.0)
    th = wrap_angle(th + wz * dt + (rng.gauss(0, ns) * 0.5 if ns else 0.0))
    return (x, y, th)


def simulate_run(start_pose, cfg: AlignConfig | None = None, *,
                 max_cycles: int = 200, noise: float = 0.004, slip: float = 0.0,
                 n_rays: int = 90, seed: int = 0, open_loop: bool = False):
    """폐루프(또는 개루프) 정렬을 오프라인 시뮬. 결과 dict 반환.

    반환: {converged, cycles, final_pose, err_xy, err_yaw, history:[err_xy...]}
    open_loop=True: 시작 시점 명령을 한 번 계산해 무피드백 실행(대조군).
    """
    c = cfg or AlignConfig()
    rng = random.Random(seed)
    pose = tuple(start_pose)
    history = []
    open_cmd = None

    converged = False
    i = 0
    for i in range(1, max_cycles + 1):
        scan = generate_scan(c.box, pose, n_rays=n_rays, noise=noise, rng=rng)
        wf = fit_walls(scan, c.wall)
        if open_loop:
            if open_cmd is None:
                open_cmd, _ = compute_cmd(wf, c)
            cmd = open_cmd
            _, status = compute_cmd(wf, c)   # 상태 관찰용(적용엔 안 씀)
        else:
            cmd, status = compute_cmd(wf, c)
        history.append(status.err_xy)
        if status.converged and not open_loop:
            converged = True
            break
        pose = _apply(pose, cmd, c.dt, wf.yaw_err, slip, rng)

    # 최종 오차(참값 기준)
    from .control_law import pose_from_wallfit
    scan = generate_scan(c.box, pose, n_rays=n_rays, noise=noise, rng=rng)
    wf = fit_walls(scan, c.wall)
    _, status = compute_cmd(wf, c)
    return {
        "converged": converged or status.converged,
        "cycles": i,
        "final_pose": pose,
        "err_xy": status.err_xy,
        "err_yaw": status.err_yaw,
        "history": history,
    }
