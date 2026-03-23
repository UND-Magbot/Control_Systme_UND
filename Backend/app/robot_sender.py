import socket
import json

ROBOT_IP = "10.21.31.106"
ROBOT_PORT = 40000

def send_to_robot(action: str):
    """
    FastAPI 서버 → 로봇에게 UDP 전송하는 함수
    action: "UP", "DOWN", "LEFT", "RIGHT", "STOP" 등
    """

    msg = {"action": action}
    data = json.dumps(msg).encode("utf-8")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(data, (ROBOT_IP, ROBOT_PORT))
    sock.close()

    print(f"서버 → 로봇 UDP 송신 완료: {msg}")

    

def send_nav_to_robot(idx, x, y, yaw):
    msg = {
        "action": "NAV",
        "idx": idx,
        "x": x,
        "y": y,
        "yaw": yaw
    }

    data = json.dumps(msg).encode("utf-8")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(data, (ROBOT_IP, ROBOT_PORT))
    sock.close()
    print(f"[FASTAPI → ROBOT NAV] {msg}")
