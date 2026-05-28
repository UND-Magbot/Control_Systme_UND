"""
열화상 카메라 + 얼굴 검출 기반 체온 측정 오버레이
- RTSP 실시간 영상(열화상 메인 ch201, 1280x960)
- ISAPI 픽셀별 온도 데이터(256x192 float32)
- yolov8n-face로 얼굴 검출 → 각 얼굴 박스 내부 최고 온도(℃) 표시
- HTTP MJPEG으로 재송출(포트 8554) → 관제 프론트엔드가 <img src>로 임베드

사용법:
  python3 thermal_max_overlay.py              # RTSP 오버레이 (기본, 권장)
  python3 thermal_max_overlay.py --rtsp [port]
  python3 thermal_max_overlay.py --snapshot   # 단일 캡처 저장 (테스트용)
  python3 thermal_max_overlay.py --realtime   # ISAPI 단독 (GUI 필요)

필요 패키지:
  pip install ultralytics opencv-python numpy requests urllib3

필요 모델 파일 (스크립트와 동일 폴더 또는 환경변수 경로):
  yolov8n-face.pt    (FACE_MODEL_PATH)     — 얼굴 검출
  yolov8n.pt         (PERSON_MODEL_PATH)   — 사람 검출/트래킹
  yolov8n-custom.pt  (HOT_PACK_MODEL_PATH) — hot-pack 검출 (thermal-detection01 학습)
"""

import os
import sys
import time
import threading

# FFmpeg(OpenCV의 RTSP 백엔드) 입력 지연 최소화 — 보수적 조합.
# cv2 import보다 먼저 설정해야 FFmpeg 백엔드 초기화 시 옵션이 적용된다.
#   rtsp_transport=tcp : UDP보다 안정적, 패킷 손실로 인한 디코딩 에러(HEVC POC 등) 감소
#   flags=low_delay    : H.264/H.265 디코더 저지연 모드 (디코딩 자체는 정상 유지)
# (fflags=nobuffer / reorder_queue_size=0 / max_delay=0 은 디코더 입력을 너무 공격적으로
#  잘라서 프레임 손실이 생길 수 있어 제외. 추가 lag 감소는 BUFFERSIZE=1과 RTSPGrabber
#  쪽에서 처리한다.)
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|flags;low_delay",
)

import requests
from requests.auth import HTTPDigestAuth
import numpy as np
import cv2
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# === 카메라 설정 ===
CAMERA_IP = "10.21.31.108"
CAMERA_PORT = 443
CAMERA_USER = "admin"
CAMERA_PASS = "und12!!!"

# 열화상 메인 채널 (1280x960)을 사용 — yolov8n-face가 얼굴을 잡을 수 있는 해상도
RTSP_CHANNEL = "201"

# 픽셀별 온도 배열 크기 (ISAPI 응답)
THERMAL_WIDTH = 256
THERMAL_HEIGHT = 192
BYTES_PER_PIXEL = 4  # float32

# === 처리 주기 ===
TEMP_UPDATE_INTERVAL = 1.0     # ISAPI 온도 갱신 주기 (초)
FACE_DETECT_MIN_INTERVAL = 0.5 # 얼굴 검출 최소 주기 (초). aarch64 CPU에서는 0.5~1.0 권장.

# YOLO 객체 인식(얼굴/사람/hot-pack)을 매 프레임이 아니라 N프레임마다 실행한다.
# 값이 클수록 CPU 부담↓·송출 지연↓ (그 사이 프레임은 추적기/직전 박스로 보간).
# min_interval 은 추가 안전 하한으로 그대로 유지된다.
# 15→25→30 상향: NOS aarch64에서 셋 동시 burst 시 메인 producer가 0~2 FPS까지 떨어져
# 사실상 멈추는 문제 → burst 빈도를 더 줄임. person/face는 KCF로 매 프레임 보간되므로
# 검출 사이 박스 정지 문제 없음. 검출 지연은 약 2.5초 (출력 12 FPS 기준).
DETECT_INTERVAL_FRAMES = 10
# hot-pack 추론은 face/person 트리거의 N배 주기로 실행해 burst 무게를 분산.
# 핫팩은 짧은 시간에 사라지지 않고 알람 hold가 3초라 측정 주기 늘려도 영향 적음.
HOTPACK_DETECT_INTERVAL_MULTIPLIER = 2

# === 얼굴 검출 설정 ===
FACE_MODEL_PATH = os.environ.get(
    "FACE_MODEL_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "yolov8n-face.pt"),
)
FACE_CONF_THRESHOLD = 0.18      # 0.15→0.25는 thermal+person crop+작은 imgsz 조합에서 검출 0건
                                # 발생 → 0.18로 절충. 1m 근거리 confidence 0.10~0.20 범위에서 통과.
                                # 옷/어깨 false positive는 거리 보정과 person 매칭으로 자연 컷.
FACE_DETECT_IMGSZ = 320         # 256은 학습 분포(800)와 너무 멀어 confidence 저하 → 320 복구.

# face 추론을 전체 프레임이 아닌 person 박스 crop에서만 수행하기 위한 마진.
# person 박스가 머리 윗부분이나 이마를 살짝 자르는 경우가 있어 위쪽을 더 넉넉히 둠.
# 또한 person 박스 안에서 letterbox되면 face가 학습 분포(얼굴이 프레임의 1/3~)에
# 가깝게 보여 근거리 검출률도 함께 개선된다.
FACE_FROM_PERSON_X_MARGIN = 0.05
FACE_FROM_PERSON_Y_MARGIN = 0.10

# === 사람 검출/트래킹 설정 ===
PERSON_MODEL_PATH = os.environ.get(
    "PERSON_MODEL_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "yolov8n.pt"),
)
PERSON_CONF_THRESHOLD = 0.35
PERSON_DETECT_IMGSZ = 320      # 256은 person 검출 안정성 저하 → face crop도 부정확 → 연쇄로 face 검출 실패.
                               # 320으로 복구 (416 대비 비용 약 60%, 검출 안정성 유지).
PERSON_DETECT_MIN_INTERVAL = 0.5
# BGR 색상 — 측정 진행 단계별
PERSON_BOX_UNMEASURED = (0, 240, 240)  # 노랑 — 아직 측정 안 됨
COLOR_NORMAL = (40, 200, 40)           # 초록 — 정상
COLOR_WATCH  = (0, 140, 240)           # 주황 — 경계
COLOR_FEVER  = (40, 40, 230)           # 빨강 — 발열 의심

# === Hot-pack 검출 설정 (yolov8n-custom.pt — thermal-detection01 학습) ===
# 단일 클래스 'hot-pack'. 학습 이미지가 960x720(=OUT 해상도)이므로 동일 해상도 입력에 잘 맞음.
HOT_PACK_MODEL_PATH = os.environ.get(
    "HOT_PACK_MODEL_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "yolov8n-custom.pt"),
)
HOT_PACK_CONF_THRESHOLD = 0.65
HOT_PACK_DETECT_IMGSZ = 256    # 416→320→256: NOS aarch64 burst 추가 완화. 단일 추론 비용 416 대비 약 40%.
HOT_PACK_DETECT_MIN_INTERVAL = 0.5
# 박스 크기·종횡비 필터 — 노트북/디스플레이류(매우 큰 직사각형) 및 비정상 박스 거부.
# 학습 데이터의 hot-pack 실제 크기 분포(프레임 면적 대비)에 맞춰 max를 좁힘.
# 5% 초과 박스는 hot-pack 보다 큰 사물(가구·기기·포스터 등) 오탐일 가능성이 높음.
HOT_PACK_AREA_RATIO_MIN = 0.01
HOT_PACK_AREA_RATIO_MAX = 0.05
HOT_PACK_ASPECT_MIN = 0.4
HOT_PACK_ASPECT_MAX = 2.5
# 온도 범위 필터 — hot-pack 정상 작동 온도대만 통과.
# 사람 체온(~36°C)·실온 발열 사물(전자기기 30~33°C)·식어가는 핫팩(~40°C)까지
# 모두 컷하기 위해 42°C 임계 채택. 실제 핫팩 정상 작동 표면은 보통 45~55°C라
# false positive 최소화 효과가 크다.
# 트레이드오프: 충분히 식은 핫팩(<42°C)은 미검출 — 운영상 의도된 절충.
HOT_PACK_TEMP_MIN = 42.0
HOT_PACK_TEMP_MAX = 55.0
# === 고온 알람(45°C+) 임계 ===
# 검출 표시(42°C+)와 별개로 위험 임계(45°C+) 도달 시 백엔드에 알람 송신.
# 단일 프레임 스파이크/추적 일시 어긋남으로 인한 false positive 방지를 위해
# 3초 지속 확인 후 발화 (1초였을 때 단발 노이즈로 모달이 뜨는 사례가 있어 상향).
# 같은 영역 중복 알람 방지를 위해 30초 cooldown.
HOT_PACK_ALERT_TEMP_MIN = 45.0
HOT_PACK_ALERT_HOLD_SECONDS = 3.0
HOT_PACK_ALERT_COOLDOWN_SECONDS = 30.0
# 백엔드 base URL — 환경변수로 NOS 배포 환경에 맞춰 주입.
# 기본값은 관제 PC WiFi 게이트웨이 가정 (사내 네트워크).
BACKEND_BASE = os.environ.get("BACKEND_BASE", "http://10.21.41.133:8010")
# 알람 송신 시 함께 보낼 로봇 식별자 (Alert 필터링·표시용)
ROBOT_NAME = os.environ.get("ROBOT_NAME", "CA9B_NO.669_5G")
# 얼굴 박스 내부 포함률 임계 — hot-pack 박스의 이 비율 이상이 얼굴 박스에 들어가면
# 얼굴 옆모습을 hot-pack으로 오탐한 것으로 보고 거부.
# 사람 전신 박스는 제외 — 사람이 hot-pack을 들고 있을 때 같이 거부되는 부작용 방지.
HOT_PACK_FACE_CONTAINMENT_MAX = 0.5
# 사람 발열 시 사용하는 빨간색과 동일 — 시각적 일관성
HOT_PACK_BOX_COLOR = (40, 40, 230)  # = COLOR_FEVER (BGR)

