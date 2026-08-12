"""부호 회귀(§8.0-C10) — 발산 배선(양의 피드백)을 막는 핵심 테스트.

임의 오차 pose를 넣으면 명령은 반드시 오차를 줄이는 부호여야 하고,
1스텝 적용 후 |오차|가 단조 감소해야 한다. 부호가 뒤집히면 증가 → 실패.
"""
import math

from elevator_align.align_target import BoxSpec, AlignConfig, AlignTarget
from elevator_align.wall_fit import wallfit_from_pose
from elevator_align.control_law import compute_cmd

BOX = BoxSpec(depth=2.2, width=2.2, door_w=0.72)
CFG = AlignConfig(box=BOX, target=AlignTarget(d_back=0.34, lateral_offset=0.42, lateral_sign=-1))


def _err_of(pose):
    wf = wallfit_from_pose(pose, BOX)
    _, st = compute_cmd(wf, CFG)
    return st.err_xy, st.err_yaw


def _apply_body_cmd(pose, cmd, dt):
    # body 명령 → box 변위 R(+th_b) (align_core._apply 와 동일, slip=0)
    x, y, th = pose
    c, s = math.cos(th), math.sin(th)
    x += (cmd.vx * c - cmd.vy * s) * dt
    y += (cmd.vx * s + cmd.vy * c) * dt
    th = th + cmd.wz * dt
    return (x, y, th)


# 목표: x=0.34, y=-0.42, th=0
OFFSETS = [
    (0.64, -0.42, 0.0),                  # +x_b 오차(너무 앞) → vx 음이어야
    (0.34, -0.12, 0.0),                  # +y_b 오차(좌로 치우침) → 우로
    (0.34, -0.72, 0.0),                  # -y_b 오차
    (0.34, -0.42, math.radians(15)),     # +yaw 오차 → wz 음
    (0.34, -0.42, math.radians(-15)),    # -yaw 오차 → wz 양
    (0.9, -0.1, math.radians(10)),       # 복합
]


def test_command_reduces_error_one_step():
    dt = CFG.dt
    for pose in OFFSETS:
        wf = wallfit_from_pose(pose, BOX)
        cmd, _ = compute_cmd(wf, CFG)
        e0 = _err_of(pose)
        p1 = _apply_body_cmd(pose, cmd, dt)
        e1 = _err_of(p1)
        # 위치·각 오차 합이 줄어야 한다(단조 감소)
        assert (e1[0] + e1[1]) < (e0[0] + e0[1]) - 1e-9, f"pose={pose} e0={e0} e1={e1}"


def test_explicit_sign_directions():
    # +x_b 오차(목표보다 앞) → box vx 음 → th=0 이므로 body vx 음
    wf = wallfit_from_pose((0.64, -0.42, 0.0), BOX)
    cmd, _ = compute_cmd(wf, CFG)
    assert cmd.vx < 0, cmd
    # +yaw 오차 → 목표(0)로 되돌리려면 wz 음
    wf2 = wallfit_from_pose((0.34, -0.42, math.radians(15)), BOX)
    cmd2, _ = compute_cmd(wf2, CFG)
    assert cmd2.wz < 0, cmd2
    # -yaw → wz 양
    wf3 = wallfit_from_pose((0.34, -0.42, math.radians(-15)), BOX)
    cmd3, _ = compute_cmd(wf3, CFG)
    assert cmd3.wz > 0, cmd3


def test_at_target_converged():
    wf = wallfit_from_pose((0.34, -0.42, 0.0), BOX)
    _, st = compute_cmd(wf, CFG)
    assert st.converged
