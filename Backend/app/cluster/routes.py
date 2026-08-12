"""인스턴스·소유권 조회 API.

지금은 관제가 두 대에서 돌아도 화면에 아무 표시가 없어 뭐가 잘못됐는지 알 방법이 없다.
"이 화면은 개발 인스턴스 / 현재 로봇 사용 중: 192.168.0.21" 을 띄우기 위한 최소 API.
"""
from __future__ import annotations

from fastapi import Depends

from app.auth.dependencies import get_current_user
from app.cluster import db_lock, instance
from app.database.models import UserInfo
from app.database.routes import database
from app.robot_control import control_lock as cl
from app.user_cache import get_robot_id


@database.get("/cluster/instance")
def cluster_instance(current_user: UserInfo = Depends(get_current_user)):
    """이 백엔드가 개발인지 운영인지. 화면 배지용."""
    info = instance.info()
    return {**info, "lockState": db_lock.state()}


@database.get("/cluster/robot-owner")
def robot_owner(
    robot_id: int | None = None,
    current_user: UserInfo = Depends(get_current_user),
):
    """이 로봇을 지금 누가 쓰고 있나.

    다른 인스턴스가 쓰고 있으면 IP 만 알 수 있다(그쪽 내부 소유자는 조회 불가).
    """
    rid = robot_id if robot_id is not None else get_robot_id()
    if rid is None:
        return {"held": False}

    local = cl.get(rid)
    if local is not None:
        return {
            "held": True,
            "isSelf": True,
            "holderHost": instance.info()["host"],
            "localOwner": local.to_public(),
        }

    h = db_lock.holder(rid)
    if h is None:
        return {"held": False}
    return {"held": True, "isSelf": bool(h.get("isSelf")), "holderHost": h.get("host")}