# === 사람 측정 누적 ===
PERSON_STALE_SECONDS = 10.0     # 이만큼 안 보이면 레지스트리에서 제거

# 측정값 유효 범위 — 이 밖은 노이즈로 간주하고 락 후보에서 제외
TEMP_LOCK_MIN = 34.0
TEMP_LOCK_MAX = 39.5
# 락 정책: 첫 측정값이 아니라 최근 N개 유효 측정값의 max로 락.
# 사람이 짧게라도 머무르는 동안 박스가 안정되고 핫스팟(이마 중앙)이 잡히는 순간을
# 잡아내기 위함. max를 쓰는 이유는 그 순간이 코어 체온에 가장 가깝기 때문.
TEMP_LOCK_SAMPLE_N = 3

# Skin → core 추정 보정 (industry-standard fever-screening 표시 보정)
# 이마 피부온은 코어 체온보다 약 0.8~1.5°C 낮음 → 표시값에 일괄 더해 추정 체온으로 변환.
# Hikvision/FLIR 등 상용 카메라의 "Body Temperature Mode"가 동일 원리를 펌웨어에서 적용.
# 발열 임계도 이 보정된 값 기준으로 잡혀있음. ISAPI에서 emissivity/distance 보정한 후
# 실측값 분포를 보고 이 값 미세조정 가능.
TEMP_DISPLAY_OFFSET = 0

# === 거리 기반 raw 측정값 보정 ===
# Hikvision thermal은 거리가 가까울수록 측정값이 과대로 나오는 시스템적 경향이 있다.
# 사용자 측정 데이터 (정상 체온 기준, display_temp 결과):
#   1m: 36.4°C (offset -3.5 적용, OK)
#   2m: 37.5°C → 1.0°C 과대 (offset -1.0 부족) → -2.0 으로 강화
#   3m: 36.5°C (offset 0, OK)
#   4m: 36.3°C (offset 0, OK)
#   5m: 35.9°C (offset 0, 약간 낮음 — 작은 face 박스 한계, 보정으로 메우지 않음)
# 거리는 face 박스 너비(px)로 추정. 1m에서의 박스 너비를 K로 두고 d = K / width.
# K는 카메라 FOV와 OUT 해상도에 의존 → 환경변수로 운영 캘리브레이션 가능.
# 운영 시 1m 거리에서 face 박스 너비로 K 조정 (FACE_DISTANCE_SHOW=1 로 화면에 표시 가능).
FACE_DISTANCE_K = float(os.environ.get("FACE_DISTANCE_K", "247"))  # 1m 거리 실측 캘리브레이션 (w=247px)
# 거리(m)별 offset 정의 — 사이는 선형 보간
FACE_DISTANCE_OFFSET_TABLE = [
    (1.0, -3.5),
    (2.0, -2.0),
    (3.0,  0.0),
]
# 추정 거리 표시 (디버그용 — K 캘리브레이션 시 도움)
FACE_DISTANCE_SHOW = os.environ.get("FACE_DISTANCE_SHOW", "0") == "1"

# 보정 후 (display_temp 기준) 발열 단계 임계
FEVER_NORMAL_MAX = 37.4   # 미만 = 정상
FEVER_WATCH_MAX  = 37.8   # 미만 = 경계, 이상 = 발열
# 락 직후 박스 강조 지속 시간 (snap 효과)
LOCK_FLASH_DURATION = 0.5

# === 온도 측정 설정 ===
TEMP_SMOOTH_KSIZE = 3   # 단일 픽셀 노이즈 제거용 평균필터 크기 (홀수, 1=비활성)
# 얼굴 박스 안에서 이마 위주로 ROI 좁히기 — 머리카락·안경·턱·배경 영향 제거
TEMP_ROI_Y_START = 0.10   # 박스 상단에서부터 (0=박스 맨 위)
TEMP_ROI_Y_END   = 0.55   # 박스 상단에서부터 (이마+눈썹+눈 위 정도)
TEMP_ROI_X_INSET = 0.20   # 좌우 안쪽으로 잘라내 머리카락·귀 제외
# 피부 온도 범위 밖 픽셀은 노이즈/외부물체로 보고 통계에서 제외
TEMP_VALID_MIN = 30.0
TEMP_VALID_MAX = 40.0
# 측정 대표값: 유효 픽셀 중 상위 N개의 평균 — 단일 max보단 안정, 퍼센타일 평균보다 공격적
# (Hikvision OSD의 scene max에 더 가까운 값을 얻기 위해 N=3)
TEMP_TOP_N = 3

# === 출력 ===
# 1280×960 → 960×720으로 다운샘플링: 트래픽·CPU 인코딩 부담 약 56%로 감소
OUT_W = 960
OUT_H = 720
# 송출 프레임 율 제한 (관제 측 렉 완화). 발열 스크리닝엔 15 FPS면 충분
TARGET_OUTPUT_FPS = 60
# JPEG 품질 (85 → 70: 파일 크기 ~30% 감소, 시각 품질 차이 미미)
JPEG_QUALITY = 70


# ------------------------------------------------------------------
# ISAPI: 픽셀별 온도 데이터
# ------------------------------------------------------------------
def create_session():
    s = requests.Session()
    s.auth = HTTPDigestAuth(CAMERA_USER, CAMERA_PASS)
    s.verify = False
    # CURL_CA_BUNDLE / REQUESTS_CA_BUNDLE / HTTP(S)_PROXY 같은 환경변수가 잡혀 있으면
    # requests 가 session.verify=False 를 덮어쓰며 자체 인증서인 카메라 접속이 실패한다
    # (PostgreSQL 등 다른 도구가 CURL_CA_BUNDLE 을 등록해 둔 환경에서 흔히 발생).
    # 사내망 카메라 호출이라 환경변수 영향을 차단한다.
    s.trust_env = False
    s.timeout = 10
    return s


def ptz_zoom(session, direction: str, channel: int = 1, speed: int = 50) -> bool:
    """ISAPI Momentary PTZ 줌. direction='in'|'out'. duration=500ms 후 자동 정지."""
    if direction == "in":
        zoom = speed
    elif direction == "out":
        zoom = -speed
    else:
        return False
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<PTZData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">'
        f'<pan>0</pan><tilt>0</tilt><zoom>{zoom}</zoom>'
        '<Momentary><duration>500</duration></Momentary>'
        '</PTZData>'
    )
    url = f"https://{CAMERA_IP}:{CAMERA_PORT}/ISAPI/PTZCtrl/channels/{channel}/momentary"
    try:
        resp = session.put(
            url,
            data=xml,
            headers={"Content-Type": "application/xml"},
            timeout=5,
        )
        # Hikvision은 200을 반환하면서도 본문에 statusCode!=1로 거부할 수 있어
        # 항상 본문까지 출력해서 실제 결과를 확인.
        print(f"[PTZ] zoom {direction} ch{channel}: HTTP {resp.status_code} body={resp.text[:300]!r}")
        return resp.status_code == 200
    except Exception as e:
        print(f"[PTZ] zoom {direction} ch{channel} failed: {e}")
        return False


def fetch_temp_data(session):
    """ISAPI에서 픽셀별 온도 배열만 가져오기. Returns: (192, 256) float32, ℃"""
    url = (f"https://{CAMERA_IP}:{CAMERA_PORT}"
           f"/ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json")
    resp = session.get(url)
    resp.raise_for_status()

    parts = resp.content.split(b'--boundary')
    for part in parts:
        hdr_end = part.find(b'\r\n\r\n')
        if hdr_end < 0:
            continue
        header = part[:hdr_end]
        body = part[hdr_end + 4:]
        if b'application/octet-stream' in header:
            expected_size = THERMAL_WIDTH * THERMAL_HEIGHT * BYTES_PER_PIXEL
            if len(body) >= expected_size:
                temp = np.frombuffer(body[:expected_size], dtype=np.float32)
                return temp.reshape(THERMAL_HEIGHT, THERMAL_WIDTH)
    raise ValueError("Temperature data not found")


def fetch_thermal_frame(session):
    """JPEG + 온도 배열을 한 번에. Returns: (image_bgr, temp_array)"""
    url = (f"https://{CAMERA_IP}:{CAMERA_PORT}"
           f"/ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json")
    resp = session.get(url)
    resp.raise_for_status()

    img = None
    temp_array = None
    for part in resp.content.split(b'--boundary'):
        hdr_end = part.find(b'\r\n\r\n')
        if hdr_end < 0:
            continue
        header = part[:hdr_end]
        body = part[hdr_end + 4:]
        if b'image/pjpeg' in header or b'image/jpeg' in header:
            if body.endswith(b'\r\n'):
                body = body[:-2]
            img = cv2.imdecode(np.frombuffer(body, dtype=np.uint8), cv2.IMREAD_COLOR)
        elif b'application/octet-stream' in header:
            expected_size = THERMAL_WIDTH * THERMAL_HEIGHT * BYTES_PER_PIXEL
            if len(body) >= expected_size:
                temp_array = np.frombuffer(body[:expected_size], dtype=np.float32)
                temp_array = temp_array.reshape(THERMAL_HEIGHT, THERMAL_WIDTH)
    if img is None:
        raise ValueError("JPEG image not found")
    if temp_array is None:
        raise ValueError("Temperature data not found")
    return img, temp_array


