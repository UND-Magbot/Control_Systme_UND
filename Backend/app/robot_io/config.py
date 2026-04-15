"""로봇 통신 네트워크 설정 상수."""

# 로봇 본체 (ASDU 프로토콜 엔드포인트)
ROBOT_IP = "10.21.31.103"
ROBOT_PORT = 30000

# receiver.py (로봇 NOS에서 동작하는 중계기)
RECEIVER_IP = "10.21.31.106"
RECEIVER_PORT = 40000

# PC 측 수신 포트
PC_PORT_POS = 35000
PC_PORT_STATUS = 35001
PC_PORT_NAV = 35002

# 폴링 주기
REQ_INTERVAL_POS = 2.0
REQ_INTERVAL_HB = 1.0

# 기본 초기 pose
INIT_POSE = {"PosX": 3.998, "PosY": -2.612, "PosZ": 0.0, "Yaw": -1.604}
