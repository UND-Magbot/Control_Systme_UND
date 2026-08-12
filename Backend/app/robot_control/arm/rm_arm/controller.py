#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""RM 6축 로봇팔 고수준 제어기.

睿尔曼 RM_API(`robotic_arm_package`)를 감싸 다음을 제공한다.
- 연결 수명주기(컨텍스트 매니저 포함)
- 운동 명령(관절/직선/자세/원호) + 입력 안전 검증
- 그리퍼 제어
- 상태 조회(관절각/위치자세/온도/전류)
- 전원/에러/시뮬레이션 모드, 비상 정지

설계 원칙: **safety-critical**. 모든 운동 전 범위·속도를 검증/클램프하고,
SDK 에러코드를 ``RMArmError``로 변환해 호출부가 무시할 수 없게 한다.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

try:
    # (1) 이 모듈에 함께 벤더링된 SDK 우선 사용
    from .robotic_arm_package.robotic_arm import Arm
except ImportError:
    # (2) 벤더링 패키지가 없으면, 56 등 환경에 이미 설치/배치된
    #     robotic_arm_package(RM_Base.so 포함)를 sys.path에서 사용
    from robotic_arm_package.robotic_arm import Arm

from .config import RMArmConfig

logger = logging.getLogger(__name__)


class RMArmError(RuntimeError):
    """SDK가 0이 아닌 결과(에러코드/메시지)를 반환했을 때 발생."""

    def __init__(self, op: str, result: object) -> None:
        self.op = op
        self.result = result
        super().__init__(f"{op} 실패: {result}")


class RMArmNotConnected(RMArmError):
    def __init__(self, op: str) -> None:
        super().__init__(op, "로봇팔이 연결되지 않음")


@dataclass
class ArmState:
    """현재 팔 상태 스냅샷."""

    joints_deg: list[float]
    pose: list[float]          # [x, y, z, rx, ry, rz] (m, rad)
    arm_err: int
    sys_err: int