# ------------------------------------------------------------------
# 온도 데이터 백그라운드 갱신
# ------------------------------------------------------------------
class TempDataUpdater:
    def __init__(self, interval=TEMP_UPDATE_INTERVAL):
        self.interval = interval
        self.session = create_session()
        self.lock = threading.Lock()
        self._temp_array = None
        self._running = False
        self._thread = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        for _ in range(50):
            with self.lock:
                if self._temp_array is not None:
                    return
            time.sleep(0.1)

    def stop(self):
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=3.0)

    def _loop(self):
        while self._running:
            try:
                temp = fetch_temp_data(self.session)
                with self.lock:
                    self._temp_array = temp
            except Exception as e:
                print(f"  [TempUpdater] Error: {e}")
            time.sleep(self.interval)

    def get_temp_array(self):
        with self.lock:
            return self._temp_array


# ------------------------------------------------------------------
# 얼굴 검출 백그라운드 스레드 (yolov8n-face)
# ------------------------------------------------------------------
class FaceDetector:
    """별도 스레드에서 yolov8n-face 추론 → 박스 캐시. 메인 루프는 캐시만 읽음."""

    def __init__(self, model_path=FACE_MODEL_PATH, conf=FACE_CONF_THRESHOLD,
                 min_interval=FACE_DETECT_MIN_INTERVAL):
        from ultralytics import YOLO  # 의존성: pip install ultralytics
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"얼굴 검출 모델을 찾을 수 없습니다: {model_path}\n"
                f"  yolov8n-face.pt 를 다운로드하여 위 경로에 두세요."
            )
        self.model = YOLO(model_path)
        self.conf = conf
        self.min_interval = min_interval
        self.lock = threading.Lock()
        self._latest_frame = None
        self._latest_person_boxes = None  # None=전체 프레임 추론(보조 모드), []=추론 스킵
        self._frame_seq = 0       # update_frame 호출마다 +1 (새로 공급된 프레임 식별)
        self._latest_boxes = []   # [(x1, y1, x2, y2), ...]
        self._gen = 0             # 추론 한 번 끝날 때마다 +1 (트래커 재초기화 트리거)
        self._running = False
        self._thread = None

    def update_frame(self, frame, person_boxes=None):
        with self.lock:
            self._latest_frame = frame
            self._latest_person_boxes = person_boxes
            self._frame_seq += 1

    def get_boxes(self):
        with self.lock:
            return list(self._latest_boxes)

    def get_boxes_with_gen(self):
        with self.lock:
            return self._gen, list(self._latest_boxes)

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=3.0)

    def _loop(self):
        processed_seq = -1
        while self._running:
            t0 = time.time()
            with self.lock:
                frame = self._latest_frame
                person_boxes = self._latest_person_boxes
                seq = self._frame_seq
            # 새로 공급된 프레임이 있을 때만 추론한다. 프레임 공급 자체가
            # DETECT_INTERVAL_FRAMES 마다 이뤄지므로, 결국 N프레임마다 1회 추론.
            if frame is None or seq == processed_seq:
                time.sleep(0.02)
                continue
            processed_seq = seq
            try:
                boxes = self._infer(frame, person_boxes)
                with self.lock:
                    self._latest_boxes = boxes
                    self._gen += 1
            except Exception as e:
                print(f"  [FaceDetector] Error: {e}")
            dt = time.time() - t0
            if dt < self.min_interval:
                time.sleep(self.min_interval - dt)

    def _infer(self, frame, person_boxes):
        """person 박스마다 crop해서 face 추론. 결과 좌표는 원본 프레임 좌표계로 복원.

        person_boxes 가 None 이면 전체 프레임 1회 추론 (보조 모드/--snapshot 등 호환용).
        person_boxes 가 빈 리스트면 face 추론 자체를 스킵 → 빈 결과 반환.
        (사람이 없으면 얼굴도 없다는 가정 — 배경 false positive 차단 효과도 있음.)
        """
        h, w = frame.shape[:2]
        if person_boxes is None:
            crops = [(0, 0, w, h)]
        elif not person_boxes:
            return []
        else:
            crops = []
            for (px1, py1, px2, py2) in person_boxes:
                pw = px2 - px1
                ph = py2 - py1
                if pw <= 0 or ph <= 0:
                    continue
                mx = int(pw * FACE_FROM_PERSON_X_MARGIN)
                my = int(ph * FACE_FROM_PERSON_Y_MARGIN)
                cx1 = max(0, px1 - mx)
                cy1 = max(0, py1 - my)
                cx2 = min(w, px2 + mx)
                cy2 = min(h, py2 + my)
                if cx2 - cx1 < 32 or cy2 - cy1 < 32:
                    continue
                crops.append((cx1, cy1, cx2, cy2))

        boxes = []
        for (cx1, cy1, cx2, cy2) in crops:
            crop = frame[cy1:cy2, cx1:cx2]
            results = self.model.predict(
                crop, conf=self.conf, verbose=False, imgsz=FACE_DETECT_IMGSZ,
            )
            for r in results:
                if r.boxes is None:
                    continue
                xyxy = r.boxes.xyxy.cpu().numpy()
                for b in xyxy:
                    fx1, fy1, fx2, fy2 = b[:4]
                    boxes.append((
                        int(cx1 + fx1),
                        int(cy1 + fy1),
                        int(cx1 + fx2),
                        int(cy1 + fy2),
                    ))
        return boxes


# ------------------------------------------------------------------
# 사람 검출 + ByteTrack 트래킹 (yolov8n)
# ------------------------------------------------------------------
class PersonDetector:
    """별도 스레드에서 yolov8n + ByteTrack으로 사람 검출/트래킹.

    Phase 2에서 얼굴 측정값을 ID에 귀속시키기 위한 기반.
    캐시: [(id, x1, y1, x2, y2), ...]
    """

    def __init__(self, model_path=PERSON_MODEL_PATH, conf=PERSON_CONF_THRESHOLD,
                 min_interval=PERSON_DETECT_MIN_INTERVAL):
        from ultralytics import YOLO
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"사람 검출 모델을 찾을 수 없습니다: {model_path}\n"
                f"  yolov8n.pt 를 다운로드하여 위 경로에 두세요."
            )
        self.model = YOLO(model_path)
        self.conf = conf
        self.min_interval = min_interval
        self.lock = threading.Lock()
        self._latest_frame = None
        self._frame_seq = 0       # update_frame 호출마다 +1 (새로 공급된 프레임 식별)
        self._latest_tracks = []   # [(id, x1, y1, x2, y2), ...]
        self._gen = 0
        self._running = False
        self._thread = None

    def update_frame(self, frame):
        with self.lock:
            self._latest_frame = frame
            self._frame_seq += 1

    def get_tracks(self):
        with self.lock:
            return list(self._latest_tracks)

    def get_tracks_with_gen(self):
        with self.lock:
            return self._gen, list(self._latest_tracks)

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=3.0)

    def _loop(self):
        processed_seq = -1
        while self._running:
            t0 = time.time()
            with self.lock:
                frame = self._latest_frame
                seq = self._frame_seq
            # 새로 공급된 프레임이 있을 때만 추론한다. 프레임 공급 자체가
            # DETECT_INTERVAL_FRAMES 마다 이뤄지므로, 결국 N프레임마다 1회 추론.
            if frame is None or seq == processed_seq:
                time.sleep(0.02)
                continue
            processed_seq = seq
            try:
                # persist=True: 호출 간 ByteTrack 상태 유지 → ID 안정화
                # classes=[0]: COCO에서 0번이 person
                results = self.model.track(
                    frame, persist=True, classes=[0],
                    conf=self.conf, verbose=False, imgsz=PERSON_DETECT_IMGSZ,
                )
                tracks = []
                for r in results:
                    if r.boxes is None or r.boxes.id is None:
                        continue
                    ids = r.boxes.id.int().cpu().numpy()
                    xyxy = r.boxes.xyxy.cpu().numpy()
                    for tid, b in zip(ids, xyxy):
                        x1, y1, x2, y2 = b[:4]
                        tracks.append((int(tid), int(x1), int(y1), int(x2), int(y2)))
                with self.lock:
                    self._latest_tracks = tracks
                    self._gen += 1
            except Exception as e:
                print(f"  [PersonDetector] Error: {e}")
            dt = time.time() - t0
            if dt < self.min_interval:
                time.sleep(self.min_interval - dt)


