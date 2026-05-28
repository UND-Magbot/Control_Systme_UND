#!/usr/bin/env python3
"""
충전 상태 릴레이 스크립트
로봇(NOS)에서 root로 실행

ROS2 토픽 /CHARGE_STATUS 구독 → 로컬 UDP(50001)로 receiver.py에 전달

실행:
  su
  source /opt/robot/scripts/setup_ros2.sh
  python3 relay_charge.py
"""

import json
import threading
import time
import socket
import os
import subprocess
import sys

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy

# /CHARGE_STATUS 의 실제 publish 타입(ros2 topic info 로 확인): drdds/msg/StdStatus
# - int32 state
# - uint32 error_code
from drdds.msg import StdStatus

# ── receiver.py로 전달할 UDP 포트 ──
RECEIVER_PORT = 50001


class ChargeStatusRelay(Node):
    def __init__(self):
        super().__init__("charge_status_relay")

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

        qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
            depth=10,
        )

        self.latest_state = 0
        self.latest_error_code = 0

        self.create_subscription(
            StdStatus,
            "/CHARGE_STATUS",
            self.on_charge_status,
            qos,
        )

        self.get_logger().info("구독 시작: /CHARGE_STATUS (drdds/msg/StdStatus)")

    def on_charge_status(self, msg):
        """/CHARGE_STATUS 토픽 콜백 (drdds/msg/StdStatus: int32 state, uint32 error_code)."""
        state = int(msg.state)
        error_code = int(msg.error_code)

        self.latest_state = state
        self.latest_error_code = error_code

        payload = json.dumps({
            "state": state,
            "error_code": error_code,
        }).encode("utf-8")

        self.sock.sendto(payload, ("127.0.0.1", RECEIVER_PORT))
        self.get_logger().info(f"CHARGE_STATUS → state={state}, error_code={error_code}")


def ensure_environment():
    """root 권한 확인 및 멀티캐스트 라우트 설정"""
    if os.geteuid() != 0:
        print("[ERROR] root 권한이 필요합니다.")
        print("  su")
        print("  source /opt/robot/scripts/setup_ros2.sh")
        print("  python3 relay_charge.py")
        sys.exit(1)

    result = subprocess.run(
        ["ip", "route", "show", "224.0.0.0/4"],
        capture_output=True, text=True
    )
    if not result.stdout.strip():
        print("[SETUP] 멀티캐스트 라우트 추가: 224.0.0.0/4 dev eth0")
        subprocess.run(["ip", "route", "add", "224.0.0.0/4", "dev", "eth0"])
    else:
        print("[SETUP] 멀티캐스트 라우트 이미 존재")


def main():
    ensure_environment()

    rclpy.init()
    node = ChargeStatusRelay()

    print("🔋 충전 상태 릴레이 실행 중...")
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
