#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import socket
import json
import struct
import time
import threading
from concurrent.futures import ThreadPoolExecutor

ROBOT_IP = "10.21.31.103"
ROBOT_PORT = 30000

# PC가 UDP 명령 받을 포트
SERVER_UDP_PORT = 40000

# relay_map.py 로컬 통신 포트
MAPPING_LOCAL_PORT = 50000
mapping_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
mapping_sock.settimeout(1.0)

# relay_charge.py 로컬 통신 포트
CHARGE_LOCAL_PORT = 50001

# relay_motion.py 로컬 통신 포트
MOTION_RELAY_PORT = 50003       # receiver → relay_motion (보행/상태 전환 명령 송신)
MOTION_INFO_LOCAL_PORT = 50002  # relay_motion → receiver (현재 gait/state 수신)
motion_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

# 로봇이 PC에서 오는 명령 수신용 소켓
server_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
server_sock.bind(("0.0.0.0", SERVER_UDP_PORT))
server_sock.settimeout(0.1)

# 로봇 → 로봇컨트롤로 명령 송신용 소켓
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(0.1)
sock.bind(("", 30001))


# ============================================================
# 위치 폴링 (추가)
# ============================================================
latest_position = {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}
latest_nav_status = {"status": None, "timestamp": 0, "mono": 0.0}
latest_battery = {}
latest_device_temp = {}
latest_charge_state = {"state": 0, "error_code": 0, "timestamp": 0}  # /CHARGE_STATUS
latest_basic_status = {}  # Type=1002, Command=6 (Obtain Basic Status) — Sleep 값 등 포함
latest_motion_info = {}   # relay_motion.py(/MOTION_INFO) → {"gait":..., "state":...}
latest_abnormal_status = []  # Type=1002, Command=3 (Abnormal Status) — 활성 에러 객체 배열(ErrorList)

def nav_poll_loop():
    global latest_nav_status
    nav_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    nav_sock.settimeout(1.0)

    print("📡 네비 상태 폴링 시작")

    while True:
        try:
            asdu = {
                "PatrolDevice": {
                    "Type": 1007,
                    "Command": 1,
                    "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "Items": {}
                }
            }
            asdu_bytes = json.dumps(asdu).encode("utf-8")
            asdu_len = len(asdu_bytes)
            header = struct.pack(
                "<4BHHB7B",
                0xEB, 0x91, 0xEB, 0x90,
                asdu_len, 1, 0x01,
                *(0x00,) * 7
            )
            nav_sock.sendto(header + asdu_bytes, (ROBOT_IP, ROBOT_PORT))

            data, addr = nav_sock.recvfrom(4096)
            try:
                msg = json.loads(data.decode())
            except:
                msg = json.loads(data[16:].decode())

            pd = msg.get("PatrolDevice", {})
            if pd.get("Type") == 1007 and pd.get("Command") == 1:
                items = pd.get("Items", {})
                status = items.get("Status", items.get("State"))
                if status is not None:
                    latest_nav_status = {
                        "status": status,
                        "timestamp": time.time(),
                        # 갱신 시점을 monotonic으로 기록 → NAV_STATUS 응답 시 age 계산에 사용.
                        # 백엔드와 시계가 어긋나도 age는 로봇 NOS 한 머신 안에서만 계산된다.
                        "mono": time.monotonic(),
                    }
        except socket.timeout:
            pass
        except Exception as e:
            print("[NAV POLL ERR]", e)

        time.sleep(1)