# ------------------------------------------------------------------
# Hot-pack 검출 백그라운드 스레드 (yolov8n-custom.pt)
# ------------------------------------------------------------------
class HotPackDetector:
    """별도 스레드에서 hot-pack 추론 → 박스 캐시. 메인 루프는 캐시만 읽음.

    단일 클래스(0='hot-pack')라 트래킹/ID 부여 없이 검출 결과만 누적·교체.
    """

    def __init__(self, model_path=HOT_PACK_MODEL_PATH, conf=HOT_PACK_CONF_THRESHOLD,
                 min_interval=HOT_PACK_DETECT_MIN_INTERVAL):
        from ultralytics import YOLO
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"hot-pack 검출 모델을 찾을 수 없습니다: {model_path}\n"
                f"  yolov8n-custom.pt 를 위 경로에 두거나 HOT_PACK_MODEL_PATH 환경변수를 지정하세요."
            )
        self.model = YOLO(model_path)
        self.conf = conf
        self.min_interval = min_interval
        self.lock = threading.Lock()
        self._latest_frame = None
        self._frame_seq = 0       # update_frame 호출마다 +1 (새로 공급된 프레임 식별)
        self._latest_boxes = []   # [(x1, y1, x2, y2), ...]
        self._gen = 0             # 추론 한 번 끝날 때마다 +1 (트래커 재초기화 트리거)
        self._running = False
        self._thread = None

    def update_frame(self, frame):
        with self.lock:
            self._latest_frame = frame
            self._frame_seq += 1

    def get_boxes(self):
        with self.lock:
            return list(self._latest_boxes)

    def get_boxes_with_gen(self):
        with self.lock:
            return self._gen, list(self._latest_boxes)

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=3.0)

    def _loop(self):
        processed_seq = -1
        while self._running:
            t0 = time.time()
            with self.lock:
                frame = self._latest_frame
                seq = self._frame_seq
            # 새로 공급된 프레임이 있을 때만 추론한다. 프레임 공급 자체가
            # DETECT_INTERVAL_FRAMES 마다 이뤄지므로, 결국 N프레임마다 1회 추론.
            if frame is None or seq == processed_seq:
                time.sleep(0.02)
                continue
            processed_seq = seq
            try:
                # classes=[0]: 학습된 단일 클래스 'hot-pack'만 통과 (안전망)
                results = self.model.predict(
                    frame, conf=self.conf, classes=[0], verbose=False,
                    imgsz=HOT_PACK_DETECT_IMGSZ,
                )
                H, W = frame.shape[:2]
                frame_area = float(H * W)
                boxes = []
                for r in results:
                    if r.boxes is None:
                        continue
                    xyxy = r.boxes.xyxy.cpu().numpy()
                    for b in xyxy:
                        x1, y1, x2, y2 = b[:4]
                        bw = x2 - x1
                        bh = y2 - y1
                        if bw <= 0 or bh <= 0:
                            continue
                        area_ratio = (bw * bh) / frame_area
                        if not (HOT_PACK_AREA_RATIO_MIN <= area_ratio <= HOT_PACK_AREA_RATIO_MAX):
                            continue
                        aspect = bw / bh
                        if not (HOT_PACK_ASPECT_MIN <= aspect <= HOT_PACK_ASPECT_MAX):
                            continue
                        boxes.append((int(x1), int(y1), int(x2), int(y2)))
                with self.lock:
                    self._latest_boxes = boxes
                    self._gen += 1
            except Exception as e:
                print(f"  [HotPackDetector] Error: {e}")
            dt = time.time() - t0
            if dt < self.min_interval:
                time.sleep(self.min_interval - dt)


# ------------------------------------------------------------------
# 사람 ID별 측정값 누적 레지스트리
# ------------------------------------------------------------------
class PersonRecord:
    def __init__(self, tid):
        self.tid = tid
        self.first_seen = time.time()
        self.last_seen = time.time()
        self.locked_temp = None        # 락된 raw 측정값 (offset 적용 전)
        self.locked_at = None
        self._sample_buffer = []       # 락 전 누적되는 유효 측정값 N개

    def mark_seen(self):
        self.last_seen = time.time()

    def attach_temp(self, t):
        # 이미 락됐으면 새 측정 무시 (UX: 측정값 안정성)
        if self.locked_temp is not None:
            return
        # 정상 범위 밖은 ROI 어긋남/센서 스파이크로 보고 락 후보에서 제외
        if not (TEMP_LOCK_MIN <= t <= TEMP_LOCK_MAX):
            return
        self._sample_buffer.append(t)
        if len(self._sample_buffer) >= TEMP_LOCK_SAMPLE_N:
            # N개 중 max → 가장 따뜻한(=핫스팟이 이마 중앙에 잘 맞은) 순간 = 코어에 가장 가까움
            self.locked_temp = max(self._sample_buffer)
            self.locked_at = time.time()
            self._sample_buffer = []

    @property
    def is_measured(self):
        return self.locked_temp is not None

    @property
    def display_temp(self):
        """표시·임계 판정용 — 피부온에 industry-standard skin→core 보정 더한 추정 체온."""
        if self.locked_temp is None:
            return None
        return self.locked_temp + TEMP_DISPLAY_OFFSET

    @property
    def status_text(self):
        t = self.display_temp
        if t is None:
            return "MEASURING"
        if t < FEVER_NORMAL_MAX:
            return "OK"
        if t < FEVER_WATCH_MAX:
            return "WATCH"
        return "FEVER"

    @property
    def status_color(self):
        t = self.display_temp
        if t is None:
            return PERSON_BOX_UNMEASURED
        if t < FEVER_NORMAL_MAX:
            return COLOR_NORMAL
        if t < FEVER_WATCH_MAX:
            return COLOR_WATCH
        return COLOR_FEVER

    @property
    def is_flashing(self):
        return (self.locked_at is not None
                and (time.time() - self.locked_at) < LOCK_FLASH_DURATION)


class PersonRegistry:
    def __init__(self, stale_seconds=PERSON_STALE_SECONDS):
        self._records = {}
        self._stale_seconds = stale_seconds

    def touch(self, tid):
        rec = self._records.get(tid)
        if rec is None:
            rec = PersonRecord(tid)
            self._records[tid] = rec
        rec.mark_seen()
        return rec

    def attach_temp(self, tid, temp):
        rec = self._records.get(tid)
        if rec is not None:
            rec.attach_temp(temp)

    def get(self, tid):
        return self._records.get(tid)

    def cleanup_stale(self):
        now = time.time()
        for tid in [t for t, r in self._records.items()
                    if now - r.last_seen > self._stale_seconds]:
            del self._records[tid]


# ------------------------------------------------------------------
# 박스 트래커 (YOLO 검출 사이 프레임에서도 박스가 얼굴을 따라가게)
# ------------------------------------------------------------------
def _create_kcf_tracker():
    """KCF 트래커 생성. OpenCV 빌드별 위치 차이를 흡수."""
    if hasattr(cv2, "TrackerKCF_create"):
        return cv2.TrackerKCF_create()
    if hasattr(cv2, "legacy") and hasattr(cv2.legacy, "TrackerKCF_create"):
        return cv2.legacy.TrackerKCF_create()
    raise RuntimeError(
        "KCF 트래커를 찾을 수 없습니다. opencv-contrib-python 설치가 필요할 수 있습니다."
    )


class FaceTrackerManager:
    """YOLO 검출 사이 프레임마다 KCF로 박스를 갱신해서 얼굴 움직임을 따라감.

    - reset(frame, boxes): 새 YOLO 결과가 나왔을 때 트래커 풀을 통째로 재초기화
    - update(frame): 매 프레임 호출 → 갱신된 박스 리스트. 추적 실패한 트래커는 자동 제거
    YOLO가 다음 결과를 내놓을 때까지의 시각적 lag을 줄이기 위함.
    """

    def __init__(self):
        self._trackers = []

    def reset(self, frame, boxes):
        new_trackers = []
        for (x1, y1, x2, y2) in boxes:
            w = max(1, int(x2 - x1))
            h = max(1, int(y2 - y1))
            try:
                tr = _create_kcf_tracker()
                tr.init(frame, (int(x1), int(y1), w, h))
                new_trackers.append(tr)
            except Exception as e:
                print(f"  [Tracker] init error: {e}")
        self._trackers = new_trackers

    def update(self, frame):
        boxes = []
        kept = []
        for tr in self._trackers:
            try:
                ok, bbox = tr.update(frame)
            except Exception:
                ok = False
                bbox = None
            if not ok:
                continue
            x, y, w, h = bbox
            boxes.append((int(x), int(y), int(x + w), int(y + h)))
            kept.append(tr)
        self._trackers = kept
        return boxes


class PersonTrackerManager:
    """ByteTrack 추론 사이 프레임마다 KCF로 person 박스를 갱신하고 ID도 평행 유지.

    PersonDetector는 추론 주기마다만 결과를 내놓아 그 사이 박스가 정지 → 사람이
    움직일 때 박스가 따라가지 못한다. FaceTrackerManager와 동일 패턴이지만,
    person은 ID가 측정값 귀속에 필수라 KCF 풀에 ID를 함께 들고 다닌다.

    - reset(frame, tracks): 새 ByteTrack 결과가 들어왔을 때 트래커 풀 재초기화
                            tracks = [(id, x1, y1, x2, y2), ...]
    - update(frame): 매 프레임 호출 → [(id, x1, y1, x2, y2), ...]
                     추적 실패한 트래커는 자동 제거 (대응 ID도 함께 드롭).
    """

    def __init__(self):
        self._trackers = []  # [(tid, tracker), ...]

    def reset(self, frame, tracks):
        new_trackers = []
        for (tid, x1, y1, x2, y2) in tracks:
            w = max(1, int(x2 - x1))
            h = max(1, int(y2 - y1))
            try:
                tr = _create_kcf_tracker()
                tr.init(frame, (int(x1), int(y1), w, h))
                new_trackers.append((int(tid), tr))
            except Exception as e:
                print(f"  [PersonTracker] init error: {e}")
        self._trackers = new_trackers

    def update(self, frame):
        out = []
        kept = []
        for (tid, tr) in self._trackers:
            try:
                ok, bbox = tr.update(frame)
            except Exception:
                ok = False
                bbox = None
            if not ok:
                continue
            x, y, w, h = bbox
            out.append((tid, int(x), int(y), int(x + w), int(y + h)))
            kept.append((tid, tr))
        self._trackers = kept
        return out


# ------------------------------------------------------------------
# 오버레이 그리기
# ------------------------------------------------------------------
GREEN = (0, 255, 0)
BLACK = (0, 0, 0)


def estimate_face_distance(face_w_px):
    """face 박스 너비(px)로 거리(m) 추정. d = K / w (얼굴 너비 일정 + 핀홀 모델 근사).

    K (FACE_DISTANCE_K) = 1m에서의 face 박스 너비(px). 카메라 FOV와 OUT 해상도에 따라
    다르므로 환경변수로 캘리브레이션. 너비 0 이하면 None.
    """
    if face_w_px is None or face_w_px <= 0:
        return None
    return FACE_DISTANCE_K / face_w_px


