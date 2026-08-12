#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""FastAPI 통합용 RM 팔 서비스 계층.

기존 백엔드([[Backend-Overview]])의 service/Depends 패턴에 맞춘 싱글톤 래퍼와
APIRouter 예시를 제공한다. 라우터는 FastAPI가 설치된 환경에서만 import 되며,
없으면 컨트롤러/서비스만 사용 가능하다.
"""

from __future__ import annotations

import threading

from .config import RMArmConfig
from .controller import ArmState, RMArmController, RMArmError


class RMArmService:
    """프로세스 단위 단일 인스턴스로 RM 팔을 관리하는 서비스.

    FastAPI startup에서 ``connect()``, shutdown에서 ``disconnect()``를 호출한다.
    """

    _instance: RMArmService | None = None
    _instance_lock = threading.Lock()

    def __init__(self, config: RMArmConfig | None = None) -> None:
        self._controller = RMArmController(config)

    @classmethod
    def instance(cls, config: RMArmConfig | None = None) -> RMArmService:
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls(config)
            return cls._instance

    @property
    def controller(self) -> RMArmController:
        return self._controller

    def connect(self) -> None:
        self._controller.connect()

    def disconnect(self) -> None:
        self._controller.disconnect()

    def status(self) -> dict:
        """연결 상태 + 현재 상태 요약(미연결/에러도 표준 형태로)."""
        if not self._controller.is_connected:
            return {"connected": False}
        try:
            st: ArmState = self._controller.get_state()
            temps = self._controller.get_joint_temperatures()
        except RMArmError as exc:
            return {"connected": True, "error": str(exc)}
        return {
            "connected": True,
            "joints_deg": st.joints_deg,
            "pose": st.pose,
            "arm_err": st.arm_err,
            "sys_err": st.sys_err,
            "joint_temperatures": temps,
        }


# --------------------------------------------------------------------------- #
# (선택) FastAPI 라우터 — fastapi 가 있을 때만 정의
# --------------------------------------------------------------------------- #
try:
    from fastapi import APIRouter, HTTPException
    from pydantic import BaseModel, Field
except ImportError:  # pragma: no cover - FastAPI 미설치 환경
    APIRouter = None  # type: ignore[assignment]
else:

    class JointMove(BaseModel):
        joints: list[float] = Field(..., description="관절각 배열(도)")
        speed: int | None = Field(None, ge=1, le=100)
        block: bool = True

    class PoseMove(BaseModel):
        pose: list[float] = Field(..., min_length=6, max_length=6,
                                  description="[x,y,z,rx,ry,rz] (m, rad)")
        speed: int | None = Field(None, ge=1, le=100)
        block: bool = True

    class GripperCmd(BaseModel):
        position: int = Field(..., ge=1, le=1000)
        block: bool = True

    def build_router(service: RMArmService) -> "APIRouter":
        """RM 팔 제어 라우터를 생성한다. ``app.include_router(build_router(svc))``."""
        router = APIRouter(prefix="/robot/arm", tags=["RM Arm"])

        def _guard(call):
            try:
                return call()
            except RMArmError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc

        @router.get("/status")
        def get_status() -> dict:
            return service.status()

        @router.post("/move/joint")
        def move_joint(cmd: JointMove) -> dict:
            _guard(lambda: service.controller.move_joint(
                cmd.joints, speed=cmd.speed, block=cmd.block))
            return {"ok": True}

        @router.post("/move/linear")
        def move_linear(cmd: PoseMove) -> dict:
            _guard(lambda: service.controller.move_linear(
                cmd.pose, speed=cmd.speed, block=cmd.block))
            return {"ok": True}

        @router.post("/move/pose")
        def move_pose(cmd: PoseMove) -> dict:
            _guard(lambda: service.controller.move_pose(
                cmd.pose, speed=cmd.speed, block=cmd.block))
            return {"ok": True}

        @router.post("/gripper")
        def gripper(cmd: GripperCmd) -> dict:
            _guard(lambda: service.controller.gripper_set_position(
                cmd.position, block=cmd.block))
            return {"ok": True}

        @router.post("/stop")
        def stop() -> dict:
            _guard(lambda: service.controller.stop())
            return {"ok": True}

        @router.post("/estop")
        def estop() -> dict:
            service.controller.emergency_stop()
            return {"ok": True}

        @router.post("/clear-errors")
        def clear_errors() -> dict:
            _guard(lambda: service.controller.clear_errors())
            return {"ok": True}

        return router
