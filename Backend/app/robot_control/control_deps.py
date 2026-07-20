"""조작 명령에 붙이는 제어권 검사 의존성.

프론트 비활성화는 UX 일 뿐 방어가 아니다 — 서버가 판정한다(IMP-SEC-03).

대상 로봇은 경로의 `{robot_id}` 로 정한다. 레거시 경로(`/robot/up` 등)에는 그 자리가
없으므로 캐시된 로봇으로 폴백한다 — 단일 로봇 시절 호출부가 깨지지 않게 한 것이고,
새 호출은 전부 robot_id 를 실은 경로를 쓴다.
"""
from __future__ import annotations

import logging

from fastapi import Depends, Header, HTTPException, Request

from app.auth.dependencies import require_permission
from app.database.models import UserInfo
from app.robot_control import control_lock as cl
from app.user_cache import get_robot_id

logger = logging.getLogger(__name__)


def resolve_target_robot_id(explicit: int | None = None) -> int | None:
    """조작 대상 로봇 결정. 명시값 우선, 없으면 단일 로봇 폴백."""
    if explicit is not None:
        return explicit
    rid = get_robot_id()
    if rid is None:
        logger.warning("조작 대상 로봇을 결정하지 못했습니다 (캐시 비어 있음)")
    return rid


def require_control(menu_key: str = "robot-list"):
    """권한 + 제어권을 함께 검사한다.

    토큰은 헤더 `X-Control-Token` 으로 받는다. 바디를 건드리지 않아 기존
    엔드포인트 시그니처를 그대로 둘 수 있다.
    """

    def _checker(
        request: Request,
        x_control_token: str | None = Header(default=None, alias="X-Control-Token"),
        current_user: UserInfo = Depends(require_permission(menu_key)),
    ) -> UserInfo:
        # 경로에 robot_id 가 있으면 그것이 대상이고, 없으면(레거시 경로) 캐시로 폴백한다.
        path_robot_id = request.path_params.get("robot_id")
        explicit = int(path_robot_id) if path_robot_id is not None else None
        robot_id = resolve_target_robot_id(explicit)
        if robot_id is None:
            raise HTTPException(status_code=409, detail={"message": "제어 대상 로봇이 없습니다"})

        try:
            cl.verify(robot_id, x_control_token)
        except cl.ControlLockConflict as e:
            owner = e.current
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        f"{owner.owner_label or owner.owner_id}님이 제어 중입니다"
                        if owner.owner_type == "user"
                        else "자율 작업이 제어 중입니다"
                    ),
                    "owner": owner.to_public(),
                },
            ) from e
        except cl.ControlLockDenied as e:
            raise HTTPException(
                status_code=409,
                detail={"message": "제어권이 없습니다. 제어를 먼저 시작하세요."},
            ) from e

        return current_user

    return _checker