def battery_poll_loop():
    """heartbeat(Type=100, Command=100) 전송 → 로봇이 push하는 패킷 중
    - Type=1002, Command=5 에서 BatteryStatus 추출
    - Type=1002, Command=6 (Obtain Basic Status)에서 Sleep / PowerManagement 추출
    - Type=1002, Command=3 (Abnormal Status)에서 활성 에러 목록(ErrorList) 추출
    - /CHARGE_STATUS 패킷에서 충전 상태 추출
    """
    global latest_battery, latest_charge_state, latest_device_temp, latest_basic_status
    global latest_abnormal_status
    bat_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    bat_sock.settimeout(1.0)

    print("📡 배터리 폴링 시작 (heartbeat 방식)")

    while True:
        try:
            # heartbeat 전송
            asdu = {
                "PatrolDevice": {
                    "Type": 100,
                    "Command": 100,
                    "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "Items": {}
                }
            }
            asdu_bytes = json.dumps(asdu).encode("utf-8")
            asdu_len = len(asdu_bytes)
            header = struct.pack(
                "<4BHHB7B",
                0xEB, 0x91, 0xEB, 0x90,
                asdu_len, 1, 0x01,
                *(0x00,) * 7
            )
            bat_sock.sendto(header + asdu_bytes, (ROBOT_IP, ROBOT_PORT))

            # 로봇이 여러 패킷을 push하므로 2초간 연속 수신
            deadline = time.time() + 2.0
            while time.time() < deadline:
                bat_sock.settimeout(max(0.1, deadline - time.time()))
                try:
                    data, addr = bat_sock.recvfrom(8192)
                    try:
                        msg = json.loads(data.decode())
                    except:
                        msg = json.loads(data[16:].decode())

                    pd = msg.get("PatrolDevice", {})
                    ptype = pd.get("Type")
                    pcmd = pd.get("Command")
                    items = pd.get("Items", {})

                    if ptype == 1002 and pcmd == 5:
                        battery = items.get("BatteryStatus", {})
                        if battery:
                            latest_battery = battery
                            print(f"✅ [BAT] 업데이트: {list(battery.keys())}")
                        else:
                            print(f"⚠️ [BAT] BatteryStatus 키 없음. Items={items}")

                        device_temp = items.get("DeviceTemperature", {})
                        if device_temp:
                            latest_device_temp = device_temp

                    elif ptype == 1002 and pcmd == 6:
                        # Obtain Basic Status — items.BasicStatus에 중첩돼 있음
                        # - Sleep: 0=On, 1/2=Sleep/Off
                        # - PowerManagement: 0=regular dual battery, 1=single battery
                        # - MotionState: 1=Stand, 4=Sit
                        basic = items.get("BasicStatus", {}) or {}
                        latest_basic_status = {
                            "Sleep": basic.get("Sleep"),
                            "PowerManagement": basic.get("PowerManagement"),
                            "MotionState": basic.get("MotionState"),
                        }

                    elif ptype == 1002 and pcmd == 3:
                        # Obtain Abnormal Status — 활성 에러 객체 배열.
                        # 빈 배열/누락 = 정상(또는 해소됨). receiver는 최신값 보관·릴레이만
                        # 담당하고, 변화 감지/로깅은 백엔드 runtime에서 처리한다.
                        latest_abnormal_status = items.get("ErrorList", []) or []
                        if latest_abnormal_status:
                            print(f"⚠️ [ABNORMAL] 활성 에러 {len(latest_abnormal_status)}건: {latest_abnormal_status}")

                except socket.timeout:
                    break

        except socket.timeout:
            pass
        except Exception as e:
            print("[BAT POLL ERR]", e)

        time.sleep(3)


def charge_status_listener():
    """relay_charge.py → receiver: /CHARGE_STATUS 데이터 수신"""
    global latest_charge_state
    ch_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    ch_sock.bind(("127.0.0.1", CHARGE_LOCAL_PORT))
    ch_sock.settimeout(2.0)
    print(f"🔋 충전 상태 수신 대기 (127.0.0.1:{CHARGE_LOCAL_PORT})")

    while True:
        try:
            data, addr = ch_sock.recvfrom(1024)
            msg = json.loads(data.decode("utf-8"))
            state = msg.get("state", 0)
            error_code = msg.get("error_code", 0)
            latest_charge_state = {
                "state": state,
                "error_code": error_code,
                "timestamp": time.time()
            }
            print(f"🔋 [CHARGE] state={state}, error_code={error_code}")
        except socket.timeout:
            continue
        except Exception as e:
            print(f"[CHARGE LISTEN ERR] {e}")


def motion_info_listener():
    """relay_motion.py → receiver: /MOTION_INFO(gait/state) 수신 → latest_motion_info 갱신."""
    global latest_motion_info
    mi_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    mi_sock.bind(("127.0.0.1", MOTION_INFO_LOCAL_PORT))
    mi_sock.settimeout(2.0)
    print(f"🦿 모션 상태 수신 대기 (127.0.0.1:{MOTION_INFO_LOCAL_PORT})")

    while True:
        try:
            data, addr = mi_sock.recvfrom(1024)
            latest_motion_info = json.loads(data.decode("utf-8"))
        except socket.timeout:
            continue
        except Exception as e:
            print(f"[MOTION INFO LISTEN ERR] {e}")


def position_poll_loop():
    global latest_position
    pos_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    pos_sock.settimeout(1.0)

    print("📡 위치 폴링 시작")

    while True:
        try:
            asdu = {
                "PatrolDevice": {
                    "Type": 1007,
                    "Command": 2,
                    "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "Items": {}
                }
            }
            asdu_bytes = json.dumps(asdu).encode("utf-8")
            asdu_len = len(asdu_bytes)
            header = struct.pack(
                "<4BHHB7B",
                0xEB, 0x91, 0xEB, 0x90,
                asdu_len, 1, 0x01,
                *(0x00,) * 7
            )
            pos_sock.sendto(header + asdu_bytes, (ROBOT_IP, ROBOT_PORT))

            data, addr = pos_sock.recvfrom(4096)
            try:
                msg = json.loads(data.decode())
            except:
                msg = json.loads(data[16:].decode())

            pd = msg.get("PatrolDevice", {})
            if pd.get("Type") == 1007 and pd.get("Command") == 2:
                items = pd.get("Items", {})
                latest_position = {
                    "x": items.get("PosX", 0.0),
                    "y": items.get("PosY", 0.0),
                    "yaw": items.get("Yaw", 0.0),
                    "timestamp": time.time()
                }
        except socket.timeout:
            pass
        except Exception as e:
            print("[POS POLL ERR]", e)

        time.sleep(2)


# ============================================================
# 공통 ASDU 송신 함수
# ============================================================
def send_asdu(type_id, command_id, items=None, idx=1):
    if items is None:
        items = {}

    asdu = {
        "PatrolDevice": {
            "Type": type_id,
            "Command": command_id,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": items
        }
    }

    asdu_bytes = json.dumps(asdu).encode("utf-8")
    asdu_len = len(asdu_bytes)

    header = struct.pack(
        "<4BHHB7B",
        0xEB, 0x91, 0xEB, 0x90,
        asdu_len,
        idx,
        0x01,
        *(0x00,) * 7
    )

    packet = header + asdu_bytes
    sock.sendto(packet, (ROBOT_IP, ROBOT_PORT))
    print("[SEND]", asdu)


# ============================================================
# 제어 모드 변경
# ============================================================
def set_control_mode(mode=0):
    send_asdu(1101, 5, {"Mode": mode})
    print(f"[MODE] → {mode}")
    time.sleep(0.1)


def wait_stand_ready():
    print("⏳ 로봇이 서기 동작 완료할 때까지 대기...")
    time.sleep(1.8)
    set_control_mode(0)
    print("✅ 로봇 이동 가능 상태 (Mode=0)")

# ============================================================
# 기본 동작 함수
# ============================================================
current_speed = 0.5
turn_speed = 0.5

def stand_robot():
    set_control_mode(0)
    send_asdu(2, 22, {"MotionParam": 1})
    print("▶ STAND")
    wait_stand_ready()

def sit_robot():
    set_control_mode(0)
    send_asdu(2, 22, {"MotionParam": 4})
    print("▶ SIT")
    time.sleep(1.0)
    set_control_mode(0)