def get_face_distance_offset(distance_m):
    """거리(m)별 raw 측정값 보정 offset. FACE_DISTANCE_OFFSET_TABLE 선형 보간.

    표 밖 가까운 거리 → 첫 entry offset 그대로 (extrapolate 안 함, 보수적).
    표 밖 먼 거리 → 0 (보정 불필요 영역).
    """
    if distance_m is None:
        return 0.0
    table = FACE_DISTANCE_OFFSET_TABLE
    if distance_m <= table[0][0]:
        return table[0][1]
    if distance_m >= table[-1][0]:
        return 0.0
    for i in range(len(table) - 1):
        d0, o0 = table[i]
        d1, o1 = table[i + 1]
        if d0 <= distance_m <= d1:
            ratio = (distance_m - d0) / (d1 - d0)
            return o0 + (o1 - o0) * ratio
    return 0.0


def compute_face_temps(face_boxes, temp_array, img_shape):
    """얼굴 박스마다 이마 ROI에서 95퍼센타일 평균 온도와 핫스팟 좌표를 계산.

    그리지 않고 측정만. 반환값은 face_boxes와 평행한 리스트:
      [{'box': (x1,y1,x2,y2), 'temp': float|None, 'hot_spot': (x,y)|None,
        'distance_m': float|None}, ...]
    유효 픽셀 0개면 단일 max 픽셀 fallback (기존 동작 유지).
    temp 에는 거리 기반 보정(get_face_distance_offset)이 이미 적용된 raw 값이 들어간다.
    """
    img_h, img_w = img_shape[:2]
    if temp_array is None or not face_boxes:
        return []

    sx_t = THERMAL_WIDTH / img_w
    sy_t = THERMAL_HEIGHT / img_h
    sx_f = img_w / THERMAL_WIDTH
    sy_f = img_h / THERMAL_HEIGHT

    out = []
    for (x1, y1, x2, y2) in face_boxes:
        x1 = max(0, min(img_w - 1, x1))
        y1 = max(0, min(img_h - 1, y1))
        x2 = max(0, min(img_w, x2))
        y2 = max(0, min(img_h, y2))
        if x2 <= x1 or y2 <= y1:
            continue

        bw = x2 - x1
        bh = y2 - y1
        # 거리 추정 (face 박스 너비 기준). 측정 후 raw temp에 offset 더함.
        distance_m = estimate_face_distance(bw)
        rx1 = int(x1 + bw * TEMP_ROI_X_INSET)
        rx2 = int(x2 - bw * TEMP_ROI_X_INSET)
        ry1 = int(y1 + bh * TEMP_ROI_Y_START)
        ry2 = int(y1 + bh * TEMP_ROI_Y_END)
        tx1 = max(0, int(rx1 * sx_t))
        ty1 = max(0, int(ry1 * sy_t))
        tx2 = min(THERMAL_WIDTH, int(np.ceil(rx2 * sx_t)))
        ty2 = min(THERMAL_HEIGHT, int(np.ceil(ry2 * sy_t)))
        if tx2 <= tx1 or ty2 <= ty1:
            out.append({'box': (x1, y1, x2, y2), 'temp': None, 'hot_spot': None,
                        'distance_m': distance_m})
            continue

        crop = temp_array[ty1:ty2, tx1:tx2].astype(np.float32)
        if (TEMP_SMOOTH_KSIZE >= 3
                and crop.shape[0] >= TEMP_SMOOTH_KSIZE
                and crop.shape[1] >= TEMP_SMOOTH_KSIZE):
            smoothed = cv2.boxFilter(
                crop, ddepth=-1,
                ksize=(TEMP_SMOOTH_KSIZE, TEMP_SMOOTH_KSIZE),
            )
        else:
            smoothed = crop

        valid_mask = (smoothed >= TEMP_VALID_MIN) & (smoothed <= TEMP_VALID_MAX)
        ys_v, xs_v = np.where(valid_mask)
        if ys_v.size > 0:
            vals = smoothed[ys_v, xs_v]
            n = min(TEMP_TOP_N, vals.size)
            top_idx = np.argpartition(vals, -n)[-n:]
            temp = float(vals[top_idx].mean())
            # 핫스팟 마커: 상위 N픽셀 위치의 중심
            mark_tx = tx1 + float(xs_v[top_idx].mean())
            mark_ty = ty1 + float(ys_v[top_idx].mean())
        else:
            local_idx = np.unravel_index(smoothed.argmax(), smoothed.shape)
            temp = float(smoothed[local_idx])
            mark_tx = tx1 + local_idx[1]
            mark_ty = ty1 + local_idx[0]

        max_x = int((mark_tx + 0.5) * sx_f)
        max_y = int((mark_ty + 0.5) * sy_f)
        # 거리 기반 보정 — 가까울수록 측정값 과대 경향 상쇄
        temp += get_face_distance_offset(distance_m)
        out.append({'box': (x1, y1, x2, y2), 'temp': temp, 'hot_spot': (max_x, max_y),
                    'distance_m': distance_m})

    return out


def match_faces_to_persons(measurements, person_tracks):
    """얼굴 중심점이 들어간 사람 박스의 ID를 매칭. 가장 작은(특정한) 사람 박스 우선.
    반환: measurements와 평행한 [tid|None, ...].

    face는 person 박스에 FACE_FROM_PERSON_*_MARGIN 마진을 더한 crop에서 추론되므로
    매칭 시에도 같은 마진을 허용한다. 안 그러면 머리 윗부분/이마 위쪽에서 잡힌 face의
    중심이 person 박스 위쪽 밖으로 살짝 빠져 매칭 실패 → 측정값 누적이 안 되는 버그.
    """
    out = []
    for m in measurements:
        x1, y1, x2, y2 = m['box']
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        best_tid = None
        best_area = float('inf')
        for (tid, px1, py1, px2, py2) in person_tracks:
            pw = px2 - px1
            ph = py2 - py1
            mx = pw * FACE_FROM_PERSON_X_MARGIN
            my = ph * FACE_FROM_PERSON_Y_MARGIN
            if (px1 - mx) <= cx <= (px2 + mx) and (py1 - my) <= cy <= (py2 + my):
                area = pw * ph
                if area < best_area:
                    best_area = area
                    best_tid = tid
        out.append(best_tid)
    return out


def draw_face_markers(frame, measurements, matched_tids):
    """얼굴별 핫스팟 십자 마커 + face 박스(얇은 사각형).

    face 박스는 검출 동작 가시화를 위해 항상 표시(얇게).
    라벨/온도는 매칭 안 된 face만 표시 — 매칭된 face는 person 박스에 ID+온도가
    표시되므로 중복 방지를 위해 라벨 생략.
    """
    if not measurements:
        return frame
    img_h, img_w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(img_w / 1280.0 * 0.7, 0.5)
    thickness = max(int(img_w / 1280.0 * 2), 2)
    face_box_thickness = max(int(img_w / 1280.0), 1)  # person 박스와 시각적 충돌 안 되게 얇게

    for m, tid in zip(measurements, matched_tids):
        x1, y1, x2, y2 = m['box']
        # face 박스 — 검출 가시화 (얇게, 항상)
        cv2.rectangle(frame, (x1, y1), (x2, y2), GREEN, face_box_thickness)
        if m.get('hot_spot') is not None:
            cv2.drawMarker(frame, m['hot_spot'], GREEN,
                           cv2.MARKER_CROSS, 18, thickness)
        # 추정 거리 표시 (디버그 — FACE_DISTANCE_K 캘리브레이션용)
        # face 박스 우상단에 작게: "w120 1.3m"
        if FACE_DISTANCE_SHOW:
            dist_label = f"w{x2 - x1}"
            d_m = m.get('distance_m')
            if d_m is not None:
                dist_label += f" {d_m:.1f}m"
            d_scale = max(img_w / 1280.0 * 0.45, 0.35)
            d_thick = max(int(img_w / 1280.0), 1)
            (dw, dh), _ = cv2.getTextSize(dist_label, font, d_scale, d_thick)
            dx = x2 - dw
            dy = y1 - 4
            if dy - dh < 0:
                dy = y1 + dh + 4
            cv2.rectangle(frame, (dx - 2, dy - dh - 2),
                          (dx + dw + 2, dy + 2), BLACK, -1)
            cv2.putText(frame, dist_label, (dx, dy), font, d_scale, GREEN, d_thick)
        if tid is not None:
            continue   # 라벨은 사람 박스 쪽에서 표시되므로 생략
        if m.get('temp') is None:
            continue
        label = f"{m['temp']:.1f}C"
        (tw, th), _ = cv2.getTextSize(label, font, font_scale, thickness)
        lx = x1
        ly = y1 - 8
        if ly - th < 0:
            ly = y2 + th + 8
        if lx + tw > img_w:
            lx = img_w - tw - 4
        cv2.rectangle(frame, (lx - 2, ly - th - 4),
                      (lx + tw + 2, ly + 4), BLACK, -1)
        cv2.putText(frame, label, (lx, ly), font, font_scale, GREEN, thickness)
    return frame


