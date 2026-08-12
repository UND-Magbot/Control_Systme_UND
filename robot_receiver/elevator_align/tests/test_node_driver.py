"""반응 노드 드라이버(Stage 3, ROS2 비의존부) 안전동작 검증 — 로봇 무동작.

stale→0, 예외/미측정→0, 저속 상한 클램프를 합성 스캔으로 확인.
"""
import math
import random

from elevator_align.align_target import BoxSpec, AlignConfig, AlignTarget
from elevator_align.node_driver import AlignDriver
from elevator_align.sim_scan import generate_scan

BOX = BoxSpec(depth=2.2, width=2.2, door_w=0.72)
# 3벽 기하 안전동작 테스트 → walls 모드 + self_mask 없음(합성 박스엔 self 없음)
CFG = AlignConfig(box=BOX, target=AlignTarget(d_back=0.34, lateral_offset=0.42, lateral_sign=-1),
                  mode="walls", self_mask=None)


def _scan(pose, seed=0):
    return generate_scan(BOX, pose, n_rays=120, noise=0.005, rng=random.Random(seed))


def test_fresh_scan_gives_valid_bounded_cmd():
    d = AlignDriver(CFG, max_vx=0.5, max_vy=0.5, max_wz=1.6, stale_timeout=0.5)
    d.update_scan(_scan((0.9, 0.2, math.radians(8))), now=100.0)
    r = d.compute(now=100.05)
    assert r.ok and r.wall_ok
    assert abs(r.cmd.vx) <= 0.5 and abs(r.cmd.vy) <= 0.5 and abs(r.cmd.wz) <= 1.6


def test_low_caps_are_enforced():
    # 큰 오차라 코어는 v_max(0.55)를 원하지만, 노드 상한 0.08 로 잘려야 함.
    d = AlignDriver(CFG, max_vx=0.08, max_vy=0.08, max_wz=0.3, stale_timeout=0.5)
    d.update_scan(_scan((1.7, 0.0, 0.0)), now=10.0)   # 목표(0.34)에서 크게 앞
    r = d.compute(now=10.02)
    assert r.ok
    assert abs(r.cmd.vx) <= 0.08 + 1e-9
    assert abs(r.cmd.vx) > 0.079        # 상한에 붙음(오차 큼)


def test_stale_scan_returns_zero():
    d = AlignDriver(CFG, stale_timeout=0.5)
    d.update_scan(_scan((0.9, 0.1, 0.0)), now=100.0)
    r = d.compute(now=100.8)            # 0.8s 경과 > 0.5
    assert not r.ok
    assert r.cmd.vx == 0.0 and r.cmd.vy == 0.0 and r.cmd.wz == 0.0
    assert "stale" in r.reason


def test_no_scan_returns_zero():
    d = AlignDriver(CFG)
    r = d.compute(now=0.0)
    assert not r.ok and r.cmd.vx == 0.0 and r.cmd.vy == 0.0 and r.cmd.wz == 0.0


def test_degenerate_points_return_zero():
    d = AlignDriver(CFG, stale_timeout=10.0)
    d.update_scan([(0.0, 0.0)] * 5, now=1.0)   # 벽 미확보
    r = d.compute(now=1.01)
    assert not r.ok
    assert r.cmd.vx == 0.0 and r.cmd.wz == 0.0


def test_converged_pose_small_cmd():
    d = AlignDriver(CFG, max_vx=0.5, max_vy=0.5, max_wz=1.6)
    d.update_scan(_scan((0.34, -0.42, 0.0)), now=5.0)   # 목표 자세
    r = d.compute(now=5.02)
    assert r.ok
    assert abs(r.cmd.vx) < 0.05 and abs(r.cmd.vy) < 0.05 and abs(r.cmd.wz) < 0.1


# ── 옆벽(sides) 모드 드라이버 (이 로봇 기본) ──
from elevator_align.self_mask import DEFAULT_SELF_MASK


def _side_scan(W=1.1, y_b=0.0, th_b=0.0, rng=None):
    """좌·우 벽 + self 앞/뒤 아크 (body 프레임)."""
    r = rng or random.Random(0)
    c, s = math.cos(th_b), math.sin(th_b)
    pts = []
    for i in range(60):
        Xb = -1.0 + 2.0 * i / 59
        for Yb in (W/2, -W/2):
            dX, dY = Xb, Yb - y_b
            pts.append((dX*c + dY*s + r.gauss(0, 0.005), -dX*s + dY*c + r.gauss(0, 0.005)))
    for lo, hi in ((-40, 40), (140, 220)):     # self
        for _ in range(40):
            a = math.radians(r.uniform(lo, hi)); rr = 0.5 + r.uniform(-0.03, 0.03)
            pts.append((rr*math.cos(a), rr*math.sin(a)))
    return pts


SIDES_CFG = AlignConfig(mode="sides", self_mask=DEFAULT_SELF_MASK,
                        target=AlignTarget(lateral_offset=0.0, lateral_sign=1))


def test_sides_mode_driver_valid_bounded():
    d = AlignDriver(SIDES_CFG, max_vx=0.5, max_vy=0.5, max_wz=1.6)
    d.update_scan(_side_scan(1.1, 0.2, math.radians(8), rng=random.Random(1)), now=10.0)
    r = d.compute(now=10.02)
    assert r.ok and r.wall_ok
    assert r.y_b is not None and abs(r.y_b - 0.2) < 0.06     # 옆벽 정보 채워짐
    assert abs(r.cmd.vy) <= 0.5 and abs(r.cmd.wz) <= 1.6


def test_sides_mode_caps_enforced():
    d = AlignDriver(SIDES_CFG, max_vy=0.08, max_wz=0.3)
    d.update_scan(_side_scan(1.1, 0.4, math.radians(20), rng=random.Random(2)), now=1.0)
    r = d.compute(now=1.02)
    assert r.ok and abs(r.cmd.vy) <= 0.08 + 1e-9 and abs(r.cmd.wz) <= 0.3 + 1e-9


def test_sides_mode_stale_zero():
    d = AlignDriver(SIDES_CFG, stale_timeout=0.5)
    d.update_scan(_side_scan(rng=random.Random(3)), now=100.0)
    r = d.compute(now=100.9)
    assert not r.ok and r.cmd.vx == 0.0 and r.cmd.vy == 0.0 and r.cmd.wz == 0.0


def test_sides_mode_odom_feeds_foreaft():
    d = AlignDriver(SIDES_CFG, max_vx=0.5, max_vy=0.5, max_wz=1.6)
    d.update_scan(_side_scan(1.1, 0.0, 0.0, rng=random.Random(4)), now=5.0)
    d.update_odom(0.20)                          # 얕게 들어옴 → 앞뒤 명령 생김
    r = d.compute(now=5.02)
    assert r.ok and abs(r.cmd.vx) > 1e-3         # 오도메트리로 앞뒤 vx 발생
