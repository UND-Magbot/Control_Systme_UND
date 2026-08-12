# 콘솔 로그 파일 출력 (장기 자율주행 반복 테스트 오류 검출용)
# 다른 모듈보다 먼저 설정해야 import 단계의 출력까지 파일에 남는다.
from app.console_logger import setup_console_logging
setup_console_logging()

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.navigation.save_point import point as nav_point
from app.navigation.send_move import move as nav_move
from app.navigation.elevator_op import router as elevator_op_router
from app.navigation.door_op import router as door_op_router
from app.map.elevator import router as elevator_router
from app.map.door import router as door_router, facility_router
from app.database.routes import database as database_function
from app.map.map_manage import map_manage as map_manage_router
from app.map.mapping_control import mapping_ctrl as mapping_ctrl_router
from app.map.ws_mapping import ws_mapping as ws_mapping_router, start_udp_server
from app.database.database import engine, Base, SessionLocal
from app.database.models import RobotInfo
from app.logs.routes import router as log_router
from app.alerts.routes import router as alert_router
from app.alerts.external import router as alert_external_router
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
    scheduler_thread, on_navigation_complete, on_navigation_error, get_active_schedule_id,
    recover_stale_schedules,
)

import os
import time
import threading
import socket
import json
import struct
import math

# OpenCV RTSP 전송 방식 — RTSP_TRANSPORT 환경변수로 tcp/udp 전환 (기본 tcp).
# 카메라가 H.265(HEVC) 인코딩이라 udp는 패킷 손실 시 참조 프레임이 사라져
# 'Could not find ref with POC' → 회색/깨진 화면이 된다. 불안정 네트워크에서는
# 손실 없는 tcp가 안전하다. udp는 네트워크가 깨끗할 때만 유효.
_rtsp_transport = os.environ.get("RTSP_TRANSPORT", "tcp").strip().lower()
if _rtsp_transport not in ("tcp", "udp"):
    _rtsp_transport = "tcp"
# fflags;nobuffer + flags;low_delay — 디코더/디먹서 버퍼링을 줄여 지연 최소화.
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    f"rtsp_transport;{_rtsp_transport}"
    "|fflags;nobuffer|flags;low_delay"
    "|loglevel;error"
)
print(f"[OK] RTSP transport: {_rtsp_transport} (low-latency)")
import cv2


app = FastAPI(title="Control API", version="0.1.0")

