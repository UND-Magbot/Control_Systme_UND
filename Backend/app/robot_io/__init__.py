"""로봇 I/O 패키지.

- config: 네트워크 설정 상수
- protocol: ASDU 패킷 빌더, 초기 pose 전송
- polling: 위치/상태/네비 수신 스레드
"""

from app.robot_io.config import (
    ROBOT_IP,
    ROBOT_PORT,
    RECEIVER_IP,
    RECEIVER_PORT,
    PC_PORT_POS,
    PC_PORT_STATUS,
    PC_PORT_NAV,
    REQ_INTERVAL_POS,
    REQ_INTERVAL_HB,
    INIT_POSE,
)
from app.robot_io.protocol import build_packet, send_init_pose
from app.robot_io.polling import start_polling_threads

__all__ = [
    "ROBOT_IP",
    "ROBOT_PORT",
    "RECEIVER_IP",
    "RECEIVER_PORT",
    "PC_PORT_POS",
    "PC_PORT_STATUS",
    "PC_PORT_NAV",
    "REQ_INTERVAL_POS",
    "REQ_INTERVAL_HB",
    "INIT_POSE",
    "build_packet",
    "send_init_pose",
    "start_polling_threads",
]