def draw_person_status(frame, tracks, registry):
    """사람 박스 + 머리 위 대형 배지로 측정 상태/온도/단계를 시각화.

    - 측정 전(락 전): 얇은 노란 박스 + 좌상단 작은 'ID N' 라벨만
    - 측정 후: 단계별 색(초록/주황/빨강) 박스 + 머리 위 대형 배지 'OK 36.7C' 등
    - 락 직후 0.5초: 박스 흰색 외곽 + 굵기 강조 (snap 효과)
    """
    if not tracks:
        return frame
    img_h, img_w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX
    base_thick = max(int(img_w / 1280.0 * 2), 2)
    badge_scale = max(img_w / 1280.0 * 0.95, 0.7)
    id_scale = max(img_w / 1280.0 * 0.5, 0.4)

    for (tid, x1, y1, x2, y2) in tracks:
        x1 = max(0, min(img_w - 1, x1))
        y1 = max(0, min(img_h - 1, y1))
        x2 = max(0, min(img_w, x2))
        y2 = max(0, min(img_h, y2))
        if x2 <= x1 or y2 <= y1:
            continue

        rec = registry.get(tid)
        if rec is None:
            continue
        color = rec.status_color
        measured = rec.is_measured

        # 락 직후 흰색 외곽으로 강조 (한 번만, 0.5초)
        if rec.is_flashing:
            cv2.rectangle(frame, (x1 - 4, y1 - 4), (x2 + 4, y2 + 4),
                          (255, 255, 255), base_thick)
            box_t = base_thick + 2
        else:
            box_t = base_thick if measured else max(base_thick - 1, 1)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, box_t)

        # 머리 위 대형 배지 (측정 완료 시에만)
        if measured:
            badge_text = f"{rec.status_text}  {rec.display_temp:.1f}C"
            (tw, th), _ = cv2.getTextSize(badge_text, font, badge_scale, base_thick)
            pad_x, pad_y = 12, 8
            bw = tw + pad_x * 2
            bh = th + pad_y * 2
            cx = (x1 + x2) // 2
            bx1 = cx - bw // 2
            by2 = y1 - 8
            by1 = by2 - bh
            if by1 < 0:
                # 화면 위로 넘치면 박스 안쪽 위에
                by1 = y1 + 4
                by2 = by1 + bh
            bx1 = max(0, min(img_w - bw, bx1))
            bx2 = bx1 + bw
            cv2.rectangle(frame, (bx1, by1), (bx2, by2), color, -1)
            cv2.rectangle(frame, (bx1, by1), (bx2, by2), (255, 255, 255), 2)
            cv2.putText(frame, badge_text, (bx1 + pad_x, by2 - pad_y),
                        font, badge_scale, (255, 255, 255),
                        base_thick, cv2.LINE_AA)

        # ID 라벨 — 박스 좌상단 안쪽 (작게)
        id_label = f"ID {tid}"
        (idw, idh), _ = cv2.getTextSize(id_label, font, id_scale, 1)
        idx = x1 + 4
        idy = y1 + idh + 6
        cv2.rectangle(frame, (idx - 3, idy - idh - 3),
                      (idx + idw + 3, idy + 3),
                      BLACK, -1)
        cv2.putText(frame, id_label, (idx, idy), font, id_scale,
                    (255, 255, 255), 1, cv2.LINE_AA)
    return frame


def compute_hotpack_temps(hot_boxes, temp_array, img_shape):
    """hot-pack 박스 내 최고 온도(℃)와 그 위치를 측정.

    바운딩박스 영역 내에서 가장 뜨거운 픽셀을 찾고, 단일 픽셀 스파이크 완화를 위해
    그 픽셀 주변 3x3 평균값을 대표 온도로 사용. 핫스팟 마커도 max 위치에 표시.
    반환: [{'box': (x1,y1,x2,y2), 'temp': float, 'center': (x,y)}, ...]
    """
    img_h, img_w = img_shape[:2]
    if temp_array is None or not hot_boxes:
        return []

    sx_t = THERMAL_WIDTH / img_w
    sy_t = THERMAL_HEIGHT / img_h
    sx_f = img_w / THERMAL_WIDTH
    sy_f = img_h / THERMAL_HEIGHT

    out = []
    for (x1, y1, x2, y2) in hot_boxes:
        x1 = max(0, min(img_w - 1, x1))
        y1 = max(0, min(img_h - 1, y1))
        x2 = max(0, min(img_w, x2))
        y2 = max(0, min(img_h, y2))
        if x2 <= x1 or y2 <= y1:
            continue

        # 영상 박스 → 열화상 좌표(박스 전체 영역)
        tx1 = max(0, min(THERMAL_WIDTH, int(np.floor(x1 * sx_t))))
        ty1 = max(0, min(THERMAL_HEIGHT, int(np.floor(y1 * sy_t))))
        tx2 = max(0, min(THERMAL_WIDTH, int(np.ceil(x2 * sx_t))))
        ty2 = max(0, min(THERMAL_HEIGHT, int(np.ceil(y2 * sy_t))))
        if tx2 <= tx1 or ty2 <= ty1:
            continue

        region = temp_array[ty1:ty2, tx1:tx2]
        if region.size == 0:
            continue
        # 박스 내 최고온 픽셀 위치
        rel_y, rel_x = np.unravel_index(int(np.argmax(region)), region.shape)
        max_tx = tx1 + int(rel_x)
        max_ty = ty1 + int(rel_y)

        # 노이즈 완화: 최고온 픽셀 주변 3x3 평균 — 단일 픽셀 스파이크 방지
        px0 = max(0, max_tx - 1)
        py0 = max(0, max_ty - 1)
        px1 = min(THERMAL_WIDTH, max_tx + 2)
        py1 = min(THERMAL_HEIGHT, max_ty + 2)
        patch = temp_array[py0:py1, px0:px1]
        temp = float(patch.mean()) if patch.size > 0 else float(temp_array[max_ty, max_tx])

        # 온도 범위 필터 — hot-pack 정상 동작 범위(HOT_PACK_TEMP_MIN~MAX) 밖이면 오탐으로 보고 거부.
        if not (HOT_PACK_TEMP_MIN <= temp <= HOT_PACK_TEMP_MAX):
            continue

        # 핫스팟 위치 → 영상 좌표 (열화상 픽셀 중심)
        hot_cx_img = (max_tx + 0.5) * sx_f
        hot_cy_img = (max_ty + 0.5) * sy_f
        out.append({
            'box': (x1, y1, x2, y2),
            'temp': temp,
            'center': (int(round(hot_cx_img)), int(round(hot_cy_img))),
        })
    return out


def filter_hotpacks_vs_faces(hot_measurements, face_boxes):
    """hot-pack 박스가 얼굴 박스에 깊이 포함되면 얼굴 옆모습 오탐으로 보고 제거.

    포함률 = (hot-pack ∩ face) / hot-pack 면적.
    이 값이 HOT_PACK_FACE_CONTAINMENT_MAX 이상이면 hot-pack에서 제외.
    사람 전신 박스는 기준에 포함하지 않음 — 사람이 hot-pack을 손에 들었을 때
    hot-pack이 사람 박스에 거의 통째로 들어가 같이 거부되는 부작용을 피하기 위함.
    """
    if not hot_measurements or not face_boxes:
        return hot_measurements

    out = []
    for m in hot_measurements:
        hx1, hy1, hx2, hy2 = m['box']
        hw = max(0, hx2 - hx1)
        hh = max(0, hy2 - hy1)
        h_area = hw * hh
        if h_area <= 0:
            continue

        max_contain = 0.0
        for (px1, py1, px2, py2) in face_boxes:
            ix1 = max(hx1, px1)
            iy1 = max(hy1, py1)
            ix2 = min(hx2, px2)
            iy2 = min(hy2, py2)
            iw = max(0, ix2 - ix1)
            ih = max(0, iy2 - iy1)
            inter = iw * ih
            if inter <= 0:
                continue
            contain = inter / h_area
            if contain > max_contain:
                max_contain = contain
                if max_contain >= HOT_PACK_FACE_CONTAINMENT_MAX:
                    break

        if max_contain < HOT_PACK_FACE_CONTAINMENT_MAX:
            out.append(m)
    return out


class HotPackAlertTracker:
    """핫팩 측정 온도가 임계 이상으로 N초 지속 시 백엔드 알람 발화.

    같은 영역(중심점 거리 PROXIMITY_PX 이내)은 같은 핫팩으로 본다.
    단일 프레임 스파이크/추적 일시 어긋남으로 인한 false positive 방지를 위해
    hold_seconds 동안 연속 측정이 유지될 때만 발화한다.
    발화 후 cooldown_seconds 동안 같은 영역에서 중복 발화를 차단해 같은 핫팩이
    계속 보이는 동안 알람 폭주를 막는다.
    """

    PROXIMITY_PX = 100  # 같은 영역 간주 거리

    def __init__(self, temp_min, hold_seconds, cooldown_seconds):
        self._temp_min = temp_min
        self._hold_seconds = hold_seconds
        self._cooldown_seconds = cooldown_seconds
        self._candidates = {}    # cid → {cx, cy, first_seen, last_seen, max_temp}
        self._next_cid = 1
        self._fired = []         # [(cx, cy, fired_at), ...]

    def update(self, measurements):
        """현재 frame의 hot-pack 측정값을 받아 발화 트리거된 항목 리스트 반환.

        반환 항목 형식: {'temperature': float, 'center': (x, y)}
        """
        now = time.time()
        # 만료된 cooldown 제거
        self._fired = [
            (cx, cy, t) for (cx, cy, t) in self._fired
            if now - t < self._cooldown_seconds
        ]

        triggered = []
        touched = set()
        for m in measurements:
            temp = m.get('temp')
            if temp is None or temp < self._temp_min:
                continue
            x1, y1, x2, y2 = m['box']
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2

            # 같은 영역에서 최근 발화한 적 있으면 skip
            in_cooldown = any(
                abs(cx - fcx) < self.PROXIMITY_PX
                and abs(cy - fcy) < self.PROXIMITY_PX
                for (fcx, fcy, _) in self._fired
            )
            if in_cooldown:
                continue

            # 기존 후보 매칭 (중심점 거리)
            cid = None
            for k, c in self._candidates.items():
                if (abs(cx - c['cx']) < self.PROXIMITY_PX
                        and abs(cy - c['cy']) < self.PROXIMITY_PX):
                    cid = k
                    break

            if cid is None:
                cid = self._next_cid
                self._next_cid += 1
                self._candidates[cid] = {
                    'cx': cx, 'cy': cy,
                    'first_seen': now, 'last_seen': now,
                    'max_temp': temp,
                }
                touched.add(cid)
                continue

            c = self._candidates[cid]
            c['cx'] = cx
            c['cy'] = cy
            c['last_seen'] = now
            c['max_temp'] = max(c['max_temp'], temp)
            touched.add(cid)

            if now - c['first_seen'] >= self._hold_seconds:
                triggered.append({
                    'temperature': c['max_temp'],
                    'center': (cx, cy),
                })
                self._fired.append((cx, cy, now))
                del self._candidates[cid]
                touched.discard(cid)

        # 이번 프레임에 안 보인 후보는 일정 시간 후 정리 (검출 누락 보강)
        for k in list(self._candidates.keys()):
            if k in touched:
                continue
            if now - self._candidates[k]['last_seen'] > 2.0:
                del self._candidates[k]

        return triggered


