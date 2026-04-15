"""카메라 MJPEG 스트리밍 엔드포인트"""

import time

import cv2
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.database.database import SessionLocal
from app.database.models import RobotModule, RobotInfo

router = APIRouter()


def _rtsp_to_mjpeg(rtsp_url: str):
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
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


@router.get("/Video/{module_id}")
def stream_camera(module_id: int):
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
    time.sleep(1)

    return StreamingResponse(
        _rtsp_to_mjpeg(url),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )
