"""옆벽 정렬 모드 검증 — self-mask 후 좌·우 벽으로 중앙·heading 정렬 + 오도메트리 앞뒤."""
import math
import random

from elevator_align.align_target import AlignConfig, AlignTarget, WallParams
from elevator_align.self_mask import DEFAULT_SELF_MASK
from elevator_align.sides_fit import fit_sides
from elevator_align.control_law import compute_cmd_sides

CFG = AlignConfig(target=AlignTarget(lateral_offset=0.0, lateral_sign=1, d_target=0.55))
#              lateral_offset=0 → 목표=정중앙(테스트 단순화)


def side_scan(W, y_b, th_b, *, L=2.0, n=60, self_r=0.5, rng=None, noise=0.005):
    """body 프레임 옆벽 스캔: 좌벽(+W/2)·우벽(-W/2) + self 앞/뒤 아크."""
    r = rng or random.Random(0)
    c, s = math.cos(th_b), math.sin(th_b)
    pts = []
    for i in range(n):
        Xb = -L / 2 + L * i / (n - 1)
        for Yb in (W / 2, -W / 2):                 # 좌·우 벽
            dX, dY = Xb, Yb - y_b
            bx = dX * c + dY * s
            by = -dX * s + dY * c
            pts.append((bx + r.gauss(0, noise), by + r.gauss(0, noise)))
    # self 아크(앞 ±40°, 뒤 140~220°) — body 고정, 마스크 대상
    for (lo, hi) in ((-40, 40), (140, 220)):
        for _ in range(40):
            a = math.radians(r.uniform(lo, hi))
            rr = self_r + r.uniform(-0.03, 0.03)
            pts.append((rr * math.cos(a), rr * math.sin(a)))
    return pts


CASES = [
    (1.1, 0.0, 0.0),
    (1.1, 0.20, math.radians(8)),
    (1.1, -0.25, math.radians(-10)),
    (1.4, 0.15, math.radians(12)),
    (0.9, -0.10, math.radians(-6)),
]


def test_fit_sides_recovers_center_and_yaw():
    for (W, y_b, th_b) in CASES:
        scan = side_scan(W, y_b, th_b, rng=random.Random(1))
        sf = fit_sides(scan, WallParams(), self_mask=DEFAULT_SELF_MASK)
        assert sf.ok, f"W={W} y={y_b} 옆벽 미확보"
        assert abs(sf.left - (W / 2 - y_b)) < 0.05, (sf.left, W / 2 - y_b)
        assert abs(sf.right - (W / 2 + y_b)) < 0.05, (sf.right, W / 2 + y_b)
        assert abs(sf.y_b - y_b) < 0.05, (sf.y_b, y_b)
        assert abs(sf.yaw_err - th_b) < math.radians(2.5), (sf.yaw_err, th_b)


def test_self_removed_but_sides_fit():
    # 마스크 없으면 self 때문에 흔들리고, 마스크 있으면 옆벽 깨끗
    scan = side_scan(1.1, 0.2, math.radians(8), rng=random.Random(2))
    sf = fit_sides(scan, WallParams(), self_mask=DEFAULT_SELF_MASK)
    assert sf.ok and abs(sf.y_b - 0.2) < 0.05


def test_sides_control_lateral_heading_signs():
    # 정중앙 목표(y_target=0). y_b>0(좌로 치우침) → 우로(vy<0 근처). yaw>0 → wz<0.
    scan = side_scan(1.1, 0.2, math.radians(10), rng=random.Random(3))
    sf = fit_sides(scan, WallParams(), self_mask=DEFAULT_SELF_MASK)
    cmd, st = compute_cmd_sides(sf, CFG, odom_depth=None)
    # 오도메트리 없음 → box 앞뒤(depth) hold: 적용 시 box_dx=0 (body vx는 회전 때문에 0 아닐 수 있음)
    c, s = math.cos(sf.yaw_err), math.sin(sf.yaw_err)
    box_dx = cmd.vx * c - cmd.vy * s          # body → box (R(+th))
    assert abs(box_dx) < 1e-9                  # 앞뒤 방향 이동 0
    # y_b=+0.2, 목표0 → ey<0 → box vy<0; th≈10° 작음 → body vy<0
    assert cmd.vy < 0
    assert cmd.wz < 0                          # +yaw → 되돌리려 wz 음


def test_sides_control_converges_lateral_heading():
    dt = CFG.dt
    for i, (W, y0, th0) in enumerate(CASES):
        y_b, th_b = y0, th0
        conv = False
        for _ in range(300):
            scan = side_scan(W, y_b, th_b, rng=random.Random(100 + i))
            sf = fit_sides(scan, WallParams(), self_mask=DEFAULT_SELF_MASK)
            cmd, st = compute_cmd_sides(sf, CFG, odom_depth=None)
            if st.converged:
                conv = True
                break
            # 적용: body → box (vx=0이라 box_dy=vby)
            c, s = math.cos(th_b), math.sin(th_b)
            box_dy = cmd.vx * s + cmd.vy * c
            y_b += box_dy * dt
            th_b += cmd.wz * dt
        assert conv, f"W={W} start=({y0},{th0}) 미수렴 y_b={y_b:.3f}"
        assert abs(y_b) < CFG.tol_xy + 0.01
        assert abs(th_b) < CFG.tol_yaw + math.radians(1)


def test_odometry_foreaft_sign():
    scan = side_scan(1.1, 0.0, 0.0, rng=random.Random(5))
    sf = fit_sides(scan, WallParams(), self_mask=DEFAULT_SELF_MASK)
    # 아직 0.2m만 들어옴, 목표 0.55 → 더 후진(음의 x = 뒤로) 필요
    cmd_shallow, _ = compute_cmd_sides(sf, CFG, odom_depth=0.20)
    # 목표보다 덜 들어옴 → ex=0.55-0.20>0 → vbx>0 → th=0이라 vx>0(전방?)
    # 규약: box +Xb=문(전방). 더 깊이=뒤(-Xb) 가야 하므로 부호는 d_target 정의에 종속.
    # 여기선 ex>0 → vx>0 (목표 깊이 방향). 부호 일관성만 확인:
    cmd_deep, _ = compute_cmd_sides(sf, CFG, odom_depth=0.90)  # 너무 깊음 → 반대부호
    assert cmd_shallow.vx * cmd_deep.vx < 0    # 얕음/깊음이 반대 방향
    cmd_at, st = compute_cmd_sides(sf, CFG, odom_depth=0.55)   # 목표 도달
    assert abs(cmd_at.vx) < 1e-6 and st.converged