def _send_thermal_alert(temperature, robot_name):
    """백엔드에 고온 감지 알람 POST 송신. 별도 스레드에서 호출.

    NOS 환경에 HTTP_PROXY 가 잡혀 있으면 사내 IP 호출까지 proxy(localhost:13128 등)를
    거치다 ProxyError 가 난다. 사내망 호출이므로 proxies={"http": None, "https": None}
    로 환경변수 proxy 를 명시적으로 우회한다.
    """
    payload = {
        "temperature": float(temperature),
        "detected_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    if robot_name:
        payload["robot_name"] = robot_name
    try:
        resp = requests.post(
            f"{BACKEND_BASE}/alerts/external/thermal-event",
            json=payload, timeout=3.0,
            proxies={"http": None, "https": None},
        )
        if resp.status_code >= 400:
            print(f"  [ALERT] backend 응답 비정상: {resp.status_code} {resp.text[:120]}")
        else:
            print(f"  [ALERT] 고온 감지 송신 OK ({temperature:.1f}°C)")
    except Exception as e:
        print(f"  [ALERT] 송신 실패: {e}")


def fire_thermal_alert_async(temperature):
    """메인 루프 차단 방지 — 별도 데몬 스레드로 알람 송신."""
    threading.Thread(
        target=_send_thermal_alert,
        args=(temperature, ROBOT_NAME),
        daemon=True,
    ).start()


def draw_hotpack_overlays(frame, measurements):
    """hot-pack 빨간 박스 + 중앙 핫스팟 마커 + 'hot-pack 38.4C' 라벨."""
    if not measurements:
        return frame
    img_h, img_w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(img_w / 1280.0 * 0.7, 0.5)
    thickness = max(int(img_w / 1280.0 * 2), 2)
    color = HOT_PACK_BOX_COLOR  # 사람 발열 빨강과 동일

    for m in measurements:
        x1, y1, x2, y2 = m['box']
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)

        if m.get('center') is not None:
            cv2.drawMarker(frame, m['center'], color,
                           cv2.MARKER_CROSS, 16, thickness)

        if m.get('temp') is None:
            continue
        label = f"hot-pack {m['temp']:.1f}C"
        (tw, th), _ = cv2.getTextSize(label, font, font_scale, thickness)
        lx = x1
        ly = y1 - 8
        if ly - th < 0:
            ly = y2 + th + 8
        if lx + tw > img_w:
            lx = img_w - tw - 4
        cv2.rectangle(frame, (lx - 2, ly - th - 4),
                      (lx + tw + 2, ly + 4), BLACK, -1)
        cv2.putText(frame, label, (lx, ly), font, font_scale,
                    color, thickness, cv2.LINE_AA)
    return frame


# ------------------------------------------------------------------
# RTSP 그래버 (최신 프레임만 유지)
# ------------------------------------------------------------------
class RTSPGrabber:
    def __init__(self, url):
        self.cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.lock = threading.Lock()
        self._frame = None
        self._running = False
        self._thread = None

    @property
    def isOpened(self):
        return self.cap.isOpened()

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        # 1) read 루프 먼저 멈추고 join → 2) cv2 자원 해제
        # 순서를 지키지 않으면 cap.read()와 cap.release()가 동시 접근하여
        # FFmpeg 내부 std::terminate 발생 (Aborted/core dumped)
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=3.0)
        if self.cap is not None:
            self.cap.release()

    def _loop(self):
        while self._running:
            ret, frame = self.cap.read()
            if ret:
                with self.lock:
                    self._frame = frame

    def read(self):
        with self.lock:
            return self._frame