def move_forward():
    set_control_mode(0)
    send_asdu(2, 21, {"X": current_speed, "Y": 0, "Z": 0, "Roll": 0, "Pitch": 0, "Yaw": 0})
    print("▶ FORWARD")

def move_backward():
    set_control_mode(0)
    send_asdu(2, 21, {"X": -current_speed, "Y": 0,"Z": 0, "Roll": 0, "Pitch": 0, "Yaw": 0})
    print("▶ BACKWARD")

def move_left():
    set_control_mode(0)
    send_asdu(2, 21, {"X": 0.000000, "Y": current_speed, "Z": 0.000000, "Roll": 0.000000, "Pitch": 0.000000, "Yaw": 0.000000})
    print("▶ LEFT")

def move_right():
    set_control_mode(0)
    send_asdu(2, 21, {"X": 0.000000, "Y": -current_speed, "Z": 0.000000, "Roll": 0.000000, "Pitch": 0.000000, "Yaw": 0.000000})
    print("▶ RIGHT")

def turn_left():
    set_control_mode(0)
    send_asdu(2, 21, {"X": 0.1, "Y": 0, "Z": 0, "Roll": 0, "Pitch": 0, "Yaw": turn_speed})
    print("▶ TURN LEFT")

def turn_right():
    set_control_mode(0)
    send_asdu(2, 21, {"X": 0.1, "Y": 0, "Z": 0, "Roll": 0, "Pitch": 0, "Yaw": -turn_speed})
    print("▶ TURN RIGHT")

def stop_robot():
    send_asdu(2, 21, {"X": 0, "Y": 0, "Yaw": 0})
    print("▶ STOP")

def set_slow():
    global current_speed, turn_speed
    current_speed = 0.3
    turn_speed = 0.3
    print("▶ SPEED = SLOW")

def set_normal():
    global current_speed, turn_speed
    current_speed = 0.6
    turn_speed = 0.6
    print("▶ SPEED = NORMAL")

def set_fast():
    global current_speed, turn_speed
    current_speed = 1.0
    turn_speed = 1.0
    print("▶ SPEED = FAST")

def set_wake():
    send_asdu(1101, 6, {"Sleep": False, "Auto": False, "Time": 30})

def cancel_nav():
    """현재 네비게이션 취소 (Type=1004, Command=1)"""
    send_asdu(1004, 1, {})
    print("[NAV] 네비게이션 취소 전송")

def send_nav_command(idx, x, y, yaw):
    # 모드 리셋 → 새 명령 전송 
    set_control_mode(0)
    time.sleep(0.3)

    asdu = {
        "PatrolDevice": {
            "Type": 1003,
            "Command": 1,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {
                "Value": idx,
                "MapID": 0,
                "PosX": x,
                "PosY": y,
                "PosZ": 0.0,
                "AngleYaw": yaw,
                "PointInfo": 2,
                "Gait": 0x3002,
                "Speed": 0,
                "Manner": 0,
                "ObsMode": 0,
                "NavMode": 1
            }
        }
    }

    asdu_bytes = json.dumps(asdu).encode()
    asdu_len = len(asdu_bytes)

    header = struct.pack(
        "<4BHHB7B",
        0xEB, 0x91, 0xEB, 0x90,
        asdu_len,
        idx,
        0x01,
        *(0x00,) * 7
    )

    packet = header + asdu_bytes
    sock.sendto(packet, (ROBOT_IP, ROBOT_PORT))

    print(f"[NAV] Send WP{idx} → X:{x}, Y:{y}, Yaw:{yaw}")


def get_mapping_data(action):
    """relay_map.py에 로컬 UDP로 매핑 데이터 요청"""
    try:
        mapping_sock.sendto(
            json.dumps({"action": action}).encode("utf-8"),
            ("127.0.0.1", MAPPING_LOCAL_PORT)
        )
        data, _ = mapping_sock.recvfrom(65535)
        return data
    except socket.timeout:
        return b'{}'
    except Exception as e:
        print(f"[MAPPING ERR] {e}")
        return b'{}'


hold_move = True

