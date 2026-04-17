from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.navigation.save_point import point as nav_point
from app.navigation.send_move import move as nav_move
from app.database.routes import database as database_function
from app.map.map_manage import map_manage as map_manage_router
from app.map.mapping_control import mapping_ctrl as mapping_ctrl_router
from app.map.ws_mapping import ws_mapping as ws_mapping_router, start_udp_server
from app.database.database import engine, Base, SessionLocal
from app.database.models import RobotInfo
from app.logs.routes import router as log_router
from app.alerts.routes import router as alert_router
from app.notices.routes import router as notice_router
from app.businesses.routes import router as business_router
from app.auth.routes import router as auth_router
from app.users.routes import router as users_router
from app.backup.routes import router as backup_router
from app.statistics.routes import router as statistics_router
from app.recording.routes import router as recording_router
from app.logs.service import log_event
from app.robot_io.sender import send_to_robot
from app.navigation.send_move import (
    navigation_send_next, navigation_resend_current,
    is_nav_active, get_current_target, get_nav_sent_time, check_and_clear_reset_flag,
    current_wp_index, waypoints_list, nav_loop_remaining
)
from app.scheduler.loop import (
    scheduler_thread, on_navigation_complete, on_navigation_error, get_active_schedule_id
)

import os
import time
import threading
import socket
import json
import struct
import math

# OpenCV RTSP를 TCP 우선 모드로 설정 (UDP 끊김 방지)
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|loglevel;error"
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

from app.robot_control import router as robot_control_router

app.include_router(nav_point)
app.include_router(nav_move)
app.include_router(database_function)
app.include_router(map_manage_router)
app.include_router(mapping_ctrl_router)
app.include_router(ws_mapping_router)
app.include_router(log_router)
app.include_router(alert_router)
app.include_router(notice_router)
app.include_router(business_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(backup_router)
app.include_router(statistics_router)
app.include_router(recording_router)
app.include_router(robot_control_router)


# ======================================================
# 전역 데이터 저장 → robot_runtime 모듈로 이관
# ======================================================
import app.robot_io.runtime as runtime

from app.user_cache import cached_user, cached_robot, get_robot_id, get_robot_name


# ======================================================
# 로봇 I/O (설정/프로토콜/폴링)
# ======================================================
from app.robot_io import (
    ROBOT_IP, ROBOT_PORT,
    RECEIVER_IP, RECEIVER_PORT,
    PC_PORT_POS, PC_PORT_STATUS, PC_PORT_NAV,
    REQ_INTERVAL_POS, REQ_INTERVAL_HB,
    INIT_POSE,
    build_packet, send_init_pose,
    start_polling_threads,
)


@app.on_event("startup")
def startup_event():
    # 테이블 자동 생성 (모델 정의 기준, 없으면 생성)
    Base.metadata.create_all(bind=engine)
    # 맵핑 TCP 수신 서버 시작
    start_udp_server()

    # 기본 데이터 시드
    from app.database.database import SessionLocal
    from app.database.models import UserInfo, RobotInfo
    from app.database.seed import seed_all
    db = SessionLocal()
    try:
        seed_all(db)

        # 사용자 캐싱 (기존 호환)
        user = db.query(UserInfo).order_by(UserInfo.id.asc()).first()
        if user:
            cached_user["id"] = user.id
            cached_user["UserName"] = user.UserName
            print(f"[OK] 현재 사용자: {cached_user['UserName']} (id={cached_user['id']})")

        # robot_info에서 첫 번째 로봇 캐싱
        robot = db.query(RobotInfo).order_by(RobotInfo.id.asc()).first()
        if robot:
            cached_robot["id"] = robot.id
            cached_robot["RobotName"] = robot.RobotName
            print(f"[OK] 현재 로봇: {cached_robot['RobotName']} (id={cached_robot['id']})")

        # 전체 로봇 런타임 상태 초기화
        all_robots = db.query(RobotInfo).order_by(RobotInfo.id.asc()).all()
        runtime.init_runtime(all_robots)
    finally:
        db.close()

    time.sleep(2)
    #send_init_pose()
    # FFmpeg 자동 확인/설치 + 녹화 고아 세션 정리 + 보관 정책 스레드 시작
    from app.recording.ffmpeg_check import ensure_ffmpeg
    from app.recording.manager import cleanup_orphaned_recordings
    from app.recording.retention import start_retention_thread
    ensure_ffmpeg()
    cleanup_orphaned_recordings()
    start_retention_thread()

    log_event("system", "system_startup", "서버 시작")


@app.on_event("startup")
async def _tune_threadpool():
    """Starlette(anyio) 기본 스레드풀 토큰을 상향.

    기본값 40은 MJPEG 스트리밍 등 장기 점유 동기 엔드포인트가 몇 개만
    열려도 고갈되어, 다른 동기 API가 큐에서 대기하게 된다.
    """
    from anyio import to_thread
    to_thread.current_default_thread_limiter().total_tokens = 200


@app.on_event("shutdown")
def shutdown_event():
    from app.recording.manager import stop_all
    stop_all()


# ======================================================
# 백그라운드 스레드 시작
# ======================================================
start_polling_threads()
threading.Thread(target=scheduler_thread, daemon=True).start()


@app.get("/user/current")
def get_current_user():
    return cached_user


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
