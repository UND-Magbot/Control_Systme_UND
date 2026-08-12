"""RM 6축 팔 프리셋 자세 정의 (Phase 1 · additive).

프리셋 = 미리 검증된 고정 관절각으로의 원클릭 이동 목표.
관절 jog/MoveL 이 현장 캘리브(관절한계·작업영역 실측) 전까지 잠기는 것과 달리,
**프리셋은 검증된 목표각만** 담으므로 캘리브 전에도 사용할 수 있는 가장 안전한 수동 조작이다.

⚠ `stow`/`observe` 의 각도는 **현장 실측 전 추정치**다(`verified=False`).
   미검증 프리셋으로의 이동은 라우터에서 거부하거나 경고 후에만 허용한다.
   실측 후 각도를 채우고 `verified=True` 로 바꾼다.

각도 단위: 도(degree), 순서 J1..J6.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ArmPreset:
    key: str
    label: str
    joints_deg: tuple[float, float, float, float, float, float]
    verified: bool
    note: str = ""


# home: SDK/README 기준 홈 자세. 검증됨.
HOME = ArmPreset(
    key="home",
    label="홈",
    joints_deg=(0.0, 0.0, -90.0, 0.0, -90.0, 0.0),
    verified=True,
    note="SDK 기준 홈 자세",
)

# stow: 주행 안전(팔 수납). 몸통 안으로 접어 M20 보행 중 간섭을 없애는 자세.
# ⚠ 각도는 추정치 — 실장비에서 실측 후 확정 필요.
STOW = ArmPreset(
    key="stow",
    label="수납(주행 안전)",
    joints_deg=(0.0, 0.0, -150.0, 0.0, -30.0, 0.0),
    verified=False,
    note="주행 중 팔 수납 자세 — 현장 실측 전 추정치",
)

# observe: 패널 정위치(엘리베이터 버튼을 RealSense 시야에 두는 관측 자세).
# ⚠ 각도는 추정치 — hand-eye 캘리브/실측 후 확정 필요.
OBSERVE = ArmPreset(
    key="observe",
    label="관측(패널 정위치)",
    joints_deg=(0.0, -30.0, -90.0, 0.0, -60.0, 0.0),
    verified=False,
    note="엘리베이터 패널 관측 자세 — 캘리브 전 추정치",
)


PRESETS: dict[str, ArmPreset] = {p.key: p for p in (HOME, STOW, OBSERVE)}


def get_preset(key: str) -> ArmPreset | None:
    return PRESETS.get(key)
