"""로봇 NOS의 receiver.py로 JSON 액션 UDP 송신.

- send_to_robot: 단순 액션(UP/DOWN/STAND/SIT 등) fire-and-forget
- send_nav_to_robot: NAV 명령 + receiver ACK 대기 (2초 타임아웃)
"""

import json
import socket

from app.robot_io.config import RECEIVER_IP, RECEIVER_PORT


def _udp_send(msg: dict, *, wait_ack_idx: int | None = None, timeout: float = 2.0) -> dict | None:
    """RECEIVER로 JSON 메시지 UDP 송신. wait_ack_idx가 주어지면 해당 idx의 ack를 대기."""
    data = json.dumps(msg).encode("utf-8")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        if wait_ack_idx is not None:
            sock.settimeout(timeout)
        sock.sendto(data, (RECEIVER_IP, RECEIVER_PORT))
        if wait_ack_idx is None:
            return None
        try:
            ack_data, _ = sock.recvfrom(4096)
            return json.loads(ack_data.decode("utf-8"))
        except socket.timeout:
            return None
    finally:
        sock.close()


def send_to_robot(action: str) -> None:
    """액션 문자열을 receiver로 fire-and-forget 송신.
    action 예: "UP", "DOWN", "LEFT", "RIGHT", "STOP", "STAND", "SIT" 등.
    """
    msg = {"action": action}
    _udp_send(msg)
    print(f"서버 → 로봇 UDP 송신 완료: {msg}")


def send_nav_to_robot(idx: int, x: float, y: float, yaw: float) -> None:
    """NAV 명령 송신 + receiver ACK 대기."""
    msg = {"action": "NAV", "idx": idx, "x": x, "y": y, "yaw": yaw}
    print(f"[FASTAPI → ROBOT NAV] {msg}")

    try:
        ack = _udp_send(msg, wait_ack_idx=idx)
    except Exception as e:
        print(f"[NAV ACK] 오류: {e}")
        return

    if ack is None:
        print(f"[NAV ACK] [WARN] receiver 응답 없음 (WP{idx}) — 명령 유실 가능")
        return

    if ack.get("ack") and ack.get("idx") == idx:
        print(f"[NAV ACK] receiver 수신 확인 (WP{idx})")
    else:
        print(f"[NAV ACK] 예상치 못한 응답: {ack}")