def hold_motion(func, duration=1.0, interval=0.1):
    global hold_move
    hold_move = True

    t = time.time()
    while time.time() - t < duration and hold_move:
        func()
        time.sleep(interval)
    stop_robot()


_flash_state = {"Front": 0, "Back": 0}

def set_flash(pos, status):
    key = "Front" if pos == "front" else "Back"
    _flash_state[key] = 1 if status == "on" else 0
    send_asdu(1101, 2, dict(_flash_state))
    print(f"▶ flash {_flash_state}")


# ============================================================
# 보행(gait) 전환 — relay_motion.py 경유 ROS2 /GAIT 발행
# ============================================================
# Standard 모드 보행 (수동 원격 제어). Agile(0x300X)은 네비 주행용으로 별도.
GAIT_BASIC = 0x1001          # 기본 (서서 이동)
GAIT_HIGH_OBSTACLE = 0x1002  # 고장애물
GAIT_STAIR = 0x1003          # 계단
GAIT_POSTURE = 0xF001        # 자세

def send_motion_cmd(cmd, value):
    """relay_motion.py(127.0.0.1:50003)로 보행/상태 전환 명령 전달."""
    payload = json.dumps({"cmd": cmd, "value": int(value)}).encode("utf-8")
    motion_sock.sendto(payload, ("127.0.0.1", MOTION_RELAY_PORT))
    print(f"[MOTION] → relay_motion: cmd={cmd}, value=0x{int(value):04x}")



# ============================================================
# PC → 로봇 UDP 명령 수신 쓰레드
# ============================================================
def robot_sniff_loop():
    """로봇(30000)에서 오는 모든 패킷을 수신하여 로깅 (디버그용)"""
    sniff_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sniff_sock.bind(("0.0.0.0", 30002))
    sniff_sock.settimeout(1.0)
    print("🔍 [SNIFF] 로봇 응답 모니터 시작 (port 30002)")

    while True:
        try:
            data, addr = sniff_sock.recvfrom(8192)
            try:
                msg = json.loads(data.decode("utf-8"))
            except:
                msg = json.loads(data[16:].decode("utf-8"))
            pd = msg.get("PatrolDevice", {})
            t = pd.get("Type")
            c = pd.get("Command")
            print(f"🔍 [SNIFF] from {addr} | Type={t}, Command={c} | {json.dumps(msg, ensure_ascii=False)[:200]}")
            if t == 2101:
                print(f"🎯 [SNIFF] ★ INIT_POSE 응답 감지! Items={pd.get('Items', {})}")
        except socket.timeout:
            continue
        except Exception as e:
            print(f"[SNIFF ERR] {e}")


# ============================================================
# UDP 수신 핸들러 (멀티스레드)
#
# - FAST: 즉시 응답해야 하는 폴링/빠른 명령 → 메인 loop에서 직접 처리
# - SLOW: hold_motion / wait_stand_ready / NAV ASDU / INIT_POSE 등
#         수백 ms~수 초 block 하는 명령 → 워커 스레드에 위임
#         (하나의 느린 명령이 폴링 응답을 막지 않도록 함)
# ============================================================

_FAST_RESPONSE_ACTIONS = {
    "POSITION", "STATUS", "NAV_STATUS",
    "MAPPING_ODOM", "MAPPING_CLOUD", "MAPPING_ALIGNED",
    "STOP", "CANCEL_NAV", "SLOW", "NORMAL", "FAST", "WAKE",
    "FRONTON", "FRONTOFF", "REARON", "REAROFF",
    "GAIT_BASIC", "GAIT_HIGH_OBSTACLE", "GAIT_STAIR", "GAIT_POSTURE",
    "POSTURE",
}

_SLOW_CMD_ACTIONS = {
    "UP", "DOWN", "LEFT", "RIGHT", "LEFTTURN", "RIGHTTURN",
    "STAND", "SIT", "NAV", "INIT_POSE",
}

_cmd_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="cmd-worker")


