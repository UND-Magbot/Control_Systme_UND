#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import socket
import json
import struct
import time
import threading

ROBOT_IP = "10.21.31.103"
ROBOT_PORT = 30000

# PC가 UDP 명령 받을 포트
SERVER_UDP_PORT = 40000

# relay_map.py 로컬 통신 포트
MAPPING_LOCAL_PORT = 50000
mapping_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
mapping_sock.settimeout(1.0)

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
latest_nav_status = {"status": None, "timestamp": 0}

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
                        "timestamp": time.time()
                    }
        except socket.timeout:
            pass
        except Exception as e:
            print("[NAV POLL ERR]", e)

        time.sleep(1)


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
current_speed = 5.0
turn_speed = 1.0

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
    current_speed = 0.35
    turn_speed = 20
    print("▶ SPEED = SLOW")

def set_normal():
    global current_speed, turn_speed
    current_speed = 0.55
    turn_speed = 35
    print("▶ SPEED = NORMAL")

def set_fast():
    global current_speed, turn_speed
    current_speed = 1.0
    turn_speed = 45
    print("▶ SPEED = FAST")

def set_wake():
    send_asdu(1101, 6, {"Sleep": False, "Auto": False, "Time": 30})

def cancel_nav():
    """현재 네비게이션 취소 (Type=1004, Command=1)"""
    send_asdu(1004, 1, {})
    print("[NAV] 네비게이션 취소 전송")

def send_nav_command(idx, x, y, yaw):
    # 이전 네비게이션 취소 → 모드 리셋 → 새 명령 전송
    cancel_nav()
    time.sleep(0.3)
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
                "PointInfo": 1,
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


def set_flash(pos,status):
    print("in")
    print(pos)
    print(status)
    if pos == "front":
        if status == "on":
          send_asdu(1101, 2, {"Front": 1, "Back": 0 })
          print("▶ frontflash on")
        else :
          send_asdu(1101, 2, {"Front": 0, "Back": 0 })
          print("▶ frontflash off")

    else :
        if status == "on":
          send_asdu(1101, 2, {"Front": 0, "Back": 1 })
          print("▶ rearflash on")
        else :
          send_asdu(1101, 2, {"Front": 0, "Back": 0 })
          print("▶ nearflash off")



# ============================================================
# PC → 로봇 UDP 명령 수신 쓰레드
# ============================================================
def udp_receiver_loop():
    print(f"PC 명령 수신 대기중... (UDP:{SERVER_UDP_PORT})")

    while True:
        try:
            data, addr = server_sock.recvfrom(4096)
            msg = json.loads(data.decode("utf-8"))
            action = msg.get("action")

            print(f"수신: {action}")

            # 액션 매핑
            if action == "POSITION":
                server_sock.sendto(json.dumps(latest_position).encode("utf-8"), addr)

            elif action == "NAV_STATUS":
                server_sock.sendto(json.dumps(latest_nav_status).encode("utf-8"), addr)

            elif action == "MAPPING_ODOM":
                server_sock.sendto(get_mapping_data("MAPPING_ODOM"), addr)
            elif action == "MAPPING_CLOUD":
                server_sock.sendto(get_mapping_data("MAPPING_CLOUD"), addr)
            elif action == "MAPPING_ALIGNED":
                server_sock.sendto(get_mapping_data("MAPPING_ALIGNED"), addr)

            elif action == "UP": hold_motion(move_forward, duration=1.0)
            elif action == "DOWN": hold_motion(move_backward, duration=1.0)
            elif action == "LEFT": hold_motion(move_left, duration = 1.5, interval = 0.0001)
            elif action == "RIGHT":hold_motion(move_right, duration = 1.5, interval = 0.0001)
            elif action == "LEFTTURN": hold_motion(turn_left, duration=0.5)
            elif action == "RIGHTTURN": hold_motion(turn_right, duration=0.5)
            elif action == "STOP": stop_robot()
            elif action == "STAND": stand_robot()
            elif action == "SIT": sit_robot()
            elif action == "SLOW": set_slow()
            elif action == "NORMAL": set_normal()
            elif action == "FAST": set_fast()
            elif action == "WAKE": set_wake()
            elif action == "FRONTON" : set_flash("front","on")
            elif action == "FRONTOFF" : set_flash("front","off")
            elif action == "REARON" : set_flash("rear","on")
            elif action == "REAROFF" : set_flash("rear","off")
            elif action == "NAV":
                idx = msg.get("idx", 1)
                x = msg.get("x", 0.0)
                y = msg.get("y", 0.0)
                yaw = msg.get("yaw", 0.0)

                print(f"[RECV NAV] idx={idx}, x={x}, y={y}, yaw={yaw}")
                f_x = float(x)
                f_y = float(y)
                f_yaw = float(yaw)
                i_idx = int(idx)

                send_nav_command(i_idx, f_x, f_y, f_yaw)

                # ACK 응답 → Backend
                ack = json.dumps({"ack": True, "idx": i_idx}).encode("utf-8")
                server_sock.sendto(ack, addr)

        except socket.timeout:
            continue
        except Exception as e:
            print("[UDP Receiver Error]", e)



# ============================================================
# 실행 시작
# ============================================================
threading.Thread(target=position_poll_loop, daemon=True).start()
threading.Thread(target=nav_poll_loop, daemon=True).start()
threading.Thread(target=udp_receiver_loop, daemon=True).start()

print("✅ 로봇 제어 시스템 실행 중...")
while True:
    time.sleep(1)
