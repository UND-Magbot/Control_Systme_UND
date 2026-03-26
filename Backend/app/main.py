from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.remote.Remote_pad import pad as robot_remotePad
from app.remote.Remote_mode import mode as robot_remoteMode
from app.remote.rtsp_stream import router as rtsp_router
from app.navigation.save_point import point as nav_point
from app.navigation.send_move import move as nav_move
from app.Database.DatabaseFunction import database as database_function
from app.map.map_manage import map_manage as map_manage_router
from app.map.mapping_control import mapping_ctrl as mapping_ctrl_router
from app.map.ws_mapping import ws_mapping as ws_mapping_router, start_udp_server
from app.Database.database import engine, Base
from app.Database.models import BusinessInfo, AreaInfo, RobotMapInfo
from app.robot_sender import send_to_robot
from app.navigation.send_move import (
    navigation_send_next, navigation_resend_current,
    is_nav_active, get_current_target, get_nav_sent_time, check_and_clear_reset_flag,
    current_wp_index, waypoints_list, nav_loop_remaining
)

import os
import time
import threading
import socket
import json
import struct
import cv2


app = FastAPI(title="Control API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api")
def root():
    return {"msg": "FastAPI 서버가 정상적으로 실행 중입니다!"}

app.include_router(robot_remotePad)
app.include_router(robot_remoteMode)
app.include_router(rtsp_router, prefix="/camera")
app.include_router(nav_point)
app.include_router(nav_move)
app.include_router(database_function)
app.include_router(map_manage_router)
app.include_router(mapping_ctrl_router)
app.include_router(ws_mapping_router)


# ======================================================
# MJPEG
# ======================================================
def rtsp_to_mjpeg(rtsp_url):
    cap = cv2.VideoCapture(rtsp_url)
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        _, jpeg = cv2.imencode(".jpg", frame)
        yield (
            b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
            + jpeg.tobytes()
            + b"\r\n"
        )

@app.get("/Video/{cam_id}")
def stream_camera(cam_id: int):
    send_to_robot("WAKE")
    time.sleep(1)

    url = None
    if cam_id == 1:
        url = "rtsp://10.21.31.103:8554/video1"
    elif cam_id == 2:
        url = "rtsp://10.21.31.103:8554/video2"

    return StreamingResponse(
        rtsp_to_mjpeg(url),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


# ======================================================
# 전역 데이터 저장
# ======================================================
robot_position = {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}
robot_status = {"battery": {}}
robot_nav = {"arrived": False, "last_state": None, "timestamp": 0}


# ======================================================
# 로봇 통신 설정
# ======================================================
ROBOT_IP = "10.21.31.103"
ROBOT_PORT = 30000

PC_PORT_POS = 35000
PC_PORT_STATUS = 35001
PC_PORT_NAV = 35002

REQ_INTERVAL_POS = 2.0
REQ_INTERVAL_HB = 1.0


# ======================================================
# 패킷 생성
# ======================================================
def build_packet(asdu_dict):
    payload = json.dumps(asdu_dict).encode()
    length = len(payload)
    header = struct.pack(
        "<4BHHB7B",
        0xEB, 0x91, 0xEB, 0x90,
        length,
        1,
        0x01,
        *(0x00,) * 7
    )
    return header + payload


# ======================================================
# 🔥 위치 단발 요청 (웨이포인트 저장용)
# ======================================================
def get_robot_position_once(timeout=1.0):

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)

    # 위치 요청
    req = {
        "PatrolDevice": {
            "Type": 1007,
            "Command": 2,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {}
        }
    }

    sock.sendto(build_packet(req), (ROBOT_IP, ROBOT_PORT))

    try:
        data, addr = sock.recvfrom(4096)

        try:
            msg = json.loads(data.decode())
        except:
            msg = json.loads(data[16:].decode())

        pd = msg.get("PatrolDevice", {})
        if pd.get("Type") == 1007 and pd.get("Command") == 2:
            items = pd.get("Items", {})
            print(items)

            return {
                "x": items.get("PosX", 0.0),
                "y": items.get("PosY", 0.0),
                "yaw": items.get("Yaw", 0.0),
                "timestamp": time.time()
            }

    except Exception as e:
        print("[ERR GET_POS_ONCE]", e)

    return None


