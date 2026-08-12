"""self-mask 검증 — self 제거 + 진짜 벽 보존(과잉마스킹 방지).

핵심 안전성: '몸 외곽까지만' 마스크하면 진짜 벽(몸보다 멀리)은 절대 안 지운다.
"""
import math
import random

from elevator_align.self_mask import SelfMask, calibrate, DEFAULT_SELF_MASK


def _arc_points(a_lo, a_hi, r, n, rng, jitter=0.02):
    """각도 [a_lo,a_hi]° 에 반경 r 근처 점 n개 (self 몸 외곽 모사)."""
    out = []
    for _ in range(n):
        a = math.radians(rng.uniform(a_lo, a_hi))
        rr = r + rng.uniform(-jitter, jitter)
        out.append((rr * math.cos(a), rr * math.sin(a)))
    return out


def test_default_mask_shape():
    m = DEFAULT_SELF_MASK
    assert len(m.radii) == 24 and m.bin_deg == 15.0
    # 앞(0°)·뒤(180°)는 마스크, 옆(90°/270°)은 트임
    assert m.mask_r_at(0.5, 0.0) > 0            # 전방
    assert m.mask_r_at(-0.5, 0.0) > 0           # 후방
    assert m.mask_r_at(0.0, 0.5) == 0.0         # 좌(+y) 트임
    assert m.mask_r_at(0.0, -0.5) == 0.0        # 우(-y) 트임


def test_removes_self_keeps_side_wall():
    rng = random.Random(1)
    m = DEFAULT_SELF_MASK
    # self: 앞 아크 0.5m + 뒤 아크 0.5m
    self_pts = _arc_points(-40, 40, 0.5, 60, rng) + _arc_points(140, 220, 0.5, 60, rng)
    # 진짜 옆벽: 좌(+y) 0.8m 직선 (마스크 없는 섹터)
    side_wall = [(x, 0.8) for x in [i*0.05 for i in range(-8, 9)]]
    pts = self_pts + side_wall
    out = m.apply(pts)
    # self 는 대부분 제거
    assert len(out) < len(self_pts) * 0.15
    # 옆벽은 전부 보존
    kept_wall = [p for p in out if abs(p[1]-0.8) < 1e-6]
    assert len(kept_wall) == len(side_wall)


def test_keeps_wall_beyond_body_in_masked_arc():
    """마스크 섹터(앞)라도 몸 외곽 '너머'의 벽은 보존해야 한다(타이트)."""
    m = DEFAULT_SELF_MASK
    front_r = m.mask_r_at(1.0, 0.0)          # 전방 마스크 반경(~0.85)
    beyond = [(front_r + 0.10, 0.0), (front_r + 0.30, 0.0)]  # 몸 너머 벽
    within = [(front_r - 0.20, 0.0)]         # 몸 안(self)
    out = m.apply(beyond + within)
    assert all(p in out for p in beyond)     # 너머 벽 보존
    assert within[0] not in out              # self 제거


def test_calibrate_roundtrip():
    rng = random.Random(2)
    # 빈공간 모사: 앞/뒤 아크에 self 0.45m, 옆은 비움
    pts = _arc_points(-40, 40, 0.45, 40, rng) + _arc_points(140, 220, 0.45, 40, rng)
    m = calibrate(pts, bin_deg=15.0)
    assert m.mask_r_at(0.4, 0.0) > 0.4        # 전방 마스크 생성됨
    assert m.mask_r_at(-0.4, 0.05) > 0.4      # 후방
    assert m.mask_r_at(0.0, 0.5) == 0.0       # 옆(점 없음) → 트임
    # 마스크가 self 외곽(0.45)+마진 근방
    assert 0.45 <= m.mask_r_at(0.4, 0.0) <= 0.55


def test_apply_is_idempotent():
    m = DEFAULT_SELF_MASK
    pts = [(0.5, 0.0), (-0.5, 0.1), (0.0, 0.8), (2.0, 0.0)]
    once = m.apply(pts)
    twice = m.apply(once)
    assert once == twice
