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

from app.robot_io.config import RECEIVER_IP, RECEIVER_PORT

ws_mapping = APIRouter()

ROBOT_IP = RECEIVER_IP
ROBOT_UDP_PORT = RECEIVER_PORT

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
    """로봇 receiver.py에 매핑 데이터 요청.

    소켓은 반드시 finally에서 닫는다. 과거에는 close()가 성공 경로에만 있어
    타임아웃/예외 시 소켓 FD가 누수되어, 0.5초 폴링 중 잦은 타임아웃이
    'Too many open files'로 확대될 수 있었다(M-1).
    """
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.0)
        sock.sendto(
            json.dumps({"action": action}).encode("utf-8"),
            (ROBOT_IP, ROBOT_UDP_PORT)
        )
        data, _ = sock.recvfrom(65535)
        raw = data.decode("utf-8")
        if raw and raw != "{}":
            return raw
        return None
    except Exception:
        return None
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass


def polling_loop():
    """로봇에 주기적으로 매핑 데이터 요청"""
    print(f"[LISTEN] 매핑 폴링 시작 → {ROBOT_IP}:{ROBOT_UDP_PORT}")

    last_cloud_time = 0
    idle_cycles = 0          # 응답이 하나도 없었던 연속 사이클 수 (백오프용)
    BASE_SLEEP = 0.5
    MAX_SLEEP = 3.0

    while _polling:
        now = time.time()
        got_any = False

        # ODOM 폴링 (0.5초 간격)
        odom = request_mapping_data("MAPPING_ODOM")
        if odom:
            latest_data["odom"] = odom
            broadcast(odom)
            got_any = True

        # ALIGNED 폴링 (0.5초 간격, 점진적 맵 구성)
        aligned = request_mapping_data("MAPPING_ALIGNED")
        if aligned:
            latest_data["aligned"] = aligned
            broadcast(aligned)
            got_any = True

        # CLOUD 폴링 (5초 간격, 전체 누적 맵)
        if now - last_cloud_time >= 5.0:
            cloud = request_mapping_data("MAPPING_CLOUD")
            if cloud:
                latest_data["cloud"] = cloud
                broadcast(cloud)
                last_cloud_time = now
                got_any = True

        # 적응형 백오프 (C-2): 로봇이 응답하지 않는 동안에는 0.5초 폭주 폴링 대신
        # 점진적으로 주기를 늘려(최대 3초) 무응답 구간의 불필요한 UDP 요청을 줄인다.
        # 응답이 하나라도 오면 즉시 0.5초로 복귀한다.
        if got_any:
            idle_cycles = 0
            sleep_s = BASE_SLEEP
        else:
            idle_cycles += 1
            sleep_s = min(BASE_SLEEP * (2 ** min(idle_cycles, 3)), MAX_SLEEP)

        time.sleep(sleep_s)

    print("[LISTEN] 매핑 폴링 종료")


def _on_send_done(fut):
    """전송 코루틴의 예외를 회수한다(M-7).

    run_coroutine_threadsafe가 돌려준 Future를 방치하면 send 실패가 조용히 사라지고
    'Future exception was never retrieved' 경고가 쌓인다. 결과를 회수해 예외를
    소비한다. 끊긴 뷰어는 ws_view의 finally에서 정리되므로 여기선 무시한다.
    """
    try:
        fut.result()
    except Exception:
        pass


def broadcast(raw: str):
    """모든 WebSocket 뷰어에 전송"""
    with viewers_lock:
        disconnected = []
        for viewer in viewers:
            try:
                fut = asyncio.run_coroutine_threadsafe(
                    viewer.send_text(raw), _loop
                )
                fut.add_done_callback(_on_send_done)
            except Exception:
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
