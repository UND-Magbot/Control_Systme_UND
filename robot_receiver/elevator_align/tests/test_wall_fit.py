"""벽피팅 정확도 — 알려진 pose로 합성 스캔 생성 → fit_walls 가 복원하는지."""
import math
import random

from elevator_align.align_target import BoxSpec, WallParams
from elevator_align.wall_fit import fit_walls
from elevator_align.control_law import pose_from_wallfit
from elevator_align.sim_scan import generate_scan

BOX = BoxSpec(depth=2.2, width=2.2, door_w=0.72)

# (x_b, y_b, th_b) — box 프레임 참값
CASES = [
    (0.60, 0.00, 0.00),
    (0.34, -0.42, 0.00),     # 목표 자세 부근
    (1.20, 0.30, math.radians(12)),
    (0.80, -0.35, math.radians(-18)),
    (1.50, 0.10, math.radians(25)),
    (0.45, 0.50, math.radians(-8)),
]


def test_wall_fit_recovers_distances_low_noise():
    for (x_b, y_b, th_b) in CASES:
        scan = generate_scan(BOX, (x_b, y_b, th_b), n_rays=120,
                             noise=0.005, rng=random.Random(1))
        wf = fit_walls(scan, WallParams())
        assert wf.ok, f"pose={x_b,y_b,th_b} 벽 미확보"
        # 참값 벽거리
        exp_back = x_b
        exp_left = BOX.width / 2 - y_b
        exp_right = BOX.width / 2 + y_b
        assert abs(wf.back - exp_back) < 0.04, (wf.back, exp_back)
        assert abs(wf.left - exp_left) < 0.04, (wf.left, exp_left)
        assert abs(wf.right - exp_right) < 0.04, (wf.right, exp_right)
        assert abs(wf.yaw_err - th_b) < math.radians(2.0), (wf.yaw_err, th_b)


def test_pose_from_wallfit_roundtrip():
    for (x_b, y_b, th_b) in CASES:
        scan = generate_scan(BOX, (x_b, y_b, th_b), n_rays=120,
                             noise=0.004, rng=random.Random(2))
        wf = fit_walls(scan, WallParams())
        rx, ry, rth = pose_from_wallfit(wf, BOX)
        assert abs(rx - x_b) < 0.04
        assert abs(ry - y_b) < 0.04
        assert abs(rth - th_b) < math.radians(2.0)


def test_wall_fit_robust_to_person_occluder():
    # 사람(원형 장애물)이 있어도 back/left/right 견고해야 함
    pose = (0.9, 0.1, math.radians(6))
    scan = generate_scan(BOX, pose, n_rays=140, noise=0.006,
                         rng=random.Random(3), occluders=[(1.4, 0.5, 0.22)])
    wf = fit_walls(scan, WallParams())
    assert wf.ok
    assert abs(wf.back - 0.9) < 0.06
    assert abs(wf.yaw_err - math.radians(6)) < math.radians(3.0)


def test_wall_fit_insufficient_points():
    wf = fit_walls([(0.1, 0.2), (0.3, 0.4)], WallParams())
    assert not wf.ok
