#!/usr/bin/env python3
"""
모션(보행/상태) 릴레이 스크립트
로봇(NOS)에서 root로 실행 — relay_charge.py 와 동일 패턴(읽기) + 발행(쓰기) 추가.

- 읽기: ROS2 /MOTION_INFO(20Hz) 구독 → 로컬 UDP(50002)로 receiver.py에 현재 gait/state 전달
- 쓰기: receiver.py가 로컬 UDP(50003)로 보낸 전환 명령 → ROS2 /GAIT · /MOTION_STATE 발행

실행:
  su
  source /opt/robot/scripts/setup_ros2.sh
  python3 relay_motion.py

명령 프로토콜 (receiver → 127.0.0.1:50003, JSON):
  {"cmd": "gait",  "value": 12290}   # 0x3002 Flat / 0x3003(12291) Stair (Agile)
  {"cmd": "state", "value": 17}      # Idle0 Stand1 SoftEStop2 PowerDamping3 Sit4 RLControl17

주의: /GAIT·/MOTION_STATE 발행은 실제로 로봇 보행/상태를 바꾼다. RL Control(17)/원격
제어 진입 시에만 토픽이 활성화되며, 안전한 자세·공간에서만 publish 할 것.
"""

import json
import socket
import threading
import os
import subprocess
import sys

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy

# /GAIT·/MOTION_STATE·/MOTION_INFO 의 실제 타입 (ros2 interface show 로 확인):
#   Gait        = MetaType header + GaitValue data{uint32 gait}
#   MotionState = MetaType header + MotionStateValue data{int32 state}
#   MotionInfo  = MetaType header + MotionInfoValue data{... motion_state, gait_state ...}
from drdds.msg import MotionInfo, Gait, MotionState

# ── 포트 ──
RECEIVER_INFO_PORT = 50002   # relay_motion → receiver (현재 gait/state push)
CMD_LISTEN_PORT = 50003      # receiver → relay_motion (전환 명령 수신)


class MotionRelay(Node):
    def __init__(self):
        super().__init__("motion_relay")

        # /GAIT 와 동일 QoS (ros2 topic info /GAIT -v: RELIABLE / VOLATILE)
        qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
            depth=10,
        )

        self._out_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._frame_id = 0
        self._last_sent = None  # (gait, state) 마지막 전송값 — 변화 시에만 push (20Hz 폭주 방지)

        # ── 읽기: /MOTION_INFO 구독 ──
        self.create_subscription(MotionInfo, "/MOTION_INFO", self._on_motion_info, qos)

        # ── 쓰기: 퍼블리셔 ──
        self._gait_pub = self.create_publisher(Gait, "/GAIT", qos)
        self._state_pub = self.create_publisher(MotionState, "/MOTION_STATE", qos)

        # ── 쓰기: receiver 명령 수신 스레드 ──
        self._cmd_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._cmd_sock.bind(("127.0.0.1", CMD_LISTEN_PORT))
        threading.Thread(target=self._cmd_loop, daemon=True).start()

        self.get_logger().info(
            f"구독 /MOTION_INFO → UDP:{RECEIVER_INFO_PORT} | "
            f"발행 /GAIT·/MOTION_STATE | 명령수신 127.0.0.1:{CMD_LISTEN_PORT}"
        )

    # ── 읽기 콜백 ──
    def _on_motion_info(self, msg):
        gait = int(msg.data.gait_state.gait)
        state = int(msg.data.motion_state.state)
        # 보행/상태 변화 없으면 skip — 20Hz 그대로 흘리지 않는다.
        if (gait, state) == self._last_sent:
            return
        self._last_sent = (gait, state)

        payload = json.dumps({
            "gait": gait,
            "state": state,
            "vel_x": float(msg.data.vel_x),
            "vel_y": float(msg.data.vel_y),
            "vel_yaw": float(msg.data.vel_yaw),
            "height": float(msg.data.height),
            "remain_mile": float(msg.data.remain_mile),
        }).encode("utf-8")
        self._out_sock.sendto(payload, ("127.0.0.1", RECEIVER_INFO_PORT))
        self.get_logger().info(f"MOTION_INFO → gait=0x{gait:04x}, state={state}")

    # ── 쓰기: receiver 명령 수신 루프 ──
    def _cmd_loop(self):
        while True:
            try:
                data, _ = self._cmd_sock.recvfrom(1024)
                msg = json.loads(data.decode("utf-8"))
                cmd = msg.get("cmd")
                value = int(msg.get("value"))
                if cmd == "gait":
                    self._publish_gait(value)
                elif cmd == "state":
                    self._publish_state(value)
                else:
                    self.get_logger().warn(f"알 수 없는 cmd: {cmd}")
            except Exception as e:
                self.get_logger().error(f"[CMD ERR] {e}")

    def _fill_header(self, m):
        self._frame_id += 1
        m.header.frame_id = self._frame_id
        m.header.stamp = self.get_clock().now().to_msg()

    def _publish_gait(self, value):
        m = Gait()
        self._fill_header(m)
        m.data.gait = value
        self._gait_pub.publish(m)
        self.get_logger().info(f"발행 /GAIT gait=0x{value:04x}")

    def _publish_state(self, value):
        m = MotionState()
        self._fill_header(m)
        m.data.state = value
        self._state_pub.publish(m)
        self.get_logger().info(f"발행 /MOTION_STATE state={value}")


def ensure_environment():
    """root 권한 확인 및 멀티캐스트 라우트 설정 (relay_charge.py 와 동일)."""
    if os.geteuid() != 0:
        print("[ERROR] root 권한이 필요합니다.")
        print("  su")
        print("  source /opt/robot/scripts/setup_ros2.sh")
        print("  python3 relay_motion.py")
        sys.exit(1)

    result = subprocess.run(
        ["ip", "route", "show", "224.0.0.0/4"],
        capture_output=True, text=True,
    )
    if not result.stdout.strip():
        print("[SETUP] 멀티캐스트 라우트 추가: 224.0.0.0/4 dev eth0")
        subprocess.run(["ip", "route", "add", "224.0.0.0/4", "dev", "eth0"])
    else:
        print("[SETUP] 멀티캐스트 라우트 이미 존재")


def main():
    ensure_environment()

    rclpy.init()
    node = MotionRelay()

    print("🦿 모션 릴레이 실행 중...")
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
