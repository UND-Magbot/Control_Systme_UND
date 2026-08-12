"""RM 6축 로봇팔 제어 모듈.

睿尔曼 RM_API를 감싼 안전 가드 포함 고수준 제어기.
"""

from .config import RM65, ECO63, ECO65, RMArmConfig, JointLimits, WorkspaceBounds
from .controller import (
    ArmState,
    RMArmController,
    RMArmError,
    RMArmNotConnected,
)

__all__ = [
    "RMArmConfig",
    "JointLimits",
    "WorkspaceBounds",
    "RM65",
    "ECO63",
    "ECO65",
    "RMArmController",
    "RMArmError",
    "RMArmNotConnected",
    "ArmState",
]
