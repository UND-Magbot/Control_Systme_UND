"""라이다 스캔 입력 — relay_map.py 가 내보내는 포맷과 동일 (§8.0-C1).

relay_map on_* → JSON: {"type": str, "count": int, "points": [[x,y], ...]}
points 는 body 프레임 2D(로봇 원점, +x 전방·+y 좌), ~10Hz, 소수 3자리.

실로봇 축 규약(§12-A/D)이 REP-103과 다르면 여기(입력 어댑터)에서만 흡수하고
코어(wall_fit/control_law)는 불변으로 둔다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass(frozen=True)
class ScanFrame:
    """body 프레임 2D 점군."""
    points: list[tuple[float, float]]

    @property
    def count(self) -> int:
        return len(self.points)


def parse_scan(raw, *, axis: str = "rep103") -> ScanFrame:
    """relay_map JSON(str/dict) 또는 [[x,y],...] 를 ScanFrame 으로.

    axis: 실로봇 축 규약 어댑터 훅.
      "rep103" (기본) = +x 전방·+y 좌 그대로.
      "x_fwd_y_right"  = +y 우 → 좌(+y)로 부호 반전(코어 규약 정합).
    """
    if isinstance(raw, str):
        raw = json.loads(raw)
    if isinstance(raw, dict):
        pts = raw.get("points", [])
    else:
        pts = raw
    out: list[tuple[float, float]] = []
    flip_y = 1.0 if axis == "rep103" else -1.0
    for p in pts:
        if p is None or len(p) < 2:
            continue
        out.append((float(p[0]), flip_y * float(p[1])))
    return ScanFrame(points=out)
