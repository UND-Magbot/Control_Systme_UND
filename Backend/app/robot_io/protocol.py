"""ASDU 패킷 빌더와 초기 pose 전송."""

import json
import socket
import struct
import time

import app.robot_io.runtime as runtime
from app.robot_io.config import ROBOT_IP, ROBOT_PORT, INIT_POSE


def build_packet(asdu_dict: dict) -> bytes:
    """ASDU JSON 페이로드를 로봇 프로토콜 헤더로 감싼다."""
    payload = json.dumps(asdu_dict).encode()
    length = len(payload)
    header = struct.pack(
        "<4BHHB7B",
        0xEB, 0x91, 0xEB, 0x90,
        length,
        1,
        0x01,
        *(0x00,) * 7,
    )
    return header + payload


def send_init_pose() -> None:
    """로봇에 직접 init_pose 전송 + 위치 변화로 성공 확인."""
    # 1) 전송 전 위치 기록
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    before = runtime.get_position(rid) if rid else {}
    print(f"📍 [INIT_POSE] 전송 전 위치: x={before.get('x')}, y={before.get('y')}, yaw={before.get('yaw')}")

    # 2) 로봇에 직접 전송 (fire-and-forget — Type 2101은 응답 없는 프로토콜)
    asdu = {
        "PatrolDevice": {
            "Type": 2101,
            "Command": 1,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": INIT_POSE,
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
    sock.close()
    print(f"[INIT] [INIT_POSE] 전송 완료 → {ROBOT_IP}:{ROBOT_PORT} | {INIT_POSE}")

    # 3) 3초 후 위치 다시 확인
    time.sleep(3)
    after = runtime.get_position(rid) if rid else {}
    print(f"📍 [INIT_POSE] 전송 후 위치: x={after.get('x')}, y={after.get('y')}, yaw={after.get('yaw')}")

    dx = abs(after.get("x", 0) - before.get("x", 0))
    dy = abs(after.get("y", 0) - before.get("y", 0))
    if dx > 0.01 or dy > 0.01:
        print(f"[OK] [INIT_POSE] 위치 변화 감지! dx={dx:.3f}, dy={dy:.3f} → 적용 성공")
    else:
        print(f"[WARN] [INIT_POSE] 위치 변화 없음 (dx={dx:.3f}, dy={dy:.3f}) → 적용 안 됐을 수 있음")
