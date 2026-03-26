#!/usr/bin/env python3
"""
맵핑 실시간 시각화 릴레이 스크립트
NOS(10.21.31.106)에서 root로 실행

ROS2 토픽 구독 → 로컬 UDP(50000)로 receiver.py에 전달
receiver.py가 서버 요청(MAPPING_ODOM, MAPPING_CLOUD)에 응답

실행:
  su
  source /opt/robot/scripts/setup_ros2.sh
  python3 relay_map.py
"""

import json
import struct
import threading
import time
import math
import socket
import os
import subprocess
import sys

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from nav_msgs.msg import Odometry
from sensor_msgs.msg import PointCloud2

# ── 로컬 UDP로 receiver.py에 전달 ──
LOCAL_PORT = 50000


class MappingRelay(Node):
    def __init__(self):
        super().__init__("mapping_relay")

        self.latest_odom_json = None
        self.latest_cloud_json = None
        self.latest_aligned_json = None
        self.lock = threading.Lock()

        qos_reliable = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
            depth=10,
        )

        self.create_subscription(Odometry, "/SLAM_ODOM", self.on_odom, qos_reliable)
        self.create_subscription(PointCloud2, "/SLAM_ACCUMULATED_POINTS_MAP", self.on_cloud, qos_reliable)
        self.create_subscription(PointCloud2, "/SLAM_ALIGNED_POINTS", self.on_aligned, qos_reliable)

        self.get_logger().info("구독 시작: /SLAM_ODOM, /SLAM_ACCUMULATED_POINTS_MAP, /SLAM_ALIGNED_POINTS")

    def on_odom(self, msg: Odometry):
        pos = msg.pose.pose.position
        ori = msg.pose.pose.orientation
        siny = 2.0 * (ori.w * ori.z + ori.x * ori.y)
        cosy = 1.0 - 2.0 * (ori.y * ori.y + ori.z * ori.z)
        yaw = math.atan2(siny, cosy)
        data = json.dumps({
            "type": "odom",
            "x": round(pos.x, 4),
            "y": round(pos.y, 4),
            "yaw": round(yaw, 4),
        })
        was_none = self.latest_odom_json is None
        with self.lock:
            self.latest_odom_json = data
        if was_none:
            self.get_logger().info(f"SLAM_ODOM 첫 수신: x={pos.x:.2f}, y={pos.y:.2f}")

    def on_cloud(self, msg: PointCloud2):
        x_offset = y_offset = None
        for field in msg.fields:
            if field.name == "x":
                x_offset = field.offset
            elif field.name == "y":
                y_offset = field.offset

        if x_offset is None or y_offset is None:
            return

        points = []
        point_step = msg.point_step
        raw = bytes(msg.data)
        num_points = len(raw) // point_step
        downsample = 4

        for i in range(0, num_points, downsample):
            offset = i * point_step
            x = struct.unpack_from("<f", raw, offset + x_offset)[0]
            y = struct.unpack_from("<f", raw, offset + y_offset)[0]
            if math.isfinite(x) and math.isfinite(y):
                points.append([round(x, 3), round(y, 3)])

        data = json.dumps({
            "type": "cloud",
            "count": len(points),
            "points": points,
        })
        was_none = self.latest_cloud_json is None
        with self.lock:
            self.latest_cloud_json = data
        if was_none:
            self.get_logger().info(f"SLAM_CLOUD 첫 수신: {len(points)}점")

    def on_aligned(self, msg: PointCloud2):
        x_offset = y_offset = None
        for field in msg.fields:
            if field.name == "x":
                x_offset = field.offset
            elif field.name == "y":
                y_offset = field.offset

        if x_offset is None or y_offset is None:
            return

        points = []
        point_step = msg.point_step
        raw = bytes(msg.data)
        num_points = len(raw) // point_step

        for i in range(0, num_points, 2):
            offset = i * point_step
            x = struct.unpack_from("<f", raw, offset + x_offset)[0]
            y = struct.unpack_from("<f", raw, offset + y_offset)[0]
            if math.isfinite(x) and math.isfinite(y):
                points.append([round(x, 3), round(y, 3)])

        data = json.dumps({
            "type": "aligned",
            "count": len(points),
            "points": points,
        })
        was_none = self.latest_aligned_json is None
        with self.lock:
            self.latest_aligned_json = data
        if was_none:
            self.get_logger().info(f"SLAM_ALIGNED 첫 수신: {len(points)}점")


def local_udp_server(node: MappingRelay):
    """로컬 UDP 서버: receiver.py로부터 요청 받아 최신 데이터 응답"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", LOCAL_PORT))
    sock.settimeout(1.0)
    print(f"📡 로컬 UDP 서버 시작 (127.0.0.1:{LOCAL_PORT})")

    while True:
        try:
            data, addr = sock.recvfrom(1024)
            msg = json.loads(data.decode("utf-8"))
            action = msg.get("action")

            with node.lock:
                if action == "MAPPING_ODOM" and node.latest_odom_json:
                    sock.sendto(node.latest_odom_json.encode("utf-8"), addr)
                elif action == "MAPPING_CLOUD" and node.latest_cloud_json:
                    payload = node.latest_cloud_json.encode("utf-8")
                    if len(payload) > 60000:
                        sock.sendto(b'{"type":"cloud","count":0,"points":[]}', addr)
                    else:
                        sock.sendto(payload, addr)
                elif action == "MAPPING_ALIGNED" and node.latest_aligned_json:
                    payload = node.latest_aligned_json.encode("utf-8")
                    if len(payload) > 60000:
                        sock.sendto(b'{"type":"aligned","count":0,"points":[]}', addr)
                    else:
                        sock.sendto(payload, addr)
                else:
                    sock.sendto(b'{}', addr)

        except socket.timeout:
            continue
        except Exception as e:
            print(f"[LOCAL UDP ERR] {e}")


def ensure_environment():
    """root 권한 확인 및 멀티캐스트 라우트 설정"""
    if os.geteuid() != 0:
        print("[ERROR] root 권한이 필요합니다.")
        print("  su")
        print("  source /opt/robot/scripts/setup_ros2.sh")
        print("  python3 relay_map.py")
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
    node = MappingRelay()

    spin_thread = threading.Thread(target=rclpy.spin, args=(node,), daemon=True)
    spin_thread.start()

    local_udp_server(node)


if __name__ == "__main__":
    main()
