"""엘리베이터 자율 조작 상태 — 대시보드 오버레이용 조회 API (스텁).

대시보드 맵의 '엘리베이터 전환 상태 오버레이'(E1-3)가 이 엔드포인트를 폴링해
FSM 단계(호출→탑승→층선택→이동→하차→맵전환)를 표시한다.

⚠ 현재는 **스텁**이다. 자율 FSM(PRD-Multi-Floor-Auto-Map-Switching P3)이 로봇별로
   상태를 push 하기 전까지 `active: false`(오버레이 숨김)를 반환한다. 프론트는 이 응답이
   비어 있어도 정상 동작(오버레이 미표시)하도록 설계됐다 → FSM 없이 선행 착수 가능.

FSM 이 나중에 `set_op_state(robot_id, {...})` 로 상태를 넣으면 그대로 표시된다.
"""
from __future__ import annotations

from threading import Lock
from typing import Optional

from fastapi import APIRouter, Depends

from app.auth.dependencies import require_any_permission
from app.database.models import UserInfo

router = APIRouter(prefix="/elevator", tags=["Elevator"])

# 로봇별 조작 상태 in-memory 레지스트리. 미래 FSM 이 여기에 push 한다.
_op_states: dict[int, dict] = {}
_lock = Lock()


def set_op_state(robot_id: int, state: dict) -> None:
    """FSM → 오버레이. 진행 중 상태를 등록한다(스레드 안전)."""
    with _lock:
        _op_states[robot_id] = state


def clear_op_state(robot_id: int) -> None:
    """전환 종료 시 상태 제거(오버레이 숨김)."""
    with _lock:
        _op_states.pop(robot_id, None)


def _empty_state(robot_id: int) -> dict:
    """전환 중이 아닐 때의 기본 응답 — 오버레이는 active=false 로 숨긴다."""
    return {
        "robot_id": robot_id,
        "active": False,
        "phase": None,
        "target_floor_id": None,
        "target_floor_label": None,
        "started_at": None,
        "in_transit": False,
        "fallback": False,
        "message": None,
    }


@router.get("/op/state")
def get_op_state(
    robot_id: int,
    current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list")),
) -> dict:
    """선택 로봇의 엘리베이터 조작 FSM 단계. 관측이라 권한만(제어권 불필요).

    전환 중이 아니면 `active: false` → 프론트 오버레이 숨김.
    """
    with _lock:
        state = _op_states.get(robot_id)
    return state if state else _empty_state(robot_id)
