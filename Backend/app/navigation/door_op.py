"""자동문 통과 런타임 상태 + 조작자 개입 API (E5 D3).

대시보드 오버레이(TransitionOverlay)가 `GET /door/op/state?robot_id=` 를 폴링해
통과 FSM 단계를 표시하고, 실패 시 권한별 개입 버튼이 여기의 POST 를 호출한다.

엘리베이터(navigation/elevator_op.py)와 같은 규약을 따른다 — **진행 중이 아니면
`active: false`** 를 돌려주고 프론트는 오버레이를 숨긴다. 따라서 개폐 드라이버(S4c)가
없어도 화면과 API 가 정상 동작한다.

권한 설계(PRD §E5-5): 관측·무해 재시도·중단은 넓게, 로봇을 움직이는 개입은 Manager 이상.
자동문은 NOS active 맵을 건드리지 않아 파괴적이지 않으므로 강제 층 지정 같은
사업장 스코프 이중 게이트는 두지 않는다(위험도에 비례한 방어).
"""
from __future__ import annotations

from threading import Lock
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.audit import write_audit, get_client_ip
from app.auth.dependencies import get_db, require_any_permission, require_manager
from app.database.models import UserInfo
from app.navigation.door_fsm import DoorFSM, Intent, Phase, DISPLAY_PHASES

router = APIRouter(prefix="/door", tags=["Door"])

# 로봇별 진행 중 통과 세션. 개폐 드라이버(S4c)가 start/tick/end 를 호출한다.
_sessions: dict[int, DoorFSM] = {}
_lock = Lock()

PHASE_SEQUENCE = [p.name for p in DISPLAY_PHASES]


def start_session(robot_id: int, fsm: DoorFSM) -> None:
    with _lock:
        _sessions[robot_id] = fsm


def end_session(robot_id: int) -> None:
    with _lock:
        _sessions.pop(robot_id, None)


def get_session(robot_id: int) -> Optional[DoorFSM]:
    with _lock:
        return _sessions.get(robot_id)


def tick_session(robot_id: int) -> Optional[Phase]:
    """드라이버 폴링 1주기. 종료 상태에 도달하면 세션을 정리한다."""
    fsm = get_session(robot_id)
    if fsm is None:
        return None
    phase = fsm.tick()
    if phase in (Phase.DONE, Phase.ABORTED):
        end_session(robot_id)
    return phase


def _empty_state(robot_id: int) -> dict:
    return {
        "robot_id": robot_id,
        "active": False,
        "phase": None,
        "phases": PHASE_SEQUENCE,
        "door_id": None,
        "door_name": None,
        "reverse": False,
        "assumed_open": False,
        "fallback": False,
        "elapsed_sec": 0,
        "message": None,
    }


def _state_of(robot_id: int, fsm: DoorFSM) -> dict:
    snap = fsm.snapshot()
    return {
        "robot_id": robot_id,
        "active": True,
        "phase": snap["phase"],
        "phases": PHASE_SEQUENCE,
        "door_id": snap["door_id"],
        "door_name": snap["door_name"],
        "reverse": snap["reverse"],
        "assumed_open": snap["assumed_open"],
        "fallback": snap["fallback"],
        "elapsed_sec": snap["elapsed_sec"],
        "message": snap["message"],
    }


@router.get("/op/state")
def get_op_state(
    robot_id: int,
    current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list")),
) -> dict:
    """선택 로봇의 자동문 통과 단계. 관측이라 권한만 본다(제어권 불필요, 전 레벨 공통)."""
    fsm = get_session(robot_id)
    return _state_of(robot_id, fsm) if fsm else _empty_state(robot_id)


class InterventionReq(BaseModel):
    robot_id: int
    reason: Optional[str] = None


def _require_session(robot_id: int) -> DoorFSM:
    fsm = get_session(robot_id)
    if fsm is None:
        raise HTTPException(status_code=409, detail="진행 중인 자동문 통과가 없습니다.")
    return fsm


def _apply(fsm: DoorFSM, intent: Intent, robot_id: int) -> dict:
    if not fsm.submit(intent):
        raise HTTPException(status_code=409, detail="지금은 처리할 수 없는 개입입니다.")
    # FALLBACK 은 정지 상태라 즉시 반영해도 안전하다(다음 폴링을 기다리지 않는다).
    fsm.tick()
    if fsm.phase in (Phase.DONE, Phase.ABORTED):
        state = _state_of(robot_id, fsm)
        end_session(robot_id)
        return state
    return _state_of(robot_id, fsm)


@router.post("/op/retry-open")
def retry_open(
    req: InterventionReq,
    current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list")),
) -> dict:
    """열림 재요청 — 로봇을 움직이지 않는 무해 재시도라 엘리베이터보다 넓게 연다."""
    fsm = _require_session(req.robot_id)
    return _apply(fsm, Intent.RETRY_OPEN, req.robot_id)


@router.post("/op/abort")
def abort(
    req: InterventionReq,
    current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list")),
) -> dict:
    """통과 중단(안전 정지 유지). 멈추는 동작이라 안전 예외로 전 레벨 허용."""
    fsm = _require_session(req.robot_id)
    return _apply(fsm, Intent.ABORT, req.robot_id)


@router.post("/op/confirm-passed")
def confirm_passed(
    req: InterventionReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_manager),
) -> dict:
    """수동 열림 확인 — 사람이 문을 잡고 "통과해도 됨"을 선언한다. 로봇이 움직이므로 Manager 이상."""
    fsm = _require_session(req.robot_id)
    state = _apply(fsm, Intent.CONFIRM_PASSED, req.robot_id)
    write_audit(db, current_user.id, "door_confirm_passed", "door", fsm.cfg.door_id,
                detail=f"수동 열림 확인: {fsm.cfg.door_name} (로봇 {req.robot_id})",
                ip_address=get_client_ip(request))
    return state


@router.post("/op/skip")
def skip(
    req: InterventionReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_manager),
) -> dict:
    """통과 스킵/강제 진행 — 닫힌 문으로 진입할 위험이 있어 사유 필수 + 전량 감사."""
    reason = (req.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="강제 진행 사유를 입력하세요.")
    fsm = _require_session(req.robot_id)
    door_id, door_name = fsm.cfg.door_id, fsm.cfg.door_name
    state = _apply(fsm, Intent.SKIP, req.robot_id)
    write_audit(db, current_user.id, "door_pass_skipped", "door", door_id,
                detail=f"통과 강제 진행: {door_name} (로봇 {req.robot_id}) — 사유: {reason}",
                ip_address=get_client_ip(request))
    return state