# ------------------------------------------------------------------
# 메인 모드: RTSP + 얼굴 검출 + 체온 오버레이 → HTTP MJPEG
# ------------------------------------------------------------------
def run_rtsp_overlay(restream_port=8556):
    from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
    from urllib.parse import urlparse, parse_qs

    rtsp_url = (f"rtsp://{CAMERA_USER}:{CAMERA_PASS}@{CAMERA_IP}:554"
                f"/ISAPI/Streaming/channels/{RTSP_CHANNEL}")
    print(f"Opening RTSP stream: {rtsp_url.replace(CAMERA_PASS, '***')}")

    # PTZ 전용 세션 — TempDataUpdater의 세션과 분리해 동시 호출 충돌 회피
    ptz_session = create_session()

    grabber = RTSPGrabber(rtsp_url)
    if not grabber.isOpened:
        print("ERROR: Failed to open RTSP stream")
        return
    grabber.start()
    time.sleep(0.5)

    print("Starting temperature data updater...")
    updater = TempDataUpdater(interval=TEMP_UPDATE_INTERVAL)
    updater.start()

    print(f"Loading face model: {FACE_MODEL_PATH}")
    detector = FaceDetector()
    detector.start()

    print(f"Loading person model: {PERSON_MODEL_PATH}")
    person_detector = PersonDetector()
    person_detector.start()

    print(f"Loading hot-pack model: {HOT_PACK_MODEL_PATH}")
    hotpack_detector = HotPackDetector()
    hotpack_detector.start()

    latest_jpeg = [None]
    jpeg_lock = threading.Lock()
    stop_event = threading.Event()

    def frame_producer():
        det_counter = 0          # 검출기 프레임 공급 주기용
        tracker_mgr = FaceTrackerManager()
        # hot-pack용 KCF 트래커 — FaceTrackerManager 내부 로직은 face 한정이 아니라
        # 일반 box 추적이므로 그대로 재사용. 검출 사이 프레임에서도 박스가 객체 따라감.
        hotpack_tracker_mgr = FaceTrackerManager()
        # person용 KCF 트래커 — ByteTrack 추론 사이에도 박스가 객체를 따라가도록
        # 매 프레임 보간. ID는 ByteTrack 결과를 그대로 들고 다님 (측정값 귀속에 필수).
        person_tracker_mgr = PersonTrackerManager()
        # 45°C+ 1초 지속 시 백엔드 알람 발화
        alert_tracker = HotPackAlertTracker(
            temp_min=HOT_PACK_ALERT_TEMP_MIN,
            hold_seconds=HOT_PACK_ALERT_HOLD_SECONDS,
            cooldown_seconds=HOT_PACK_ALERT_COOLDOWN_SECONDS,
        )
        registry = PersonRegistry()
        last_seen_gen = -1
        last_hotpack_gen = -1
        last_person_gen = -1
        frame_period = 1.0 / TARGET_OUTPUT_FPS
        loop_start = time.time()
        while not stop_event.is_set():
            raw = grabber.read()
            if raw is None:
                time.sleep(0.01)
                continue
            frame = cv2.resize(raw, (OUT_W, OUT_H), interpolation=cv2.INTER_LINEAR)

            # person 박스 KCF 보간 — ByteTrack 추론 결과는 DETECT_INTERVAL_FRAMES
            # 주기로만 갱신되므로 사이 프레임에서 박스가 정지하지 않도록 매 iter
            # KCF로 객체 움직임을 따라간다. 새 추론 결과(gen 변경)가 나오면 트래커 풀
            # 재초기화 (ID는 ByteTrack 결과를 그대로 들고 다님).
            p_gen, p_tracks_raw = person_detector.get_tracks_with_gen()
            if p_gen != last_person_gen:
                person_tracker_mgr.reset(frame, p_tracks_raw)
                last_person_gen = p_gen
            tracks = person_tracker_mgr.update(frame)

            # YOLO 검출기에는 DETECT_INTERVAL_FRAMES 마다만 프레임을 공급한다
            # (매 프레임 추론 → N프레임마다 추론 → CPU 부담·송출 지연 감소).
            # 공급 시점에 frame.copy() — 이후 draw_* 가 frame을 in-place로 그리므로,
            # 검출기가 오버레이가 그려지지 않은 '깨끗한' 프레임을 추론하도록 스냅샷 전달.
            # 세 검출기를 phase로 시차 분산하면 NOS aarch64에서는 각 추론이 phase
            # 간격보다 길어 결국 항상 동시 추론 상태가 되고 FPS가 0으로 무너진다.
            # burst+idle 패턴이 idle 구간 덕에 더 안정적이라 그대로 유지.
            #
            # face 검출은 전체 프레임 대신 person KCF 보간된 최신 박스 안에서만
            # crop 추론한다. 입력 면적이 줄어 CPU 비용↓이며, person 박스 안에서
            # letterbox된 얼굴이 학습 분포(얼굴이 프레임 일정 비율)에 가까워져
            # 근거리 검출률도 함께 개선된다. 사람이 없으면 face 추론 자체를 스킵.
            if det_counter % DETECT_INTERVAL_FRAMES == 0:
                snapshot = frame.copy()
                person_detector.update_frame(snapshot)
                person_boxes_for_face = [
                    (x1, y1, x2, y2)
                    for (_tid, x1, y1, x2, y2) in tracks
                ]
                detector.update_frame(snapshot, person_boxes_for_face)
                # hot-pack은 더 긴 주기로 트리거해 burst 무게 분산
                # (face+person 트리거 N번 중 1번만 hotpack도 함께)
                if det_counter % (DETECT_INTERVAL_FRAMES * HOTPACK_DETECT_INTERVAL_MULTIPLIER) == 0:
                    hotpack_detector.update_frame(snapshot)
            det_counter += 1

            gen, det_boxes = detector.get_boxes_with_gen()
            if gen != last_seen_gen:
                tracker_mgr.reset(frame, det_boxes)
                last_seen_gen = gen

            face_boxes = tracker_mgr.update(frame)
            temp = updater.get_temp_array()

            # 측정 → 매칭 → 레지스트리 업데이트
            measurements = compute_face_temps(face_boxes, temp, frame.shape)
            matched_tids = match_faces_to_persons(measurements, tracks)
            for (tid, *_rest) in tracks:
                registry.touch(tid)
            for m, tid in zip(measurements, matched_tids):
                if tid is not None and m.get('temp') is not None:
                    registry.attach_temp(tid, m['temp'])
            registry.cleanup_stale()

            # 사람 박스(상태별 색) 먼저, 얼굴 마커 위에
            frame = draw_person_status(frame, tracks, registry)
            frame = draw_face_markers(frame, measurements, matched_tids)

            # hot-pack: 새 검출 결과가 나오면 트래커 풀 재초기화, 매 프레임은 트래커가 박스를
            # 객체 움직임에 맞춰 갱신 → DETECT_INTERVAL_FRAMES 사이에도 박스가 실시간으로 따라감.
            hp_gen, hp_det_boxes = hotpack_detector.get_boxes_with_gen()
            if hp_gen != last_hotpack_gen:
                hotpack_tracker_mgr.reset(frame, hp_det_boxes)
                last_hotpack_gen = hp_gen
            hot_boxes = hotpack_tracker_mgr.update(frame)
            hot_measurements = compute_hotpack_temps(hot_boxes, temp, frame.shape)
            # 얼굴 박스에 깊이 포함된 hot-pack은 얼굴 옆모습 오탐으로 보고 제거
            # (사람 전신 박스 안의 hot-pack은 정상 검출 유지 — 손에 든 케이스 보존)
            hot_measurements = filter_hotpacks_vs_faces(hot_measurements, face_boxes)

            # 위험 임계(45°C+) 1초 지속 시 백엔드 알람 발화 (cooldown 30s 내 중복 차단)
            for fired in alert_tracker.update(hot_measurements):
                fire_thermal_alert_async(fired['temperature'])

            frame = draw_hotpack_overlays(frame, hot_measurements)

            _, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            with jpeg_lock:
                latest_jpeg[0] = jpeg.tobytes()

            # 송출 프레임 율 제한 — 관제 측 렉 완화
            elapsed_loop = time.time() - loop_start
            if elapsed_loop < frame_period:
                time.sleep(frame_period - elapsed_loop)
            loop_start = time.time()

    producer_thread = threading.Thread(target=frame_producer, daemon=True)
    producer_thread.start()

    # 첫 프레임 대기
    for _ in range(100):
        with jpeg_lock:
            if latest_jpeg[0] is not None:
                break
        time.sleep(0.05)

    class MJPEGHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            # 캐시 버스터(?t=...) 같은 쿼리스트링은 경로 매칭에서 제외
            path = self.path.split('?', 1)[0]
            if path == '/':
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.end_headers()
                html = ("<html><head><title>Thermal+Face</title></head>"
                        "<body style=\"margin:0;background:#000;display:flex;"
                        "justify-content:center;align-items:center;height:100vh\">"
                        "<img src=\"/stream\" style=\"max-width:100%;max-height:100vh\">"
                        "</body></html>")
                self.wfile.write(html.encode())
            elif path == '/stream':
                self.send_response(200)
                self.send_header('Content-Type',
                                 'multipart/x-mixed-replace; boundary=frame')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                try:
                    while not stop_event.is_set():
                        with jpeg_lock:
                            jpeg = latest_jpeg[0]
                        if jpeg:
                            self.wfile.write(b'--frame\r\n')
                            self.wfile.write(b'Content-Type: image/jpeg\r\n')
                            self.wfile.write(
                                f'Content-Length: {len(jpeg)}\r\n\r\n'.encode())
                            self.wfile.write(jpeg)
                            self.wfile.write(b'\r\n')
                        time.sleep(0.04)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                self.send_error(404)

        def do_POST(self):
            # /ptz/zoom?dir=in|out — 카메라 ISAPI Momentary PTZ로 단발 줌 (500ms 자동 정지)
            parsed = urlparse(self.path)
            if parsed.path == '/ptz/zoom':
                params = parse_qs(parsed.query)
                direction = params.get('dir', [''])[0]
                if direction not in ('in', 'out'):
                    self.send_error(400, "dir must be 'in' or 'out'")
                    return
                ok = ptz_zoom(ptz_session, direction)
                self.send_response(200 if ok else 502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"ok":true}' if ok else b'{"ok":false}')
            else:
                self.send_error(404)

        def log_message(self, format, *args):
            pass

    # ThreadingHTTPServer: 클라이언트별 스레드 분리 — 대시보드 + 모달 + 녹화 등 다중 동시 접속 지원
    server = ThreadingHTTPServer(('0.0.0.0', restream_port), MJPEGHandler)
    print("\n  ==========================================")
    print(f"  관제/브라우저에서 접속:")
    print(f"    http://<로봇IP>:{restream_port}/")
    print(f"    http://<로봇IP>:{restream_port}/stream  (img src 임베드용)")
    print(f"  Ctrl+C로 종료")
    print("  ==========================================\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        print("\nShutting down...")
        # 1) 모든 워커 루프에 종료 신호
        stop_event.set()
        # 2) HTTP 서버 소켓 닫기 — 새 연결 차단 + /stream 핸들러도 빠져나옴
        try:
            server.server_close()
        except Exception:
            pass
        # 3) frame_producer가 grabber/updater/detector를 사용하므로 먼저 종료
        if producer_thread.is_alive():
            producer_thread.join(timeout=3.0)
        # 4) 워커들 — 각자 내부에서 thread.join() 후 자원 해제
        try:
            detector.stop()
        except Exception as e:
            print(f"  detector.stop error: {e}")
        try:
            person_detector.stop()
        except Exception as e:
            print(f"  person_detector.stop error: {e}")
        try:
            hotpack_detector.stop()
        except Exception as e:
            print(f"  hotpack_detector.stop error: {e}")
        try:
            updater.stop()
        except Exception as e:
            print(f"  updater.stop error: {e}")
        try:
            grabber.stop()
        except Exception as e:
            print(f"  grabber.stop error: {e}")
        print("Done.")


# ------------------------------------------------------------------
# 보조 모드: 단일 스냅샷 (테스트용)
# ------------------------------------------------------------------
def run_single_shot(out_path="thermal_face_snapshot.jpg"):
    print("Connecting to camera...")
    session = create_session()
    img, temp_array = fetch_thermal_frame(session)
    img = cv2.resize(img, (OUT_W, OUT_H), interpolation=cv2.INTER_LINEAR)

    detector = FaceDetector()
    # 동기 1회 추론
    detector.update_frame(img)
    detector._loop_once = True
    # 직접 1회 호출
    from ultralytics import YOLO  # noqa: F401
    results = detector.model.predict(img, conf=FACE_CONF_THRESHOLD, verbose=False, imgsz=FACE_DETECT_IMGSZ)
    boxes = []
    for r in results:
        if r.boxes is None:
            continue
        for b in r.boxes.xyxy.cpu().numpy():
            x1, y1, x2, y2 = b[:4]
            boxes.append((int(x1), int(y1), int(x2), int(y2)))
    print(f"  Faces detected: {len(boxes)}")
    print(f"  Temp range: {temp_array.min():.1f}C ~ {temp_array.max():.1f}C")

    measurements = compute_face_temps(boxes, temp_array, img.shape)
    result = draw_face_markers(img, measurements, [None] * len(measurements))
    cv2.imwrite(out_path, result)
    print(f"  Saved: {out_path}")


# ------------------------------------------------------------------
# 보조 모드: ISAPI 단독 실시간 (GUI 필요, 디버깅용)
# ------------------------------------------------------------------
def run_realtime():
    print("Connecting to camera...")
    session = create_session()
    detector = FaceDetector()

    cv2.namedWindow("Thermal+Face", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Thermal+Face", OUT_W, OUT_H)

    while True:
        try:
            img, temp_array = fetch_thermal_frame(session)
            img = cv2.resize(img, (OUT_W, OUT_H), interpolation=cv2.INTER_LINEAR)
            results = detector.model.predict(
                img, conf=FACE_CONF_THRESHOLD, verbose=False, imgsz=FACE_DETECT_IMGSZ)
            boxes = []
            for r in results:
                if r.boxes is None:
                    continue
                for b in r.boxes.xyxy.cpu().numpy():
                    x1, y1, x2, y2 = b[:4]
                    boxes.append((int(x1), int(y1), int(x2), int(y2)))
            measurements = compute_face_temps(boxes, temp_array, img.shape)
            result = draw_face_markers(img, measurements, [None] * len(measurements))
            cv2.imshow("Thermal+Face", result)
        except Exception as e:
            print(f"  Frame error: {e}")
        if (cv2.waitKey(50) & 0xFF) == 27:
            break
    cv2.destroyAllWindows()


# ------------------------------------------------------------------
# 진입점
# ------------------------------------------------------------------
if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "--rtsp":
        port = int(args[1]) if len(args) > 1 else 8556
        run_rtsp_overlay(restream_port=port)
    elif args[0] == "--snapshot":
        run_single_shot()
    elif args[0] == "--realtime":
        run_realtime()
    else:
        print(__doc__)