def _handle_fast(action, msg, addr):
    """메인 loop에서 직접 호출 — 모두 1ms 내 처리되어야 함."""
    if action == "POSITION":
        server_sock.sendto(json.dumps(latest_position).encode("utf-8"), addr)
    elif action == "STATUS":
        server_sock.sendto(json.dumps({
            "BatteryStatus": latest_battery,
            "ChargeStatus": latest_charge_state,
            "DeviceTemperature": latest_device_temp,
            "BasicStatus": latest_basic_status,
            "MotionInfo": latest_motion_info,
            "AbnormalStatus": latest_abnormal_status,
        }).encode("utf-8"), addr)
    elif action == "NAV_STATUS":
        # 절대 timestamp 대신, receiver의 monotonic 시계로 계산한 경과시간(age)을 실어 보낸다.
        # 백엔드는 이 age만 보고 stale을 판정하므로 서버-로봇 간 시계 오프셋의 영향을 받지 않는다.
        payload = dict(latest_nav_status)
        mono = latest_nav_status.get("mono", 0.0)
        payload["age"] = (time.monotonic() - mono) if mono > 0 else None
        server_sock.sendto(json.dumps(payload).encode("utf-8"), addr)
    elif action == "MAPPING_ODOM":
        server_sock.sendto(get_mapping_data("MAPPING_ODOM"), addr)
    elif action == "MAPPING_CLOUD":
        server_sock.sendto(get_mapping_data("MAPPING_CLOUD"), addr)
    elif action == "MAPPING_ALIGNED":
        server_sock.sendto(get_mapping_data("MAPPING_ALIGNED"), addr)
    elif action == "STOP": stop_robot()
    elif action == "CANCEL_NAV": cancel_nav()
    elif action == "SLOW": set_slow()
    elif action == "NORMAL": set_normal()
    elif action == "FAST": set_fast()
    elif action == "WAKE": set_wake()
    elif action == "FRONTON": set_flash("front", "on")
    elif action == "FRONTOFF": set_flash("front", "off")
    elif action == "REARON": set_flash("rear", "on")
    elif action == "REAROFF": set_flash("rear", "off")
    elif action == "GAIT_BASIC": send_motion_cmd("gait", GAIT_BASIC)
    elif action == "GAIT_HIGH_OBSTACLE": send_motion_cmd("gait", GAIT_HIGH_OBSTACLE)
    elif action == "GAIT_STAIR": send_motion_cmd("gait", GAIT_STAIR)
    elif action == "GAIT_POSTURE": send_motion_cmd("gait", GAIT_POSTURE)
    elif action == "POSTURE":
        # 자세 6축 setpoint — Type 2/21 (Regular 모드 전용). 값 [-1,1] = 최대 기울기 비율.
        # 자세(0xf001) gait 진입 후 사용. 셋포인트라 바뀔 때만 보내면 로봇이 유지한다.
        items = {k: float(msg.get(k, 0.0)) for k in ("X", "Y", "Z", "Roll", "Pitch", "Yaw")}
        send_asdu(2, 21, items)


def _handle_nav(msg, addr):
    """NAV 명령 — send_nav_command 내부에 sleep(0.3) 있음."""
    idx = msg.get("idx", 1)
    x = msg.get("x", 0.0)
    y = msg.get("y", 0.0)
    yaw = msg.get("yaw", 0.0)
    print(f"[RECV NAV] idx={idx}, x={x}, y={y}, yaw={yaw}")
    send_nav_command(int(idx), float(x), float(y), float(yaw))
    ack = json.dumps({"ack": True, "idx": int(idx)}).encode("utf-8")
    server_sock.sendto(ack, addr)


