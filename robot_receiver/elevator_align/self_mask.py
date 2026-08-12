"""self-return 마스크 — 로봇 자기 몸(다리/몸체)이 LiDAR에 잡힌 근접 점 제거.

원리(§12-F, DESIGN §12.2):
  - 로봇 몸은 body 프레임에서 **고정 위치** → 환경과 무관, 1회 캘리브로 전 공간 재사용.
  - 각도 빈(bin)별로 '몸 외곽 반경(mask_r)'을 저장 → 그 반경보다 가까운 점 = self → 제거.
  - **타이트**: 반경을 몸 외곽에 딱 붙게(+작은 마진). 진짜 벽은 몸보다 가까울 수 없으므로
    (몸이 벽 속에 박힐 순 없음) 몸 외곽까지 마스크해도 벽 손실 0.
  - 양옆(트인 섹터)은 mask_r=0 → 마스크 안 함(엘베 좌·우 벽을 여기서 봄).

주의: 이 마스크는 **자세(STAND)·하드웨어 고정** 전제. 자세/장착 바뀌면 재캘리브(calibrate).
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class SelfMask:
    """각도 빈별 self 외곽 반경(m). radii[i]=0 이면 그 방향은 마스크 없음(트임)."""
    bin_deg: float
    radii: tuple[float, ...]

    def mask_r_at(self, x: float, y: float) -> float:
        ang = math.degrees(math.atan2(y, x)) % 360.0
        b = int(ang // self.bin_deg) % len(self.radii)
        return self.radii[b]

    def is_self(self, x: float, y: float) -> bool:
        mr = self.mask_r_at(x, y)
        if mr <= 0.0:
            return False
        r = math.hypot(x, y)
        return 1e-6 < r < mr

    def apply(self, points):
        """self 점 제거한 새 점군 반환."""
        return [(x, y) for (x, y) in points if not self.is_self(x, y)]


def calibrate(points, *, bin_deg: float = 15.0, near: float = 0.9,
              margin: float = 0.05, cap: float = 0.85, min_pts: int = 2) -> SelfMask:
    """빈 공간(STAND) 캡처 → self 마스크 산출.

    각 빈: near 이내 점들의 **외곽(최대)** + margin (cap 상한). min_pts 미만이면 0(트임).
    빈 공간이라 near 이내 점 = 순수 self 이므로 그 외곽이 몸 경계.
    """
    n = int(round(360.0 / bin_deg))
    buckets = [[] for _ in range(n)]
    for x, y in points:
        r = math.hypot(x, y)
        if r < near:
            b = int((math.degrees(math.atan2(y, x)) % 360.0) // bin_deg)
            buckets[b % n].append(r)
    radii = []
    for rs in buckets:
        if len(rs) >= min_pts:
            radii.append(round(min(max(rs) + margin, cap), 3))
        else:
            radii.append(0.0)
    return SelfMask(bin_deg=bin_deg, radii=tuple(radii))


# ── 캘리브된 기본 마스크 (이 로봇, STAND 자세) ──
# 2026-07-09 빈공간 STAND 캡처(corner.json)에서 calibrate() 로 구움. 재캘리브 시 교체.
# 앞 ±45°·뒤 180°±52° 는 몸이 ~0.85m 가림, 양옆(≈60~120°, 240~300°)은 트임(0).
DEFAULT_SELF_MASK = SelfMask(
    bin_deg=15.0,
    radii=(
        0.85, 0.85, 0.84, 0.0, 0.0, 0.0, 0.0, 0.0,       #   0~120°
        0.81, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85,  # 120~240°
        0.0, 0.0, 0.0, 0.0, 0.0, 0.85, 0.85, 0.85,       # 240~360°
    ),
)
