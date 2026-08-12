"""폐루프 시뮬 — 어디서 시작해도 수렴, slip에도 수렴, 개루프는 드리프트 잔존.

이 시뮬은 매 사이클 스캔을 새로 생성(=벽 재측정)하고 body→box 역변환으로 적용하므로,
§8.0 좌표/부호/변환이 통째로 맞아야 통과한다. = Stage 1 수렴 게이트(§10).
"""
import math
import random

from elevator_align.align_target import BoxSpec, AlignConfig, AlignTarget
from elevator_align.align_core import simulate_run

BOX = BoxSpec(depth=2.2, width=2.2, door_w=0.72)
CFG = AlignConfig(box=BOX, target=AlignTarget(d_back=0.34, lateral_offset=0.42, lateral_sign=-1))


def _random_starts(n, seed=7):
    r = random.Random(seed)
    out = []
    for _ in range(n):
        out.append((r.uniform(0.35, BOX.depth - 0.5),
                    r.uniform(-BOX.width / 2 + 0.4, BOX.width / 2 - 0.4),
                    r.uniform(-math.radians(30), math.radians(30))))
    return out


def test_closed_loop_converges_from_many_starts():
    for i, pose in enumerate(_random_starts(8)):
        res = simulate_run(pose, CFG, max_cycles=250, noise=0.004, slip=0.0, seed=100 + i)
        assert res["converged"], f"start={pose} 미수렴 err={res['err_xy']:.3f}"
        assert res["err_xy"] < CFG.tol_xy + 0.01
        assert res["err_yaw"] < CFG.tol_yaw + math.radians(1)


def test_closed_loop_rejects_slip():
    # 미끄러짐이 있어도 폐루프는 결국 목표 근처로 수렴(허용 band 완화)
    ok = 0
    trials = 6
    for i, pose in enumerate(_random_starts(trials, seed=21)):
        res = simulate_run(pose, CFG, max_cycles=400, noise=0.006, slip=0.012, seed=200 + i)
        if res["err_xy"] < 0.10 and res["err_yaw"] < math.radians(6):
            ok += 1
    assert ok >= trials - 1, f"slip 하 수렴 {ok}/{trials}"


def test_error_decreases_monotonic_trend():
    res = simulate_run((1.6, 0.5, math.radians(-20)), CFG, max_cycles=250,
                       noise=0.003, slip=0.0, seed=5)
    h = res["history"]
    assert len(h) > 5
    # 초반 평균 오차 > 후반 평균 오차 (수렴 추세)
    early = sum(h[:3]) / 3
    late = sum(h[-3:]) / 3
    assert late < early * 0.5, (early, late)


def test_open_loop_drifts_under_slip():
    # 개루프(무피드백)는 slip 만큼 목표를 못 맞춰야 함(대조군)
    res = simulate_run((1.5, 0.4, math.radians(15)), CFG, max_cycles=60,
                       noise=0.004, slip=0.02, seed=9, open_loop=True)
    assert not res["converged"]
    assert res["err_xy"] > CFG.tol_xy