def _handle_init_pose(msg, addr):
    """INIT_POSE — 로봇 응답 대기 최대 3초."""
    init_items = msg.get("items", {"PosX": 3.635, "PosY": 0.144, "PosZ": 0.0, "Yaw": -0.042})
    print(f"🔧 [INIT_POSE] receiver 경유 수신: {init_items}")
    init_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    init_sock.settimeout(3.0)
    try:
        asdu = {
            "PatrolDevice": {
                "Type": 2101,
                "Command": 1,
                "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "Items": init_items
            }
        }
        asdu_bytes = json.dumps(asdu).encode("utf-8")
        asdu_len = len(asdu_bytes)
        header = struct.pack(
            "<4BHHB7B",
            0xEB, 0x91, 0xEB, 0x90,
            asdu_len, 1, 0x01,
            *(0x00,) * 7
        )
        packet = header + asdu_bytes
        init_sock.sendto(packet, (ROBOT_IP, ROBOT_PORT))
        print(f"🔧 [INIT_POSE] 로봇에 전송 완료 ({len(packet)} bytes)")
        resp_data, resp_addr = init_sock.recvfrom(4096)
        try:
            resp = json.loads(resp_data.decode("utf-8"))
        except:
            resp = json.loads(resp_data[16:].decode("utf-8"))
        print(f"✅ [INIT_POSE] 로봇 응답: {resp} (from {resp_addr})")
        server_sock.sendto(json.dumps({"status": "ok", "response": resp}).encode("utf-8"), addr)
    except socket.timeout:
        print("⚠️ [INIT_POSE] 로봇 응답 타임아웃 (3초)")
        server_sock.sendto(json.dumps({"status": "timeout"}).encode("utf-8"), addr)
    except Exception as e:
        print(f"❌ [INIT_POSE] 에러: {e}")
        server_sock.sendto(json.dumps({"status": "error", "msg": str(e)}).encode("utf-8"), addr)
    finally:
        init_sock.close()


def _handle_slow(action, msg, addr):
    """워커 스레드에서 실행 — hold_motion / wait_stand_ready / ASDU 송신 등 block 작업."""
    try:
        if action == "UP": hold_motion(move_forward, duration=1.0)
        elif action == "DOWN": hold_motion(move_backward, duration=1.0)
        elif action == "LEFT": hold_motion(move_left, duration=1.5, interval=0.0001)
        elif action == "RIGHT": hold_motion(move_right, duration=1.5, interval=0.0001)
        elif action == "LEFTTURN": hold_motion(turn_left, duration=0.5)
        elif action == "RIGHTTURN": hold_motion(turn_right, duration=0.5)
        elif action == "STAND": stand_robot()
        elif action == "SIT": sit_robot()
        elif action == "NAV": _handle_nav(msg, addr)
        elif action == "INIT_POSE": _handle_init_pose(msg, addr)
    except Exception as e:
        print(f"[SLOW CMD ERR] action={action}: {e}")


def udp_receiver_loop():
    print(f"PC 명령 수신 대기중... (UDP:{SERVER_UDP_PORT})")

    while True:
        try:
            data, addr = server_sock.recvfrom(4096)
            msg = json.loads(data.decode("utf-8"))
            action = msg.get("action")

            print(f"수신: {action}")

            if action in _FAST_RESPONSE_ACTIONS:
                _handle_fast(action, msg, addr)
            elif action in _SLOW_CMD_ACTIONS:
                # 워커 풀에 위임 — 메인 loop은 즉시 다음 패킷 수신으로 복귀
                _cmd_executor.submit(_handle_slow, action, msg, addr)
            else:
                print(f"[UNKNOWN ACTION] {action}")

        except socket.timeout:
            continue
        except Exception as e:
            print("[UDP Receiver Error]", e)



# ============================================================
# 실행 시작
# ============================================================
threading.Thread(target=battery_poll_loop, daemon=True).start()
threading.Thread(target=position_poll_loop, daemon=True).start()
threading.Thread(target=nav_poll_loop, daemon=True).start()
threading.Thread(target=charge_status_listener, daemon=True).start()
threading.Thread(target=motion_info_listener, daemon=True).start()
threading.Thread(target=udp_receiver_loop, daemon=True).start()
threading.Thread(target=robot_sniff_loop, daemon=True).start()

print("✅ 로봇 제어 시스템 실행 중...")
while True:
    time.sleep(1)
