"""합성 엘베 스캔 생성기 — 테스트·dryrun·시뮬 공용.

box 프레임에서 로봇 pose(x_b, y_b, th_b)를 주면, 그 자리에서 라이다가 볼 벽/문을
레이캐스팅해 **body 프레임 [x,y] 점군**으로 반환한다(문 개구는 빈 구멍 = no return).

좌표 규약(§8.0):
  box: Xb 0..depth(뒷벽0/문 depth), Yb -w/2..+w/2(좌+/우-).
  body_vec = R(-th_b) · (hit_box - pose_xy)   → +x 전방, +y 좌.
"""
from __future__ import annotations

import math
import random

from .align_target import BoxSpec


def _ray_hit(px, py, dx, dy, box: BoxSpec):
    """(px,py)에서 (dx,dy) 방향 레이가 만나는 box 벽의 최근접 hit(box 좌표).

    문 개구(앞벽 Xb=depth, |Yb|<door_w/2)는 통과 → 해당 벽 hit 무시.
    반환: (hitx, hity) 또는 None(문 구멍으로 탈출).
    """
    H, W, dw = box.depth, box.width, box.door_w
    best = math.inf
    hit = None
    # 뒷벽 Xb=0
    if dx < 0:
        t = (0.0 - px) / dx
        y = py + t * dy
        if t > 1e-6 and -W / 2 <= y <= W / 2 and t < best:
            best, hit = t, (0.0, y)
    # 앞벽(문) Xb=H — 문 구멍이면 skip
    if dx > 0:
        t = (H - px) / dx
        y = py + t * dy
        if t > 1e-6 and -W / 2 <= y <= W / 2 and t < best and not (abs(y) < dw / 2):
            best, hit = t, (H, y)
    # 좌벽 Yb=+W/2
    if dy > 0:
        t = (W / 2 - py) / dy
        x = px + t * dx
        if t > 1e-6 and 0.0 <= x <= H and t < best:
            best, hit = t, (x, W / 2)
    # 우벽 Yb=-W/2
    if dy < 0:
        t = (-W / 2 - py) / dy
        x = px + t * dx
        if t > 1e-6 and 0.0 <= x <= H and t < best:
            best, hit = t, (x, -W / 2)
    return hit


def generate_scan(box: BoxSpec, pose, *, n_rays: int = 90, noise: float = 0.0,
                  rng: random.Random | None = None, occluders=None):
    """body 프레임 [x,y] 점군 생성.

    pose = (x_b, y_b, th_b) : box 프레임 로봇 위치·heading(문 정면=0).
    noise : 각 점에 더할 등방 가우시안 표준편차(m) — 라이다 노이즈 모사.
    occluders : [(cx,cy,r), ...] box 좌표 원형 장애물(사람 모사) — 레이를 가림.
    """
    x_b, y_b, th_b = pose
    r = rng or random.Random(0)
    c, s = math.cos(th_b), math.sin(th_b)
    pts: list[tuple[float, float]] = []
    for i in range(n_rays):
        a = (i / n_rays) * 2 * math.pi          # body 프레임 레이각
        # body 레이방향 → box 방향(로봇 heading 만큼 회전)
        dx = math.cos(a + th_b)
        dy = math.sin(a + th_b)
        hit = _ray_hit(x_b, y_b, dx, dy, box)
        if hit is None:
            continue
        hx, hy = hit
        # 장애물(사람) — 레이 경로에 원이 더 가까우면 거기서 막힘
        if occluders:
            hit_t = math.hypot(hx - x_b, hy - y_b)
            for (ocx, ocy, orr) in occluders:
                ot = _circle_hit(x_b, y_b, dx, dy, ocx, ocy, orr)
                if ot is not None and ot < hit_t:
                    hit_t = ot
                    hx, hy = x_b + dx * ot, y_b + dy * ot
        # box → body 프레임 (R(-th_b))
        ddx, ddy = hx - x_b, hy - y_b
        bx = ddx * c + ddy * s
        by = -ddx * s + ddy * c
        if noise:
            bx += r.gauss(0, noise)
            by += r.gauss(0, noise)
        pts.append((round(bx, 3), round(by, 3)))
    return pts


def _circle_hit(px, py, dx, dy, cx, cy, rr):
    """레이-원 최근접 교점 파라미터 t(>0) 또는 None."""
    fx, fy = px - cx, py - cy
    b = 2 * (fx * dx + fy * dy)
    cc = fx * fx + fy * fy - rr * rr
    disc = b * b - 4 * cc
    if disc < 0:
        return None
    sq = math.sqrt(disc)
    t1 = (-b - sq) / 2
    if t1 > 1e-6:
        return t1
    t2 = (-b + sq) / 2
    return t2 if t2 > 1e-6 else None
