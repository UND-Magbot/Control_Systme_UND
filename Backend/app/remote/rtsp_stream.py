# app/rtsp_stream.py
import os
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
import cv2
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.logs.service import log_event
from app.current_user import get_robot_id, get_robot_name

router = APIRouter()

# RTSP 주소
FRONT_CAM = "rtsp://10.21.31.103:8554/video1"
REAR_CAM  = "rtsp://10.21.31.103:8554/video2"

# URL → 카메라 식별명 매핑
CAM_NAMES = {
    FRONT_CAM: "전방 카메라",
    REAR_CAM: "후방 카메라",
}


def stream_generator(rtsp_url):
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

    if not cap.isOpened():
        cam_name = CAM_NAMES.get(rtsp_url, "카메라")
        print(f"[WARN] RTSP 연결 실패: {cam_name} ({rtsp_url})")
        log_event("error", "rtsp_error",
                  f"카메라 영상 연결 실패 ({cam_name})",
                  error_json=f'{{"rtsp_url": "{rtsp_url}"}}',
                  robot_id=get_robot_id(), robot_name=get_robot_name())
        cap.release()
        return

    fail_count = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                fail_count += 1
                if fail_count >= 30:
                    print(f"[WARN] RTSP 프레임 연속 실패, 종료: {rtsp_url}")
                    break
                continue
            fail_count = 0

            ok, jpeg = cv2.imencode('.jpg', frame)
            if not ok:
                continue
            frame_bytes = jpeg.tobytes()

            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
            )
    except GeneratorExit:
        print(f"[INFO] RTSP 클라이언트 연결 종료: {rtsp_url}")
    finally:
        cap.release()


@router.get("/stream/front")
def front_camera():
    return StreamingResponse(stream_generator(FRONT_CAM),
                             media_type="multipart/x-mixed-replace; boundary=frame")


@router.get("/stream/rear")
def rear_camera():
    return StreamingResponse(stream_generator(REAR_CAM),
                             media_type="multipart/x-mixed-replace; boundary=frame")