class RMArmController:
    """RM 6축 로봇팔 제어기.

    Example:
        >>> from rm_arm.config import RMArmConfig
        >>> with RMArmController(RMArmConfig(simulation=True)) as arm:
        ...     arm.move_joint([0, 0, -90, 0, -90, 0], speed=20)
        ...     state = arm.get_state()
    """

    def __init__(self, config: RMArmConfig | None = None) -> None:
        self.config = config or RMArmConfig()
        self._arm: Arm | None = None
        self._lock = threading.RLock()  # SDK 호출 직렬화(스레드 안전)

    # ------------------------------------------------------------------ #
    # 연결 수명주기
    # ------------------------------------------------------------------ #
    def connect(self) -> None:
        """API 초기화 + TCP(8080) 연결. 시뮬레이션 모드/전원/에러클리어까지 수행."""
        with self._lock:
            if self._arm is not None:
                logger.info("이미 연결됨")
                return

            arm = Arm(self.config.model, self.config.ip)
            if arm.Arm_Socket_State() != 0:
                # 소켓 자원 정리 후 실패 보고
                try:
                    arm.Arm_Socket_Close()
                    arm.RM_API_UnInit()
                except Exception:  # noqa: BLE001  - 정리 best-effort
                    pass
                raise RMArmError("connect", f"{self.config.ip}:8080 연결 실패")

            self._arm = arm
            logger.info("RM 팔 연결 성공: %s (DOF=%d)", self.config.ip, self.config.dof)

            # 안전 초기화: 모드 -> 전원 -> 에러 클리어
            self.set_simulation(self.config.simulation)
            self.power_on()
            self.clear_errors()

    def disconnect(self) -> None:
        """소켓 종료 + API 자원 해제."""
        with self._lock:
            if self._arm is None:
                return
            try:
                self._arm.Arm_Socket_Close()
                self._arm.RM_API_UnInit()
            finally:
                self._arm = None
                logger.info("RM 팔 연결 해제")

    @property
    def is_connected(self) -> bool:
        return self._arm is not None and self._arm.Arm_Socket_State() == 0

    def __enter__(self) -> RMArmController:
        self.connect()
        return self

    def __exit__(self, *exc) -> None:
        self.disconnect()

    # ------------------------------------------------------------------ #
    # 내부 헬퍼
    # ------------------------------------------------------------------ #
    def _require(self, op: str) -> Arm:
        if self._arm is None:
            raise RMArmNotConnected(op)
        return self._arm

    @staticmethod
    def _check(op: str, result: object) -> None:
        # check_error는 성공 시 0(int), 실패 시 에러메시지 문자열을 반환한다.
        if result != 0:
            raise RMArmError(op, result)

    def _read_retry(self, op: str, call, attempts: int = 3, delay: float = 0.1) -> tuple:
        """상태 조회 SDK 호출을 재시도 포함으로 실행한다.

        ``CONTROLLER_DATA_LOSE_ERR``(코드 9)는 명령 직후/일시적 패킷 손실로 자주
        발생하므로, 그 오류에 한해 ``attempts``회까지 ``delay``초 간격으로 재시도한다.
        다른 오류는 즉시 ``RMArmError``로 올린다. ``call``은 ``(err, ...)`` 튜플을
        반환하는 무인자 콜러블(SDK 상태 조회)이어야 한다.
        """
        last: object = None
        for _ in range(max(1, attempts)):
            with self._lock:
                result = call()
            err = result[0]
            if err == 0:
                return result
            last = err
            if "CONTROLLER_DATA_LOSE" not in str(err):
                break  # 일시적 손실이 아닌 오류는 즉시 보고
            time.sleep(delay)
        self._check(op, last)

    def _clamp_speed(self, speed: int | None) -> int:
        v = self.config.max_speed if speed is None else int(speed)
        v = max(1, min(v, self.config.max_speed))
        return v

    def _validate_joints(self, joints) -> list[float]:
        dof = self.config.dof
        if len(joints) != dof:
            raise RMArmError("move_joint", f"관절 수 불일치: {len(joints)} != DOF {dof}")
        lim = self.config.joint_limits
        for i, ang in enumerate(joints):
            lo, hi = lim.min_deg[i], lim.max_deg[i]
            if not (lo <= ang <= hi):
                raise RMArmError(
                    "move_joint", f"관절{i + 1} 한계 위반: {ang}° ∉ [{lo}, {hi}]"
                )
        return [float(a) for a in joints]

    def _validate_pose(self, pose) -> list[float]:
        if len(pose) != 6:
            raise RMArmError("move", f"pose는 [x,y,z,rx,ry,rz] 6요소 필요 (got {len(pose)})")
        ws = self.config.workspace
        x, y, z = pose[0], pose[1], pose[2]
        for axis, val, bound in (("x", x, ws.x), ("y", y, ws.y), ("z", z, ws.z)):
            if bound is not None and not (bound[0] <= val <= bound[1]):
                raise RMArmError(
                    "move", f"작업영역 위반: {axis}={val}m ∉ {bound}"
                )
        return [float(p) for p in pose]

    # ------------------------------------------------------------------ #
    # 전원 / 모드 / 에러
    # ------------------------------------------------------------------ #
    def set_simulation(self, simulation: bool) -> None:
        """0=시뮬레이션, 1=실제."""
        arm = self._require("set_simulation")
        with self._lock:
            self._check("Set_Arm_Run_Mode", arm.Set_Arm_Run_Mode(0 if simulation else 1))
        logger.info("운행 모드: %s", "시뮬레이션" if simulation else "실제")

    def power_on(self) -> None:
        arm = self._require("power_on")
        with self._lock:
            self._check("Set_Arm_Power", arm.Set_Arm_Power(1))

    def power_off(self) -> None:
        arm = self._require("power_off")
        with self._lock:
            self._check("Set_Arm_Power", arm.Set_Arm_Power(0))

    def clear_errors(self) -> None:
        arm = self._require("clear_errors")
        with self._lock:
            self._check("Clear_System_Err", arm.Clear_System_Err())

    # ------------------------------------------------------------------ #
    # 운동 명령
    # ------------------------------------------------------------------ #
    def move_joint(
        self, joints, speed: int | None = None, blend: int | None = None,
        block: bool = True,
    ) -> None:
        """관절공간 PTP 이동. joints: 관절각 배열(도)."""
        arm = self._require("move_joint")
        j = self._validate_joints(joints)
        v = self._clamp_speed(speed)
        r = self.config.default_blend if blend is None else int(blend)
        with self._lock:
            self._check("Movej_Cmd", arm.Movej_Cmd(j, v, r, 0, block))

    def move_linear(
        self, pose, speed: int | None = None, blend: int | None = None,
        block: bool = True,
    ) -> None:
        """직교공간 직선 이동. pose: [x,y,z,rx,ry,rz] (m, rad)."""
        arm = self._require("move_linear")
        p = self._validate_pose(pose)
        v = self._clamp_speed(speed)
        r = self.config.default_blend if blend is None else int(blend)
        with self._lock:
            self._check("Movel_Cmd", arm.Movel_Cmd(p, v, r, 0, block))

    def move_pose(
        self, pose, speed: int | None = None, blend: int | None = None,
        block: bool = True,
    ) -> None:
        """목표 자세로 관절계획 이동(Movej_P). pose는 현재 공구↔작업 좌표계 기준."""
        arm = self._require("move_pose")
        p = self._validate_pose(pose)
        v = self._clamp_speed(speed)
        r = self.config.default_blend if blend is None else int(blend)
        with self._lock:
            self._check("Movej_P_Cmd", arm.Movej_P_Cmd(p, v, r, 0, block))

    def move_arc(
        self, pose_via, pose_to, speed: int | None = None, blend: int | None = None,
        loop: int = 0, block: bool = True,
    ) -> None:
        """직교공간 원호 이동(경유점 + 종점)."""
        arm = self._require("move_arc")
        via = self._validate_pose(pose_via)
        to = self._validate_pose(pose_to)
        v = self._clamp_speed(speed)
        r = self.config.default_blend if blend is None else int(blend)
        with self._lock:
            self._check("Movec_Cmd", arm.Movec_Cmd(via, to, v, r, loop, 0, block))

    # 궤적 제어
    def stop(self) -> None:
        """현재 궤적 즉시 정지."""
        arm = self._require("stop")
        with self._lock:
            self._check("Move_Stop_Cmd", arm.Move_Stop_Cmd(True))

    def pause(self) -> None:
        arm = self._require("pause")
        with self._lock:
            self._check("Move_Pause_Cmd", arm.Move_Pause_Cmd(True))

    def resume(self) -> None:
        arm = self._require("resume")
        with self._lock:
            self._check("Move_Continue_Cmd", arm.Move_Continue_Cmd(True))

    def emergency_stop(self) -> None:
        """비상 정지: 궤적 정지 -> 전원 차단. 정리 best-effort."""
        logger.warning("비상 정지 실행")
        if self._arm is None:
            return
        with self._lock:
            try:
                self._arm.Move_Stop_Cmd(True)
            except Exception:  # noqa: BLE001
                logger.exception("Move_Stop_Cmd 실패")
            try:
                self._arm.Set_Arm_Power(0)
            except Exception:  # noqa: BLE001
                logger.exception("Set_Arm_Power(0) 실패")

    # ------------------------------------------------------------------ #
    # 그리퍼
    # ------------------------------------------------------------------ #
    def gripper_set_position(self, position: int, block: bool = True) -> None:
        """개구도 1~1000."""
        arm = self._require("gripper_set_position")
        position = max(1, min(int(position), 1000))
        with self._lock:
            self._check(
                "Set_Gripper_Position",
                arm.Set_Gripper_Position(position, block, self.config.gripper_timeout),
            )

    def gripper_pick(
        self, speed: int | None = None, force: int | None = None, block: bool = True,
    ) -> None:
        arm = self._require("gripper_pick")
        s = speed or self.config.gripper_default_speed
        f = force or self.config.gripper_default_force
        with self._lock:
            self._check(
                "Set_Gripper_Pick_On",
                arm.Set_Gripper_Pick_On(s, f, block, self.config.gripper_timeout),
            )

    def gripper_release(self, speed: int | None = None, block: bool = True) -> None:
        arm = self._require("gripper_release")
        s = speed or self.config.gripper_default_speed
        with self._lock:
            self._check(
                "Set_Gripper_Release",
                arm.Set_Gripper_Release(s, block, self.config.gripper_timeout),
            )

    # ------------------------------------------------------------------ #
    # 상태 조회
    # ------------------------------------------------------------------ #
    def get_state(self, retry: int = 3) -> ArmState:
        arm = self._require("get_state")
        _, joints, pose, arm_err, sys_err = self._read_retry(
            "Get_Current_Arm_State", lambda: arm.Get_Current_Arm_State(retry=retry)
        )
        return ArmState(
            joints_deg=list(joints), pose=list(pose),
            arm_err=arm_err, sys_err=sys_err,
        )

    def get_joint_temperatures(self) -> list[float]:
        arm = self._require("get_joint_temperatures")
        _, temps = self._read_retry(
            "Get_Joint_Temperature", lambda: arm.Get_Joint_Temperature()
        )
        return list(temps)

    def get_joint_currents(self) -> list[float]:
        arm = self._require("get_joint_currents")
        _, currents = self._read_retry(
            "Get_Joint_Current", lambda: arm.Get_Joint_Current()
        )
        return list(currents)

    def get_joint_degrees(self) -> list[float]:
        """관절각(도)만 조회한다(``Get_Joint_Degree``).

        ``Get_Current_Arm_State``는 pose(순기구학)까지 요구해 시뮬레이션 모드에서
        ``CONTROLLER_DATA_LOSE_ERR``를 내는 경우가 있는데, 이 경량 조회는 관절각만
        읽어 그런 상황의 대안이 된다. SDK는 항상 7요소를 주므로 DOF만큼 자른다.
        """
        arm = self._require("get_joint_degrees")
        _, joints = self._read_retry(
            "Get_Joint_Degree", lambda: arm.Get_Joint_Degree()
        )
        return list(joints)[: self.config.dof]