# 허용 출처는 env(CORS_ORIGINS, 콤마구분)로 관리한다.
# - 설정 시: 화이트리스트 모드(allow_origins) — 프로덕션 권장. 지정 출처만 허용.
# - 미설정/"*": 모든 출처 반사(개발/하위호환). allow_origins=["*"] + credentials 는
#   CORS 명세상 충돌이라 ACAO 헤더가 누락되므로, origin 을 반사하는 allow_origin_regex
#   로 두어 모든 출처를 허용하면서 credentials 와도 호환되게 한다.
_cors_origins_env = os.getenv("CORS_ORIGINS", "").strip()
if _cors_origins_env and _cors_origins_env != "*":
    _allowed_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    print(f"[CORS] 화이트리스트 모드: {_allowed_origins}")
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    print("[CORS] 전체 허용 모드(allow_origin_regex='.*') — 프로덕션에서는 CORS_ORIGINS 설정 권장")

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
app.include_router(alert_external_router)
app.include_router(notice_router)
app.include_router(business_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(backup_router)
app.include_router(statistics_router)
app.include_router(recording_router)
app.include_router(robot_control_router)
app.include_router(elevator_router)
app.include_router(elevator_op_router)
app.include_router(door_router)
app.include_router(door_op_router)
app.include_router(facility_router)


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
    from app.database.models import UserInfo, RobotInfo, RobotLastStatus
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

        # 현재 로봇 캐싱 — 폴링 대상(ROBOT_IP)과 같은 로봇을 잡는다.
        # id.desc() 만 쓰면 시뮬레이터처럼 나중에 등록된 로봇이 잡혀, 상태는 실기를
        # 보는데 명령은 다른 로봇으로 나가는 갈림이 생긴다. 매칭 실패 시 기존 동작 유지.
        robot = (
            db.query(RobotInfo).filter(RobotInfo.RobotIP == ROBOT_IP).first()
            or db.query(RobotInfo).order_by(RobotInfo.id.desc()).first()
        )
        if robot:
            cached_robot["id"] = robot.id
            cached_robot["RobotName"] = robot.RobotName
            cached_robot["BusinessId"] = robot.BusinessId
            print(f"[OK] 현재 로봇: {cached_robot['RobotName']} (id={cached_robot['id']})")

        # 전체 로봇 런타임 상태 초기화 (DB 마지막 상태 복원 포함)
        all_robots = db.query(RobotInfo).order_by(RobotInfo.id.asc()).all()
        last_statuses = {
            ls.RobotId: ls
            for ls in db.query(RobotLastStatus).all()
        }
        runtime.init_runtime(all_robots, last_statuses)
    finally:
        db.close()

    # 부팅 시 고착된 IsWorking(작업중) 정정 — 비정상 종료로 남은 stale 플래그가
    # 재시작 후에도 로봇을 '작업중'으로 오판하게 하는 문제 방지.
    try:
        from app.navigation.send_move import reconcile_is_working_on_boot
        reconcile_is_working_on_boot()
    except Exception as e:
        print(f"[BOOT-RECONCILE] 호출 실패: {e}")

    # 고아 스케줄·회차 복구와 스케줄러 기동은 **seed_all(스키마 마이그레이션) 이후**여야 한다.
    # 모듈 임포트 시점에 돌리면 컬럼이 추가되기 전에 schedule_info 를 조회해 실패한다.
    # 로봇 소유권 — 관제가 여러 대 떠 있어도 로봇 하나는 한 대만 몬다.
    # 스케줄러보다 먼저 켠다(회차 시작이 소유권을 확인하므로).
    try:
        from app.cluster import instance
        from app.robot_control import control_lock as cl
        from app.scheduler.loop import register_ownership_hooks
        register_ownership_hooks()
        cl.start()
        print(f"[CLUSTER] 인스턴스 역할={instance.role()} db={instance.info()['database']}")
    except Exception as e:
        print(f"[CLUSTER] 소유권 초기화 실패(단독 모드로 계속): {e}")

    recover_stale_schedules()
    threading.Thread(target=scheduler_thread, daemon=True).start()

    time.sleep(2)
    #send_init_pose()
    # FFmpeg 자동 확인/설치 + 녹화 고아 세션 정리 + 보관 정책 스레드 시작
    from app.recording.ffmpeg_check import ensure_ffmpeg
    from app.recording.manager import cleanup_orphaned_recordings
    from app.recording.retention import start_retention_thread
    ensure_ffmpeg()
    cleanup_orphaned_recordings()
    start_retention_thread()

    from app.robot_io.persistence import start_persistence_thread
    start_persistence_thread()

    # 공유 DB 맵 목록 ↔ 로컬 static/maps 비교 동기화.
    #   예) 로컬 5개 맵 + DB 메타 6개 → 빠진 1개를 DB BLOB 에서 복원해 6개로 맞춘다.
    #   모든 맵 파일이 이미 있으면 그냥 통과(복원 0).
    # 시작을 막지 않도록 백그라운드 스레드로 수행.
    def _sync_maps_from_db():
        from app.database.database import SessionLocal as _SL
        from app.map.map_file_store import sync_all_from_db
        _db = _SL()
        try:
            s = sync_all_from_db(_db)
            if s["restored_maps"] == 0 and not s["incomplete"]:
                print(f"[MAPFILE] 시작 동기화: DB {s['db_maps']}개 맵 전부 로컬 보유 → 통과")
            else:
                print(
                    f"[MAPFILE] 시작 동기화: DB {s['db_maps']}개 / 기보유 "
                    f"{s['already_complete']} / 복원 {s['restored_maps']}개 맵"
                    f"({s['restored_files']}파일)"
                )
            for mid, name, kinds in s["incomplete"]:
                print(f"[MAPFILE]   ⚠ 복구 불가(원본 매핑/가져오기 필요): [{mid}] {name} {kinds}")
        except Exception as e:
            print(f"[MAPFILE] 시작 시 맵 파일 동기화 실패: {e}")
        finally:
            _db.close()
    threading.Thread(target=_sync_maps_from_db, daemon=True).start()

    log_event("system", "system_startup", "서버 시작")


@app.on_event("startup")
async def _tune_threadpool():
    """Starlette(anyio) 기본 스레드풀 토큰을 상향.

    기본값 40은 MJPEG 스트리밍 등 장기 점유 동기 엔드포인트가 몇 개만
    열려도 고갈되어, 다른 동기 API가 큐에서 대기하게 된다.
    """
    from anyio import to_thread
    to_thread.current_default_thread_limiter().total_tokens = 200


@app.on_event("startup")
def _backfill_map_images_on_startup():
    """기동 시 로컬 static/maps에 누락된 맵 png를 백그라운드로 복구한다.

    여러 백엔드 인스턴스가 DB는 공유하지만 static/maps 파일은 인스턴스별
    로컬이라, 다른 인스턴스에서 가져온 맵의 png가 이 인스턴스엔 없을 수 있다.
    로컬 pgm/zip으로 우선 복구하고, 없으면 로봇(NOS)에서 재다운로드한다.
    SSH가 섞일 수 있어 기동을 막지 않도록 데몬 스레드에서 수행한다.
    """
    import threading

    def _run():
        try:
            from app.map.map_backfill import backfill_map_images
            res = backfill_map_images(allow_robot_fetch=True)
            if res["ok"] or res["failed"]:
                print(f"[STARTUP] 맵 이미지 백필: {res}")
        except Exception as e:
            print(f"[STARTUP] 맵 이미지 백필 실패: {e}")

    threading.Thread(target=_run, daemon=True, name="map-backfill").start()


@app.on_event("shutdown")
def shutdown_event():
    # 폴링/매핑 백그라운드 루프에 종료 신호 (M-9) — 좀비 루프 방지
    try:
        from app.robot_io.polling import stop_polling_threads
        stop_polling_threads()
    except Exception as e:
        print(f"[SHUTDOWN] 폴링 종료 신호 실패: {e}")
    try:
        from app.map.ws_mapping import stop_polling as stop_mapping_polling
        stop_mapping_polling()
    except Exception as e:
        print(f"[SHUTDOWN] 매핑 폴링 종료 실패: {e}")

    from app.robot_io.persistence import flush_all
    flush_all()
    from app.recording.manager import stop_all
    stop_all()


# ======================================================
# 백그라운드 스레드 시작
# ======================================================
start_polling_threads()
# 스케줄러 기동은 startup_event 로 옮겼다 — 마이그레이션 이후여야 하기 때문(위 주석 참조).


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
