"""제어권 API — 획득 / 유지 / 반환 / 조회 / 강제회수.

화면 문구는 국문, 개념 용어(control lock)는 코드에서만 쓴다.
(ARCH-Remote-Control-and-Device-Console §0.1)
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth.audit import get_client_ip, write_audit
from app.auth.dependencies import get_current_user, require_admin, require_permission
from app.database.database import get_db
from app.database.models import UserInfo
from app.robot_control import control_lock as cl

router = APIRouter(prefix="/robot")


def _owner_id_of(user: UserInfo) -> str:
    return user.LoginId or f"user:{user.id}"


def _owner_label_of(user: UserInfo) -> str:
    return user.UserName or _owner_id_of(user)


def _conflict(cur: cl.ControlLock, preemptible: bool = False) -> HTTPException:
    """409 변환. preemptible 이면 프론트가 '개입하시겠습니까?' 를 띄우고
    force=true 로 재요청한다(사람은 자율을 선점할 수 있다)."""
    if cur.owner_type == "user":
        message = f"{cur.owner_label or cur.owner_id}님이 제어 중입니다"
    elif cur.meta.get("remote"):
        message = f"{cur.owner_label or '다른 관제'}가 이 로봇을 사용 중입니다"
    elif preemptible:
        message = f"{cur.owner_label or cur.owner_id} 작업이 진행 중입니다. 개입하시겠습니까?"
    else:
        message = "자율 작업이 제어 중입니다"
    return HTTPException(
        status_code=409,
        detail={
            "message": message,
            "owner": cur.to_public(),
            "preemptible": preemptible,
        },
    )


@router.get("/{robot_id}/control")
def get_control_state(
    robot_id: int,
    current_user: UserInfo = Depends(get_current_user),
):
    """제어 상태 조회. 관찰만 하는 세션이 화면을 그리기 위해 쓴다."""
    cur = cl.get(robot_id)
    if cur is None:
        return {"controlled": False, "mine": False, "owner": None}
    mine = cur.owner_type == "user" and cur.owner_id == _owner_id_of(current_user)
    return {"controlled": True, "mine": mine, "owner": cur.to_public()}


@router.post("/{robot_id}/control/acquire")
def acquire_control(
    robot_id: int,
    request: Request,
    force: bool = False,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    """제어 시작. 이미 다른 세션이 쥐고 있으면 409.

    force=true 는 **자율 작업을 선점**할 때만 쓴다(사람 → 자율). 사람이 쥔 것은
    force 로도 못 뺏는다 — 그건 관리자 강제 회수(force-release)의 몫이다.
    """
    try:
        lock = cl.acquire(
            robot_id,
            "user",
            _owner_id_of(current_user),
            owner_label=_owner_label_of(current_user),
            force=force,
        )
    except cl.ControlLockConflict as e:
        raise _conflict(e.current, e.preemptible) from e

    write_audit(
        db,
        user_id=current_user.id,
        action="robot_control_acquired",
        target_type="robot",
        target_id=robot_id,
        detail=json.dumps({"owner": lock.owner_id}, ensure_ascii=False),
        ip_address=get_client_ip(request),
    )
    return {
        "token": lock.token,
        "heartbeatSec": cl.HEARTBEAT_SEC,
        "ttlSec": cl.TTL_SEC,
        "owner": lock.to_public(),
    }


@router.post("/{robot_id}/control/heartbeat")
def heartbeat_control(
    robot_id: int,
    payload: dict,
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    """제어권 유지. 끊기면 TTL 경과 후 자동 해제된다."""
    try:
        lock = cl.heartbeat(robot_id, payload.get("token"))
    except cl.ControlLockDenied as e:
        raise HTTPException(status_code=409, detail={"message": "제어권이 해제되었습니다"}) from e
    return {"ok": True, "expiresIn": round(lock.expires_in, 1)}


@router.post("/{robot_id}/control/release")
def release_control(
    robot_id: int,
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    """제어 종료. 팔이 뻗어 있으면 해제 훅이 수납을 시도한다."""
    try:
        released = cl.release(robot_id, payload.get("token"))
    except cl.ControlLockDenied:
        released = False

    if released:
        write_audit(
            db,
            user_id=current_user.id,
            action="robot_control_released",
            target_type="robot",
            target_id=robot_id,
            ip_address=get_client_ip(request),
        )
    return {"ok": True, "released": released}


@router.post("/{robot_id}/control/force-release")
def force_release_control(
    robot_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_admin),
):
    """관리자 강제 회수. 기존 제어자에게는 다음 heartbeat 에서 409로 전달된다."""
    prev = cl.force_release(robot_id, reason="admin_forced")
    write_audit(
        db,
        user_id=current_user.id,
        action="robot_control_force_released",
        target_type="robot",
        target_id=robot_id,
        detail=json.dumps(
            {"previousOwner": prev.owner_id if prev else None}, ensure_ascii=False
        ),
        ip_address=get_client_ip(request),
    )
    return {"ok": True, "previousOwner": prev.to_public() if prev else None}
