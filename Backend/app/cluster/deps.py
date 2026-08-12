"""소유권만 검사하는 의존성 — 세션 토큰을 요구하지 않는다.

`control_deps.require_control` 과 묻는 것이 다르다.
  require_control        : "이 **사람**이 제어권을 쥐었나"  → X-Control-Token 필요
  require_robot_available: "다른 **백엔드**가 로봇을 쓰나"   → 토큰 불필요

이동·매핑 API 는 지금 권한(누가)만 보고 소유권(지금 누가 쓰는지)을 안 본다.
거기에 require_control 을 붙이면 프론트가 토큰을 안 실어 보내 전부 깨진다.
반면 인스턴스 소유권은 서버가 혼자 판단할 수 있어 **프론트 변경이 필요 없다.**
설계: 06_Planning/IMPL-Robot-Ownership-Across-Instances.md §1.2
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from app.auth.dependencies import require_permission
from app.cluster import db_lock
from app.database.models import UserInfo
from app.robot_control import control_lock as cl
from app.user_cache import get_robot_id


def require_robot_available(menu_key: str = "robot-list"):
    """권한 검사 + "다른 인스턴스가 이 로봇을 쓰고 있지 않은가" 검사.

    같은 인스턴스가 이미 쓰고 있으면 통과시킨다 — 스케줄 주행 중에 운영자가 같은
    화면에서 정지·개입하는 기존 흐름을 막지 않기 위해서다(그 배타는 control_lock 소관).
    """

    def _checker(
        request: Request,
        current_user: UserInfo = Depends(require_permission(menu_key)),
    ) -> UserInfo:
        path_robot_id = request.path_params.get("robot_id")
        robot_id = int(path_robot_id) if path_robot_id is not None else get_robot_id()
        if robot_id is None:
            return current_user      # 대상 로봇을 못 정하면 기존 동작 그대로 통과

        if db_lock.holds(robot_id) or cl.get(robot_id) is not None:
            return current_user      # 이 인스턴스가 이미 쓰는 중

        h = db_lock.holder(robot_id)
        if h is None:
            return current_user      # 비어 있다 — 실제 획득은 작업 시작 지점이 한다

        # 여기서 잡지 않는다. 잡아 두면 요청이 실패했을 때 고아 락이 남는다.
        # 검사와 획득 사이의 창은 짧고, 그 사이 뺏겨도 결과는 지금(방어 없음)과 같다.
        host = h.get("host") or "다른 관제"
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"다른 관제({host})가 이 로봇을 사용 중입니다",
                "owner": {"remote": True, "host": host},
                "preemptible": False,
            },
        )

    return _checker
