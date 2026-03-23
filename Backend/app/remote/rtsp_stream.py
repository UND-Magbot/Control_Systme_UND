# app/rtsp_stream.py
import cv2
from fastapi import APIRouter, Response

router = APIRouter()

# RTSP 주소
FRONT_CAM = "rtsp://10.21.31.103:8554/video1"
REAR_CAM  = "rtsp://10.21.31.103:8554/video2"


def stream_generator(rtsp_url):
    cap = cv2.VideoCapture(rtsp_url)

    if not cap.isOpened():
        print("⚠️ RTSP 연결 실패:", rtsp_url)
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            continue
        
        # JPEG로 인코딩
        _, jpeg = cv2.imencode('.jpg', frame)
        frame_bytes = jpeg.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
        )


@router.get("/stream/front")
def front_camera():
    return Response(stream_generator(FRONT_CAM),
                    media_type="multipart/x-mixed-replace; boundary=frame")


@router.get("/stream/rear")
def rear_camera():
    return Response(stream_generator(REAR_CAM),
                    media_type="multipart/x-mixed-replace; boundary=frame")
