"""
맵핑 실시간 시각화 중계
───────────────────────
서버 → 로봇(receiver.py) 폴링 → Frontend (WebSocket)

- MAPPING_ODOM: 로봇 위치 (0.5초 간격)
- MAPPING_CLOUD: 포인트 클라우드 맵 (2초 간격)
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json
import socket
import threading
import asyncio
import time

ws_mapping = APIRouter()

ROBOT_IP = "10.21.31.106"
ROBOT_UDP_PORT = 40000

viewers: list[WebSocket] = []
viewers_lock = threading.Lock()

latest_data = {
    "odom": None,
    "cloud": None,
    "aligned": None,
}

_loop: asyncio.AbstractEventLoop = None
_polling = False


def request_mapping_data(action: str) -> str | None:
    """로봇 receiver.py에 매핑 데이터 요청"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.0)
        sock.sendto(
            json.dumps({"action": action}).encode("utf-8"),
            (ROBOT_IP, ROBOT_UDP_PORT)
        )
        data, _ = sock.recvfrom(65535)
        sock.close()
        raw = data.decode("utf-8")
        if raw and raw != "{}":
            return raw
        return None
    except Exception as e:
        return None


def polling_loop():
    """로봇에 주기적으로 매핑 데이터 요청"""
    print(f"📡 매핑 폴링 시작 → {ROBOT_IP}:{ROBOT_UDP_PORT}")

    last_cloud_time = 0

    while _polling:
        now = time.time()

        # ODOM 폴링 (0.5초 간격)
        odom = request_mapping_data("MAPPING_ODOM")
        if odom:
            latest_data["odom"] = odom
            broadcast(odom)

        # ALIGNED 폴링 (0.5초 간격, 점진적 맵 구성)
        aligned = request_mapping_data("MAPPING_ALIGNED")
        if aligned:
            latest_data["aligned"] = aligned
            broadcast(aligned)

        # CLOUD 폴링 (5초 간격, 전체 누적 맵)
        if now - last_cloud_time >= 5.0:
            cloud = request_mapping_data("MAPPING_CLOUD")
            if cloud:
                latest_data["cloud"] = cloud
                broadcast(cloud)
                last_cloud_time = now

        time.sleep(0.5)

    print("📡 매핑 폴링 종료")


def broadcast(raw: str):
    """모든 WebSocket 뷰어에 전송"""
    with viewers_lock:
        disconnected = []
        for viewer in viewers:
            try:
                asyncio.run_coroutine_threadsafe(
                    viewer.send_text(raw), _loop
                )
            except:
                disconnected.append(viewer)
        for v in disconnected:
            viewers.remove(v)


def start_polling():
    """폴링 스레드 시작"""
    global _polling
    if _polling:
        return
    _polling = True
    t = threading.Thread(target=polling_loop, daemon=True)
    t.start()


def stop_polling():
    """폴링 중지"""
    global _polling
    _polling = False


def start_udp_server():
    """이벤트 루프 저장 (main.py에서 호출)"""
    global _loop
    _loop = asyncio.get_event_loop()


@ws_mapping.websocket("/ws/mapping/view")
async def ws_view(ws: WebSocket):
    await ws.accept()
    with viewers_lock:
        viewers.append(ws)
    print(f"🖥️ 뷰어 WebSocket 연결됨 (총 {len(viewers)}명)")

    # 첫 뷰어 접속 시 폴링 시작
    start_polling()

    try:
        for key in ("odom", "cloud", "aligned"):
            if latest_data[key]:
                await ws.send_text(latest_data[key])

        while True:
            await ws.receive_text()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ERR] 뷰어 WS: {e}")
    finally:
        with viewers_lock:
            if ws in viewers:
                viewers.remove(ws)
        print(f"🖥️ 뷰어 WebSocket 해제 (총 {len(viewers)}명)")

        # 뷰어가 없으면 폴링 중지
        with viewers_lock:
            if len(viewers) == 0:
                stop_polling()
