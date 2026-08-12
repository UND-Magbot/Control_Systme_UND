"""RM 6축 팔 제어 라우터 (Phase 1 · additive).

관측 + 안전정지 + 검증된 프리셋만 제공한다. 관절 jog/MoveL/그리퍼는
현장 캘리브(관절한계·작업영역 실측) 이후에 별도 Increment 로 연다.

설계 근거: 06_Planning/PRD-RM-Arm-Control-Console.md (C1 감시 / C2 안전·모드중재 / C3 프리셋).

기존 코드 무수정 원칙:
  - 권한/제어권은 기존 ``control_deps.require_control`` / ``auth.require_permission`` 재사용.
  - ``robot_control/__init__.py`` 에 include 1줄만 추가한다(로직 무변경).

안전 정지 위계(PRD C2):
  - 일시정지(pause)  = ``Move_Pause_Cmd``. 궤적 정지 · **재개 가능**.
  - 긴급정지(estop) = ``Move_Stop`` + 전원 차단. 자세 유지 미보장(처짐). 복구 절차 필요.
  - E-STOP/STOP 은 안전 예외라 lock 없이 권한만으로 허용(눈앞 위험을 본 조작자가 세울 수 있어야).

⚠ 통신두절 dead-man watchdog(IMP-SAF-01)·하드웨어 비상정지는 별도. 이 소프트웨어 정지는
   관제↔팔 통신이 살아 있어야 동작한다.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import require_permission
from app.database.models import UserInfo
from app.robot_control.control_deps import require_control

from .presets import PRESETS, get_preset
from .rm_arm.config import RMArmConfig
from .rm_arm.controller import RMArmError
from .rm_arm.service import RMArmService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/robot/arm", tags=["RM Arm"])

# 하드웨어 미확정 단계: simulation=True(안전, 팔 컨트롤러 dry-run 모드).
#
# ⚠ 이 SDK 의 `simulation` 은 "무하드웨어 목업"이 아니라 **팔의 내부 dry-run 모드**다.
#   `connect()` 는 여전히 `config.ip:8080` 로 실제 TCP 연결을 시도한다(도달 불가 시 행/실패).
#   그래서 여기서는 **자동 연결하지 않는다** — 하드웨어가 없으면 `status()` 가
#   `{"connected": false}` 를 즉시 반환하는 게 올바른 동작이다.
#   실제 연결은 장치등록(RobotModule arm 상세)에서 주소를 주입하며 여는 별도 Increment 소관.
_CONFIG = RMArmConfig(simulation=True)

# ─────────────────────────────────────────────────────────────────────────────
# 임시 검증 목(mock) — RM 하드웨어 미연결 상태에서 팔 탭 UI를 확인하기 위한 것.
# 환경변수 ARM_MOCK=1 일 때만 켜지고, 기본(0)은 실제 동작 그대로다.
# ⚠ 실장비를 연결하면 반드시 ARM_MOCK 을 지우거나 0 으로 되돌린다(가짜 상태가 나가지 않게).
# 목이 흉내내는 범위 = 실제 구현된 것(관측·안전정지·프리셋)뿐. jog/MoveL/그리퍼·자율/수동
# 모드는 코드에 없으므로 목에도 없다(팔 탭엔 그대로 안 나온다).
# ─────────────────────────────────────────────────────────────────────────────
_ARM_MOCK = os.getenv("ARM_MOCK", "0").strip().lower() in ("1", "true", "yes", "on")

_MOCK_STATUS = {
    "connected": True,
    "joints_deg": [12.4, -3.1, -88.0, 0.0, -90.2, 0.0],
    "pose": [0.312, 0.008, 0.441, 0.0, -1.57, 0.0],
    "arm_err": 0,
    "sys_err": 0,
    "joint_temperatures": [38.0, 39.5, 41.0, 37.2, 40.1, 36.8],
}

if _ARM_MOCK:
    logger.warning("[ARM_MOCK] 팔 목 상태 활성 — 검증 전용. 실장비 연결 전 반드시 끌 것.")


def _service() -> RMArmService:
    """RM 팔 서비스 싱글톤. **연결은 하지 않는다**(미연결이면 status 가 connected:false)."""
    return RMArmService.instance(_CONFIG)


def _guard(call):
    """RMArmError → 409(도메인 오류)로 변환."""
    try:
        return call()
    except RMArmError as exc:
        raise HTTPException(status_code=409, detail={"message": str(exc)}) from exc


# ── C1 감시 ────────────────────────────────────────────────────────────────
@router.get("/status")
def get_status(
    current_user: UserInfo = Depends(require_permission("robot-list")),
) -> dict:
    """연결·6관절각·자세·에러·관절온도. 관측이라 권한만(제어권 불필요)."""
    if _ARM_MOCK:
        return dict(_MOCK_STATUS)
    return _service().status()


@router.get("/presets")
def list_presets(
    current_user: UserInfo = Depends(require_permission("robot-list")),
) -> dict:
    """프리셋 목록 + 검증 여부(미검증은 경로/자율이 선택 불가하도록 verified 노출)."""
    return {
        "presets": [
            {"key": p.key, "label": p.label, "verified": p.verified, "note": p.note}
            for p in PRESETS.values()
        ]
    }


# ── C2 안전 정지 (안전 예외: 권한만, lock 불필요) ────────────────────────────
@router.post("/pause")
def pause(
    current_user: UserInfo = Depends(require_permission("robot-list")),
) -> dict:
    """일시정지 — 궤적 정지, **재개 가능**(``Move_Pause_Cmd``)."""
    if _ARM_MOCK:
        return {"ok": True, "state": "paused", "resumable": True, "mock": True}
    _guard(lambda: _service().controller.pause())
    return {"ok": True, "state": "paused", "resumable": True}


@router.post("/resume")
def resume(
    current_user: UserInfo = Depends(require_control("robot-list")),
) -> dict:
    """일시정지 재개. 재구동이라 제어권 필요."""
    if _ARM_MOCK:
        return {"ok": True, "state": "moving", "mock": True}
    _guard(lambda: _service().controller.resume())
    return {"ok": True, "state": "moving"}


@router.post("/stop")
def stop(
    current_user: UserInfo = Depends(require_permission("robot-list")),
) -> dict:
    """궤적 정지(``Move_Stop``). 진행 궤적 폐기(재개 아님)."""
    if _ARM_MOCK:
        return {"ok": True, "state": "stopped", "mock": True}
    _guard(lambda: _service().controller.stop())
    return {"ok": True, "state": "stopped"}


@router.post("/estop")
def estop(
    current_user: UserInfo = Depends(require_permission("robot-list")),
) -> dict:
    """긴급정지 — 전원 차단(``Set_Arm_Power(0)``). 자세 유지 미보장(처짐).

    복구 절차 필요: 전원 ON → 관절 사용 → 에러 클리어 → **자세 확인 후** 수납.
    """
    if _ARM_MOCK:
        return {"ok": True, "state": "estop", "posture_hold": False, "mock": True}
    svc = _service()
    if not svc.controller.is_connected:
        # 미연결이면 정지할 팔이 없다 = 이미 안전. 조작자에게 실패로 보이지 않게 ok 반환.
        return {"ok": True, "state": "estop", "connected": False, "note": "미연결 — 정지할 팔 없음"}
    svc.controller.emergency_stop()
    return {"ok": True, "state": "estop", "posture_hold": False}


@router.post("/clear-errors")
def clear_errors(
    current_user: UserInfo = Depends(require_control("robot-list")),
) -> dict:
    """팔 에러 초기화(``Set_Joint_Err_Clear``). 긴급정지 복구 절차의 한 단계."""
    if _ARM_MOCK:
        return {"ok": True, "mock": True}
    _guard(lambda: _service().controller.clear_errors())
    return {"ok": True}


# ── C3 프리셋 이동 (검증된 목표각만, 제어권 필요) ────────────────────────────
@router.post("/preset/{key}")
def move_preset(
    key: str,
    current_user: UserInfo = Depends(require_control("robot-list")),
) -> dict:
    """검증된 프리셋 자세로 이동. 미검증(추정치) 프리셋은 거부(409).

    검증된 목표각만 담으므로 jog/MoveL 과 달리 **캘리브 게이트와 무관하게 사용 가능**.
    """
    preset = get_preset(key)
    if preset is None:
        raise HTTPException(status_code=404, detail={"message": f"알 수 없는 프리셋: {key}"})
    if not preset.verified:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"'{preset.label}' 프리셋은 현장 실측 전 추정치입니다(미검증). 실측 후 사용하세요.",
                "verified": False,
            },
        )
    if _ARM_MOCK:
        return {"ok": True, "preset": preset.key, "joints_deg": list(preset.joints_deg), "mock": True}
    _guard(
        lambda: _service().controller.move_joint(
            list(preset.joints_deg), speed=_CONFIG.max_speed
        )
    )
    return {"ok": True, "preset": preset.key, "joints_deg": list(preset.joints_deg)}
