#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""RM 6축 로봇팔 제어 설정.

기종/네트워크/안전 한계를 한곳에서 관리한다. 운영 환경별로
환경변수 또는 별도 설정 로더로 주입하는 것을 전제로 한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# 睿尔曼 모델 매크로 (robotic_arm.RM65 등과 동일 값)
RM65 = 65
RML63_II = 632
ECO65 = 651
ECO62 = 62
ECO63 = 634

# 모델값 -> 자유도(DOF). SDK는 10 미만이 될 때까지 정수 나눗셈으로 DOF를 구한다.
def model_to_dof(model: int) -> int:
    """모델 매크로에서 자유도를 추론한다 (RM65 -> 6, ECO63 -> 6)."""
    code = model
    while code >= 10:
        code //= 10
    return code


@dataclass(frozen=True)
class JointLimits:
    """관절별 소프트 한계(도). 기본값은 RM65 일반 가동범위의 보수적 추정치이며,
    실배포 전 ``Auto_Set_Joint_Limit`` / 제조사 사양으로 반드시 보정한다."""

    min_deg: tuple[float, ...] = (-178.0, -130.0, -135.0, -178.0, -128.0, -360.0)
    max_deg: tuple[float, ...] = (178.0, 130.0, 135.0, 178.0, 128.0, 360.0)


@dataclass(frozen=True)
class WorkspaceBounds:
    """직교공간 작업영역 한계(미터). Movel/Movej_P 목표 위치 사전검증용.
    값 ``None``이면 해당 축은 검사하지 않는다 (전자울타리로 별도 제한 권장)."""

    x: tuple[float, float] | None = (-0.9, 0.9)
    y: tuple[float, float] | None = (-0.9, 0.9)
    z: tuple[float, float] | None = (-0.3, 1.2)


@dataclass
class RMArmConfig:
    """RM 팔 제어 설정."""

    ip: str = "192.168.1.18"          # SDK 기본 IP (현장값으로 교체)
    model: int = RM65                 # 6축 = RM65 계열
    simulation: bool = True           # 기본 시뮬레이션(안전). 실물은 False로 명시.

    # 안전 한계
    max_speed: int = 30               # 속도 백분율 상한(1~100). 명령 v는 이 값으로 클램프.
    default_blend: int = 0            # 교융 반경 기본(0~100)
    joint_limits: JointLimits = field(default_factory=JointLimits)
    workspace: WorkspaceBounds = field(default_factory=WorkspaceBounds)

    # 그리퍼
    gripper_default_speed: int = 50   # 1~100
    gripper_default_force: int = 50   # 1~100
    gripper_timeout: int = 10         # 초

    @property
    def dof(self) -> int:
        return model_to_dof(self.model)
