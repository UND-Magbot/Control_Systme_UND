"""카메라 MJPEG 스트리밍 엔드포인트.

클라이언트 disconnect 감지와 최대 스트림 지속시간(MAX_STREAM_DURATION)을
적용해, Chromium의 multipart/x-mixed-replace pending-close 버그로 인한
좀비 연결 누적을 서버 쪽에서 끊어낸다. 클라이언트는 onError 핸들러로
자동 재연결.
"""

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

import cv2
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.database.database import SessionLocal
from app.database.models import RobotModule, RobotInfo

router = APIRouter()

# 한 연결의 최대 지속 시간. 이 시간이 지나면 서버가 스스로 generator를
# 종료하고 Connection: close 헤더와 함께 소켓을 닫아 브라우저의 stale
# 연결 풀에서 확실히 제거되도록 한다. 클라이언트는 onError로 즉시 재연결.
MAX_STREAM_DURATION = 30.0
READ_TIMEOUT_SEC = 5.0


async def _rtsp_to_mjpeg(rtsp_url: str, request: Request):
    """MJPEG 스트림 제너레이터.

    OpenCV VideoCapture(FFmpeg 백엔드)는 반드시 **동일 스레드**에서 open/read/release
    되어야 한다. 서로 다른 스레드에서 접근하면 FFmpeg의 frame threading이
    `pthread_frame.c: Assertion fctx->async_lock failed` 로 터진다. 그래서
    스트림당 전용 단일 스레드 Executor를 만들어 모든 cv2 호출을 같은
    스레드에 고정시킨다.
    """
    loop = asyncio.get_running_loop()
    # 스트림당 1개 워커 스레드 — cv2 호출은 전부 이 스레드에서만 실행됨
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mjpeg")

    def _open():
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        try:
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, int(READ_TIMEOUT_SEC * 1000))
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, int(READ_TIMEOUT_SEC * 1000))
        except Exception:
            pass
        return cap

    def _read(cap):
        return cap.read()

    def _release(cap):
        try:
            cap.release()
        except Exception:
            pass

    cap = await loop.run_in_executor(executor, _open)
    start = time.time()
    try:
        if not cap.isOpened():
            return
        while True:
            # 클라이언트 disconnect 감지
            if await request.is_disconnected():
                break
            # 최대 지속시간 초과 시 정상 종료 → 클라이언트 재연결 유도
            if time.time() - start > MAX_STREAM_DURATION:
                break
            # cv2.read는 전용 단일 스레드에서 실행 (동일 스레드 보장)
            ret, frame = await loop.run_in_executor(executor, _read, cap)
            if not ret or frame is None:
                break
            ok, jpeg = cv2.imencode(".jpg", frame)
            if not ok:
                continue
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                + jpeg.tobytes()
                + b"\r\n"
            )
    except (GeneratorExit, asyncio.CancelledError):
        pass
    finally:
        try:
            await loop.run_in_executor(executor, _release, cap)
        except Exception:
            pass
        executor.shutdown(wait=False)


@router.get("/Video/{module_id}")
async def stream_camera(module_id: int, request: Request):
    from app.robot_io.sender import send_to_robot

    db = SessionLocal()
    try:
        module = db.query(RobotModule).filter(RobotModule.id == module_id).first()
        if not module or module.ModuleType != "camera" or not module.camera_info:
            return StreamingResponse(iter([]), media_type="text/plain", status_code=404)

        ci = module.camera_info
        if ci.StreamType != "rtsp":
            return StreamingResponse(iter([]), media_type="text/plain", status_code=400)

        robot = db.query(RobotInfo).filter(RobotInfo.id == module.RobotId).first()
        ip = ci.CameraIP or (robot.RobotIP if robot else None)
        if not ip:
            return StreamingResponse(iter([]), media_type="text/plain", status_code=404)

        url = f"rtsp://{ip}:{ci.Port}{ci.Path}"
    finally:
        db.close()

    send_to_robot("WAKE")
    await asyncio.sleep(1)

    return StreamingResponse(
        _rtsp_to_mjpeg(url, request),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            # 스트림 종료 시 TCP 소켓을 keep-alive 풀에 반환하지 않고 완전 종료
            # → 브라우저가 stale 연결을 확실히 정리
            "Connection": "close",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )
