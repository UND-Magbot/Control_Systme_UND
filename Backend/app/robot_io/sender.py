"""로봇 NOS의 receiver.py로 JSON 액션 송신.

- send_to_robot: 단순 액션(UP/DOWN/STAND/SIT 등) fire-and-forget (UDP)
- send_nav_to_robot: NAV 명령 — 신뢰 채널(TCP 40001) 우선, 실패 시 UDP 폴백

NAV는 WiFi(PC↔NOS) 구간 유실 시 자율주행 명령이 사라지는 문제가 있어 TCP로
보장 전송한다. STOP·긴급정지·수동 조작 등 지연 민감/손실 허용 명령은 UDP를 유지한다.
"""

import json
import socket

from app.robot_io.config import RECEIVER_IP, RECEIVER_PORT, RECEIVER_TCP_PORT


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


def send_posture_to_robot(x: float, y: float, z: float,
                          roll: float, pitch: float, yaw: float) -> None:
    """자세(Posture) 제어 — Type 2/21 6축 setpoint를 receiver로 fire-and-forget 송신.
    각 값 [-1,1] = 최대 기울기/이동 비율. (Regular/Standard 모드 전용)
    """
    msg = {"action": "POSTURE", "X": x, "Y": y, "Z": z,
           "Roll": roll, "Pitch": pitch, "Yaw": yaw}
    _udp_send(msg)
def _tcp_send_nav(
    msg: dict, connect_timeout: float = 5.0, recv_timeout: float = 6.0
) -> dict | None:
    """NAV를 receiver에 TCP(40001)로 보장 전송하고 ACK(JSON 한 줄)를 받는다.

    개행(\\n)으로 구분된 JSON 한 줄을 보내고 같은 형식의 ACK를 읽는다.
    연결/통신 실패 시 예외를 던져 호출자가 UDP로 폴백하게 한다.
    응답이 비면 None.

    connect/recv 타임아웃 분리:
    - connect_timeout(5s): "WiFi 혼잡하지만 살아있는" 구간을 두절로 오판해
      UDP로 조기 폴백(=TCP 신뢰성 이득 상실)하지 않도록 여유를 둔다.
      정상 LAN이면 ms 단위로 반환되므로 평시 비용은 없다.
    - recv_timeout(6s): connect 성공 후 receiver가 hop②(로봇 본체)로 전달하고
      응답할 시간. receiver의 hop② TCP 예산(_send_packet_to_robot_tcp, 3s)보다
      커야 receiver가 아직 전달/UDP폴백 중인데 백엔드가 먼저 포기하는 레이스를
      막는다.
    블록은 nav_thread 폴링 루프 안에서 발생하므로(두절 시 최대 ~5s connect),
    안전정지 예산(RECEIVER_LOST_STOP_SEC=60)·1초 폴링 봉투 안에서만 키운다.
    """
    data = json.dumps(msg).encode("utf-8") + b"\n"
    with socket.create_connection(
        (RECEIVER_IP, RECEIVER_TCP_PORT), timeout=connect_timeout
    ) as sock:
        sock.settimeout(recv_timeout)
        sock.sendall(data)
        buf = b""
        while b"\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
    if not buf:
        return None
    return json.loads(buf.split(b"\n", 1)[0].decode("utf-8"))


def send_nav_to_robot(idx: int, x: float, y: float, yaw: float) -> None:
    """NAV 명령 송신 — 신뢰 채널(TCP) 우선, 실패 시 UDP 폴백.

    TCP ACK 의미: receiver(NOS)가 NAV를 수신하고 로봇 본체로 전달했음을 보장.
    (WiFi 구간 PC↔NOS 유실 해결. 로봇 본체로의 최종 전달도 receiver가 TCP/UDP로 수행.)
    """
    msg = {"action": "NAV", "idx": idx, "x": x, "y": y, "yaw": yaw}
    print(f"[FASTAPI → ROBOT NAV] {msg}")

    # 1) 신뢰 채널(TCP 40001) 우선
    try:
        ack = _tcp_send_nav(msg)
        if ack is not None:
            if ack.get("ack") and ack.get("idx") == idx:
                print(f"[NAV ACK] (TCP) receiver 수신 확인 (WP{idx})")
            else:
                print(f"[NAV ACK] (TCP) 예상치 못한 응답: {ack}")
            return
        # 연결은 됐으나 ACK 없음(연결 중 끊김) → UDP 폴백
        print(f"[NAV ACK] (TCP) 응답 없음 — UDP 폴백 (WP{idx})")
    except Exception as e:
        print(f"[NAV TCP] 연결 실패 → UDP 폴백 (WP{idx}): {e}")

    # 2) 폴백: 기존 UDP 경로 (receiver 미업데이트/TCP 차단 시 회귀 방지)
    try:
        ack = _udp_send(msg, wait_ack_idx=idx)
    except Exception as e:
        print(f"[NAV ACK] (UDP) 오류: {e}")
        return

    if ack is None:
        print(f"[NAV ACK] (UDP) [WARN] receiver 응답 없음 (WP{idx}) — 명령 유실 가능")
        return

    if ack.get("ack") and ack.get("idx") == idx:
        print(f"[NAV ACK] (UDP) receiver 수신 확인 (WP{idx})")
    else:
        print(f"[NAV ACK] (UDP) 예상치 못한 응답: {ack}")