# ======================================================
# 초기 Pose 설정
# ======================================================
INIT_POSE = {"PosX": 3.635, "PosY": 0.144, "PosZ": 0.0, "Yaw": -0.042}

def send_init_pose():
    asdu = {
        "PatrolDevice": {
            "Type": 2101,
            "Command": 1,
            "Time": "2023-01-01 00:00:00",
            "Items": INIT_POSE
        }
    }

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
    sock.close()

    print("🚀 초기 위치 설정 전송 완료:", INIT_POSE)


@app.on_event("startup")
def startup_event():
    # 테이블 자동 생성
    Base.metadata.create_all(bind=engine)
    # 맵핑 TCP 수신 서버 시작
    start_udp_server()
    time.sleep(2)
    #send_init_pose()  


# ======================================================
# 위치(Pull)
# ==========================a============================
def request_position(sock):
    asdu = {
        "PatrolDevice": {
            "Type": 1007,
            "Command": 2,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {}
        }
    }
    sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))


RECEIVER_IP = "10.21.31.106"
RECEIVER_PORT = 40000

def position_thread():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(2.0)

    print(f"📡 위치 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    while True:
        try:
            msg = json.dumps({"action": "POSITION"}).encode("utf-8")
            sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))

            data, addr = sock.recvfrom(4096)
            pos = json.loads(data.decode("utf-8"))

            if pos.get("timestamp", 0) > 0:
                robot_position["x"] = pos["x"]
                robot_position["y"] = pos["y"]
                robot_position["yaw"] = pos["yaw"]
                robot_position["timestamp"] = pos["timestamp"]

        except socket.timeout:
            pass
        except Exception as e:
            print("[ERR POS]", e)

        time.sleep(REQ_INTERVAL_POS)


# ======================================================
# 상태 Thread
# ======================================================
def send_heartbeat(sock):
    asdu = {
        "PatrolDevice": {
            "Type": 100,
            "Command": 100,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {}
        }
    }
    sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))


def status_thread():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", PC_PORT_STATUS))
    sock.settimeout(0.5)

    print(f"📡 상태 Listener 시작 (PORT={PC_PORT_STATUS})")

    last_hb = 0
    while True:
        if time.time() - last_hb > 1:
            send_heartbeat(sock)
            last_hb = time.time()

        try:
            data, addr = sock.recvfrom(8192)

            try:
                msg = json.loads(data.decode())
            except:
                msg = json.loads(data[16:].decode())

            pd = msg["PatrolDevice"]

            if pd["Type"] == 1002 and pd["Command"] == 5:
                robot_status["battery"] = pd["Items"].get("BatteryStatus", {})
                robot_status["timestamp"] = time.time()

        except socket.timeout:
            pass
        except Exception as e:
            print("[ERR STATUS]", e)


# ======================================================
# Navigation Thread
# ======================================================
def request_navigation(sock):
    asdu = {
        "PatrolDevice": {
            "Type": 1007,
            "Command": 1,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {}
        }
    }
    sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))


ARRIVAL_COOLDOWN = 1.5
NAV_POLL_INTERVAL = 1.0
NAV_RETRY_TIMEOUT = 30.0   # 전송 후 N초 내 이동 시작 안 하면 재전송
NAV_MAX_RETRIES = 3        # 최대 재전송 횟수
ARRIVAL_CONFIRM_COUNT = 3  # status==0 연속 N회 확인 후 도착 판정 (오판 방지)

def nav_thread():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(1.5)

    global robot_nav
    last_status = None
    ever_moved = False      # 현재 WP에서 이동(!=0)을 한 번이라도 감지했는지
    zero_count = 0          # status==0 연속 카운트
    retry_count = 0

    print(f"📡 네비 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    while True:
        arrived = False

        # ── 리셋 신호 감지 (새 주행 시작 / 정지 / 다음 WP 전송 시) ──
        if check_and_clear_reset_flag():
            last_status = None
            ever_moved = False
            zero_count = 0
            retry_count = 0
            print("[NAV] 상태 리셋 (last_status=None)")

        # ── 상태 기반 도착 감지 ──
        try:
            msg = json.dumps({"action": "NAV_STATUS"}).encode("utf-8")
            sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))

            data, addr = sock.recvfrom(4096)
            nav = json.loads(data.decode("utf-8"))

            status = nav.get("status")
            nav_ts = nav.get("timestamp", 0)

            # stale 데이터 무시 (5초 이상 오래된 데이터)
            if nav_ts > 0 and (time.time() - nav_ts) > 5.0:
                if is_nav_active():
                    print(f"[NAV DEBUG] stale 데이터 무시 (age={time.time() - nav_ts:.1f}s)")
                time.sleep(NAV_POLL_INTERVAL)
                continue

            if is_nav_active():
                sent_time = get_nav_sent_time()
                cooldown_ok = sent_time > 0 and (time.time() - sent_time) > ARRIVAL_COOLDOWN
                elapsed = time.time() - sent_time if sent_time > 0 else 0
                print(f"[NAV DEBUG] status={status}, last={last_status}, cooldown={cooldown_ok}, moved={ever_moved}, zero={zero_count}/{ARRIVAL_CONFIRM_COUNT}, elapsed={elapsed:.1f}s")

            if status is not None:
                if last_status != status:
                    print(f"🔄 NAV 상태 변화: {last_status} → {status}")

                # 이동 감지 (한 번이라도 non-zero면 기록)
                if status != 0:
                    ever_moved = True
                    zero_count = 0
                else:
                    zero_count += 1

                sent_time = get_nav_sent_time()
                cooldown_ok = sent_time > 0 and (time.time() - sent_time) > ARRIVAL_COOLDOWN

                # 도착 판정: 이동한 적 있고, 연속 N회 status==0 확인
                if (ever_moved and zero_count >= ARRIVAL_CONFIRM_COUNT
                        and is_nav_active() and cooldown_ok):
                    arrived = True
                    print(f"🎉 NAV 도착! (상태 기반: 연속 {zero_count}회 status==0 확인)")

                # 재전송: 전송 후 N초 지났는데 이동을 한 번도 안 했으면 명령 재전송
                if (is_nav_active() and not ever_moved
                        and sent_time > 0
                        and (time.time() - sent_time) > NAV_RETRY_TIMEOUT
                        and retry_count < NAV_MAX_RETRIES):
                    retry_count += 1
                    print(f"⚠️ NAV 재전송 시도 ({retry_count}/{NAV_MAX_RETRIES}) — {NAV_RETRY_TIMEOUT}초 내 이동 미감지")
                    try:
                        navigation_resend_current()
                    except Exception as e:
                        print(f"[ERR] 재전송 실패: {e}")

                robot_nav["last_state"] = status
                robot_nav["timestamp"] = time.time()
                last_status = status

        except socket.timeout:
            if is_nav_active():
                print("[NAV DEBUG] NAV_STATUS 응답 타임아웃")
        except Exception as e:
            print("[ERR NAV]", e)

        if arrived and is_nav_active():
            robot_nav["arrived"] = True
            try:
                navigation_send_next()
            except Exception as e:
                print(f"[ERR] navigation_send_next 실패: {e}")

        time.sleep(NAV_POLL_INTERVAL)


# ======================================================
# Thread 시작
# ======================================================
threading.Thread(target=position_thread, daemon=True).start()
threading.Thread(target=status_thread, daemon=True).start()
threading.Thread(target=nav_thread, daemon=True).start()


# ======================================================
# API
# ======================================================
@app.get("/robot/position")
def get_pos():
    return robot_position

@app.post("/robot/initpose")
def init_pose():
    send_init_pose()
    return {"status": "ok", "msg": f"초기 위치 설정 완료: {INIT_POSE}"}

@app.get("/robot/status")
def get_status():
    return robot_status

@app.get("/robot/nav")
def get_nav():
    from app.navigation.send_move import is_navigating, current_wp_index, waypoints_list, nav_loop_remaining
    return {
        "is_navigating": is_navigating,
        "current_wp": current_wp_index,
        "total_wp": len(waypoints_list),
        "loop_remaining": nav_loop_remaining,
    }


# ======================================================
# Static (React UI)
# ======================================================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

OUT_DIR = os.path.join(BASE_DIR, "out")
if os.path.isdir(OUT_DIR):
    app.mount("/", StaticFiles(directory=OUT_DIR, html=True), name="ui")
