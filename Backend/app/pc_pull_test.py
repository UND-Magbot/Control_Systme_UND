#!/usr/bin/env python3
import socket
import json
import struct
import time

ROBOT_IP = "10.21.31.103"
ROBOT_PORT = 30000

PC_PORT = 35000  # PC가 받을 포트 (로봇이 응답 보냄)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("0.0.0.0", PC_PORT))
sock.settimeout(2.0)

def request_robot_position():
    # 위치 요청 패킷
    asdu = {
        "PatrolDevice": {
            "Type": 1007,
            "Command": 2,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {}
        }
    }

    payload = json.dumps(asdu).encode()
    header = struct.pack(
        "<4BHHB7B",
        0xEB, 0x91, 0xEB, 0x90,
        len(payload),
        1,
        0x01,
        *(0x00,) * 7
    )

    packet = header + payload

    print("\n📤 위치 요청 전송…")
    sock.sendto(packet, (ROBOT_IP, ROBOT_PORT))

    try:
        data, addr = sock.recvfrom(4096)
        msg = json.loads(data[16:].decode())

        pd = msg["PatrolDevice"]
        items = pd["Items"]

        print(f"📥 응답 도착 → X:{items['PosX']}, Y:{items['PosY']}, Yaw:{items['Yaw']}")
    except socket.timeout:
        print("⏳ 응답 없음 (Timeout)")


if __name__ == "__main__":
    while True:
        request_robot_position()
        time.sleep(2)
