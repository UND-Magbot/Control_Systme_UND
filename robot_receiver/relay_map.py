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
        # 측위(localization) 모드용 — LIO 정합 스캔(위치 재조정 오버레이 소스).
        # /SLAM_* 은 매핑 전용이라 측위 중엔 안 나오고, 측위 모드에선 /LIO_* 가 나온다.
        self.latest_lio_aligned_json = None
        # 측위 스캔(body 프레임, /LOC_BODY_POINTS) — 측위 중 ~10Hz 상시 publish.
        # LIO_ALIGNED 는 측위 중 조용해서, 위치 재조정 오버레이는 이 body 스캔을 쓴다.
        # (프론트가 로봇 pose 로 map 프레임 변환해 얹음 = rviz+TF 와 동일)
        self.latest_loc_body_json = None
        self.lock = threading.Lock()

        qos_reliable = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
            depth=10,
        )
        # 라이다/포인트클라우드 센서 토픽은 보통 BEST_EFFORT 로 publish 된다.
        # BEST_EFFORT 구독은 RELIABLE·BEST_EFFORT publisher 양쪽과 호환되므로(역은 불가),
        # /LIO_ALIGNED_POINTS 처럼 QoS 를 모르는 센서 토픽엔 BEST_EFFORT 로 붙는다.
        qos_sensor = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            depth=5,
        )

        self.create_subscription(Odometry, "/SLAM_ODOM", self.on_odom, qos_reliable)
        self.create_subscription(PointCloud2, "/SLAM_ACCUMULATED_POINTS_MAP", self.on_cloud, qos_reliable)
        self.create_subscription(PointCloud2, "/SLAM_ALIGNED_POINTS", self.on_aligned, qos_reliable)
        # 측위 모드 정합 스캔 — 위치 재조정(RelocalizeModal) 오버레이용. 센서 QoS(BEST_EFFORT).
        self.create_subscription(PointCloud2, "/LIO_ALIGNED_POINTS", self.on_lio_aligned, qos_sensor)
        # 측위 body 스캔(상시 ~10Hz) — 위치 재조정 오버레이 실사용 소스.
        self.create_subscription(PointCloud2, "/LOC_BODY_POINTS", self.on_loc_body, qos_sensor)

        self.get_logger().info(
            "구독 시작: /SLAM_ODOM, /SLAM_ACCUMULATED_POINTS_MAP, /SLAM_ALIGNED_POINTS, "
            "/LIO_ALIGNED_POINTS, /LOC_BODY_POINTS"
        )

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

    def on_lio_aligned(self, msg: PointCloud2):
        """측위 모드 정합 스캔(/LIO_ALIGNED_POINTS) → 위치 재조정 오버레이용.

        on_aligned 과 동일 포맷(type=aligned)으로 캐시해, 프론트가 같은 렌더 경로를 쓴다.
        map 프레임 정합 점군이므로 저장맵 위에 그대로 얹힌다.
        """
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
        was_none = self.latest_lio_aligned_json is None
        with self.lock:
            self.latest_lio_aligned_json = data
        if was_none:
            self.get_logger().info(f"LIO_ALIGNED 첫 수신: {len(points)}점")

    def on_loc_body(self, msg: PointCloud2):
        """측위 body 스캔(/LOC_BODY_POINTS) → 위치 재조정 오버레이용(body 프레임).

        body 프레임(로봇 기준) x=전방, y=좌측 점을 그대로 전달한다. 프론트가 로봇 pose 로
        map 프레임 변환해 저장맵에 얹는다(rviz+TF 와 동일). type=body 로 표시해 프론트가 구분.
        """
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
        # 60KB UDP 상한 대비 — 최대 ~1500점으로 적응적 다운샘플(조밀해도 payload 안정).
        stride = max(2, num_points // 1500)
        for i in range(0, num_points, stride):
            offset = i * point_step
            x = struct.unpack_from("<f", raw, offset + x_offset)[0]
            y = struct.unpack_from("<f", raw, offset + y_offset)[0]
            if math.isfinite(x) and math.isfinite(y):
                points.append([round(x, 3), round(y, 3)])

        data = json.dumps({
            "type": "body",
            "count": len(points),
            "points": points,
        })
        was_none = self.latest_loc_body_json is None
        with self.lock:
            self.latest_loc_body_json = data
        if was_none:
            self.get_logger().info(f"LOC_BODY 첫 수신: {len(points)}점")


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
                elif action == "LIO_ALIGNED" and node.latest_lio_aligned_json:
                    payload = node.latest_lio_aligned_json.encode("utf-8")
                    if len(payload) > 60000:
                        sock.sendto(b'{"type":"aligned","count":0,"points":[]}', addr)
                    else:
                        sock.sendto(payload, addr)
                elif action == "LOC_BODY" and node.latest_loc_body_json:
                    payload = node.latest_loc_body_json.encode("utf-8")
                    if len(payload) > 60000:
                        sock.sendto(b'{"type":"body","count":0,"points":[]}', addr)
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
