from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.remote.Remote_pad import pad as robot_remotePad
from app.remote.Remote_mode import mode as robot_remoteMode
# rtsp_stream 라우터 제거 — /Video/{module_id} 동적 엔드포인트로 통합
from app.navigation.save_point import point as nav_point
from app.navigation.send_move import move as nav_move
from app.Database.DatabaseFunction import database as database_function
from app.map.map_manage import map_manage as map_manage_router
from app.map.mapping_control import mapping_ctrl as mapping_ctrl_router
from app.map.ws_mapping import ws_mapping as ws_mapping_router, start_udp_server
from app.Database.database import engine, Base, SessionLocal
from app.Database.models import BusinessInfo, FloorInfo, RobotMapInfo, RobotModule, ModuleCameraInfo, RobotInfo
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
from app.robot_sender import send_to_robot
from app.navigation.send_move import (
    navigation_send_next, navigation_resend_current,
    is_nav_active, get_current_target, get_nav_sent_time, check_and_clear_reset_flag,
    current_wp_index, waypoints_list, nav_loop_remaining
)
from app.scheduler.engine import (
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

ALLOWED_ORIGINS = [
    f"http://localhost:{p}" for p in range(3000, 3010)
] + [
    f"http://127.0.0.1:{p}" for p in range(3000, 3010)
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api")
def root():
    return {"msg": "FastAPI 서버가 정상적으로 실행 중입니다!"}

app.include_router(robot_remotePad)
app.include_router(robot_remoteMode)
# rtsp_router 제거됨 — /Video/{module_id}로 통합
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


# ======================================================
# MJPEG
# ======================================================
def rtsp_to_mjpeg(rtsp_url):
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

@app.get("/Video/{module_id}")
def stream_camera(module_id: int):
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
        rtsp_to_mjpeg(url),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


# ======================================================
# 전역 데이터 저장 → robot_runtime 모듈로 이관
# ======================================================
import app.robot_runtime as runtime

from app.current_user import cached_user, cached_robot, get_robot_id, get_robot_name
from app.robot_error_codes import ROBOT_ERROR_CODES

# 중복 로그 방지: 마지막으로 기록한 에러 코드
_last_logged_error_code = 0


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
INIT_POSE = {"PosX": 3.998, "PosY": -2.612, "PosZ": 0.0, "Yaw": -1.604}

def send_init_pose():
    """로봇에 직접 init_pose 전송 + 위치 변화로 성공 확인"""
    # 1) 전송 전 위치 기록
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    before = runtime.get_position(rid) if rid else {}
    print(f"📍 [INIT_POSE] 전송 전 위치: x={before.get('x')}, y={before.get('y')}, yaw={before.get('yaw')}")

    # 2) 로봇에 직접 전송 (fire-and-forget — Type 2101은 응답 없는 프로토콜)
    asdu = {
        "PatrolDevice": {
            "Type": 2101,
            "Command": 1,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": INIT_POSE
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
    sock.close()
    print(f"[INIT] [INIT_POSE] 전송 완료 → {ROBOT_IP}:{ROBOT_PORT} | {INIT_POSE}")

    # 3) 3초 후 위치 다시 확인
    time.sleep(3)
    after = runtime.get_position(rid) if rid else {}
    print(f"📍 [INIT_POSE] 전송 후 위치: x={after.get('x')}, y={after.get('y')}, yaw={after.get('yaw')}")

    dx = abs(after.get("x", 0) - before.get("x", 0))
    dy = abs(after.get("y", 0) - before.get("y", 0))
    if dx > 0.01 or dy > 0.01:
        print(f"[OK] [INIT_POSE] 위치 변화 감지! dx={dx:.3f}, dy={dy:.3f} → 적용 성공")
    else:
        print(f"[WARN] [INIT_POSE] 위치 변화 없음 (dx={dx:.3f}, dy={dy:.3f}) → 적용 안 됐을 수 있음")


def _auto_migrate():
    """기존 DB에 신규 컬럼이 없으면 1회만 ALTER 실행."""
    from sqlalchemy import text, inspect
    inspector = inspect(engine)

    # user_info 테이블이 존재하는지 확인
    if "user_info" not in inspector.get_table_names():
        return  # 테이블 자체가 없으면 create_all이 처리

    existing_cols = {col["name"] for col in inspector.get_columns("user_info")}

    # LoginId 컬럼이 없으면 아직 마이그레이션 안 된 것
    if "LoginId" not in existing_cols:
        print("[SYNC] 기존 DB 감지 — user_info 컬럼 마이그레이션 실행 중...")
        with engine.begin() as conn:
            conn.execute(text("""
                ALTER TABLE user_info
                  ADD COLUMN LoginId VARCHAR(50) UNIQUE AFTER UserName,
                  ADD COLUMN `Password` VARCHAR(255) AFTER LoginId,
                  ADD COLUMN RefreshTokenHash VARCHAR(255) NULL AFTER `Password`,
                  ADD COLUMN IsActive TINYINT(1) DEFAULT 1 AFTER RefreshTokenHash,
                  ADD COLUMN LastLoginAt DATETIME NULL AFTER IsActive,
                  ADD COLUMN CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP AFTER LastLoginAt,
                  ADD COLUMN UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER CreatedAt,
                  ADD COLUMN DeletedAt DATETIME NULL AFTER UpdatedAt
            """))
        print("[MIGRATION] user_info 컬럼 마이그레이션 완료")

    # robot_info 테이블에 RobotType, RobotIP, RobotPort 컬럼 추가
    if "robot_info" in inspector.get_table_names():
        robot_cols = {col["name"] for col in inspector.get_columns("robot_info")}
        if "RobotType" not in robot_cols:
            print("[SYNC] robot_info 컬럼 마이그레이션 실행 중...")
            with engine.begin() as conn:
                conn.execute(text("""
                    ALTER TABLE robot_info
                      ADD COLUMN RobotType VARCHAR(20) NULL AFTER RobotName,
                      ADD COLUMN RobotIP VARCHAR(45) NULL AFTER RobotType,
                      ADD COLUMN RobotPort INT NULL DEFAULT 30000 AFTER RobotIP
                """))
            print("[MIGRATION] robot_info 컬럼 마이그레이션 완료 (RobotType, RobotIP, RobotPort)")

        # ── 데이터 복원: 컬럼 추가로 밀린 데이터 수정 (1회성) ──
        robot_cols = {col["name"] for col in inspector.get_columns("robot_info")}
        if "Adddate" in robot_cols:
            from sqlalchemy import text as _t
            with engine.begin() as conn:
                # Adddate가 비어있고 LimitBattery에 날짜가 들어간 행 = 밀린 데이터
                rows = conn.execute(_t(
                    "SELECT id, Adddate, LimitBattery, BusinessId FROM robot_info "
                    "WHERE (Adddate IS NULL OR Adddate = '') "
                    "AND LimitBattery IS NOT NULL "
                    "AND CAST(LimitBattery AS CHAR) LIKE '20%'"
                )).fetchall()
                if rows:
                    print(f"[SYNC] robot_info 밀린 데이터 {len(rows)}건 복원 중...")
                    for row in rows:
                        conn.execute(_t(
                            "UPDATE robot_info SET Adddate = :date_val, LimitBattery = 22, BusinessId = 1 "
                            "WHERE id = :rid"
                        ), {"date_val": str(row[2]), "rid": row[0]})
                    print("[MIGRATION] robot_info 데이터 복원 완료")

        # Adddate(VARCHAR) → CreatedAt/UpdatedAt/DeletedAt(DATETIME) 마이그레이션
        robot_cols = {col["name"] for col in inspector.get_columns("robot_info")}
        if "Adddate" in robot_cols and "CreatedAt" not in robot_cols:
            print("[SYNC] robot_info Adddate → CreatedAt/UpdatedAt/DeletedAt 마이그레이션 중...")
            with engine.begin() as conn:
                conn.execute(text("""
                    ALTER TABLE robot_info
                      ADD COLUMN CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER LimitBattery,
                      ADD COLUMN UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER CreatedAt,
                      ADD COLUMN DeletedAt DATETIME NULL AFTER UpdatedAt
                """))
                # 기존 Adddate 값을 CreatedAt으로 복사 (VARCHAR→DATETIME 변환)
                conn.execute(text("""
                    UPDATE robot_info
                    SET CreatedAt = CASE
                        WHEN Adddate IS NOT NULL AND Adddate != '' THEN STR_TO_DATE(Adddate, '%Y-%m-%d %H:%i:%s')
                        ELSE NOW()
                    END
                """))
                # Adddate 컬럼 삭제
                conn.execute(text("ALTER TABLE robot_info DROP COLUMN Adddate"))
            print("[MIGRATION] robot_info Adddate → CreatedAt/UpdatedAt/DeletedAt 완료")

    # business_info Adddate → CreatedAt/UpdatedAt/DeletedAt 마이그레이션
    if "business_info" in inspector.get_table_names():
        biz_cols = {col["name"] for col in inspector.get_columns("business_info")}
        if "Adddate" in biz_cols and "CreatedAt" not in biz_cols:
            print("[SYNC] business_info Adddate → CreatedAt/UpdatedAt/DeletedAt 마이그레이션 중...")
            with engine.begin() as conn:
                conn.execute(text("""
                    ALTER TABLE business_info
                      ADD COLUMN CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER Description,
                      ADD COLUMN UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER CreatedAt,
                      ADD COLUMN DeletedAt DATETIME NULL AFTER UpdatedAt
                """))
                conn.execute(text("""
                    UPDATE business_info
                    SET CreatedAt = CASE
                        WHEN Adddate IS NOT NULL THEN Adddate
                        ELSE CURRENT_TIMESTAMP
                    END
                """))
                conn.execute(text("ALTER TABLE business_info DROP COLUMN Adddate"))
            print("[MIGRATION] business_info Adddate → CreatedAt/UpdatedAt/DeletedAt 완료")

    # recording_info 테이블에 ErrorReason 컬럼 추가
    if "recording_info" in inspector.get_table_names():
        rec_cols = {col["name"] for col in inspector.get_columns("recording_info")}
        if "ErrorReason" not in rec_cols:
            print("[SYNC] recording_info ErrorReason 컬럼 추가 중...")
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE recording_info ADD COLUMN ErrorReason VARCHAR(200) NULL AFTER Status"
                ))
            print("[MIGRATION] recording_info ErrorReason 컬럼 추가 완료")

    # notice_info: AttachmentSize 컬럼 추가
    if "notice_info" in inspector.get_table_names():
        ni_cols = {col["name"] for col in inspector.get_columns("notice_info")}
        if "AttachmentSize" not in ni_cols:
            print("[SYNC] notice_info AttachmentSize 컬럼 추가 중...")
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE notice_info ADD COLUMN AttachmentSize INT NULL AFTER AttachmentUrl"
                ))
            print("[MIGRATION] notice_info AttachmentSize 컬럼 추가 완료")

    # user_permission 테이블이 기존 VARCHAR MenuId로 존재하면 재생성
    if "user_permission" in inspector.get_table_names():
        up_cols = {col["name"]: col for col in inspector.get_columns("user_permission")}
        menu_id_col = up_cols.get("MenuId")
        if menu_id_col and str(menu_id_col["type"]).startswith("VARCHAR"):
            print("[SYNC] user_permission 테이블 VARCHAR→INT FK 마이그레이션 중...")
            with engine.begin() as conn:
                conn.execute(text("DROP TABLE user_permission"))
            print("[MIGRATION] 기존 user_permission 삭제 (create_all에서 재생성)")


@app.on_event("startup")
def startup_event():
    # 기존 DB 마이그레이션 (1회만)
    _auto_migrate()
    # 테이블 자동 생성 (신규 테이블: user_permission, audit_log 등)
    Base.metadata.create_all(bind=engine)
    # 맵핑 TCP 수신 서버 시작
    start_udp_server()

    # 기본 데이터 시드
    from app.Database.database import SessionLocal
    from app.Database.models import UserInfo, RobotInfo, UserPermission, MenuInfo
    from app.auth.password import hash_password
    db = SessionLocal()

    # ── 메뉴 마스터 시드 (menu_info) ──
    MENU_SEED = [
        # (MenuKey, MenuName, ParentKey, SortOrder)
        ("dashboard",        "대시보드",    None,              1),
        ("schedule-mgmt",    "작업관리",    None,              2),
        ("schedule-list",    "작업 목록",   "schedule-mgmt",   1),
        ("robot-mgmt",       "운영관리",    None,              3),
        ("robot-list",       "로봇 목록",   "robot-mgmt",      1),
        ("business-list",    "사업장 목록", "robot-mgmt",      2),
        ("map-management",   "맵 관리",     None,              4),
        ("map-edit",         "맵 편집",     "map-management",  1),
        ("place-list",       "장소 목록",   "map-management",  2),
        ("path-list",        "경로 목록",   "map-management",  3),
        ("data-mgmt",        "데이터관리",  None,              5),
        ("video",            "영상 관리",   "data-mgmt",       1),
        ("statistics",       "통계 관리",   "data-mgmt",       2),
        ("log",              "로그 관리",   "data-mgmt",       3),
        ("alerts",           "알림",        None,              6),
        ("alert-total",      "전체",        "alerts",          1),
        ("alert-schedule",   "스케줄",      "alerts",          2),
        ("alert-robot",      "로봇",        "alerts",          3),
        ("alert-notice",     "공지사항",    "alerts",          4),
        ("settings",         "설정",        None,              7),
        ("menu-permissions", "메뉴 권한",   "settings",        1),
        ("password-change",  "비밀번호 변경","settings",       2),
        ("db-backup",        "DB 백업",     "settings",        3),
    ]

    existing_keys = {r.MenuKey for r in db.query(MenuInfo.MenuKey).all()}
    if not existing_keys:
        # 1차: 부모 메뉴 먼저 (ParentKey=None)
        key_to_id = {}
        for menu_key, menu_name, parent_key, sort_order in MENU_SEED:
            if parent_key is None:
                m = MenuInfo(MenuKey=menu_key, MenuName=menu_name, ParentId=None, SortOrder=sort_order)
                db.add(m)
                db.flush()
                key_to_id[menu_key] = m.id
        # 2차: 자식 메뉴
        for menu_key, menu_name, parent_key, sort_order in MENU_SEED:
            if parent_key is not None:
                m = MenuInfo(MenuKey=menu_key, MenuName=menu_name, ParentId=key_to_id[parent_key], SortOrder=sort_order)
                db.add(m)
                db.flush()
                key_to_id[menu_key] = m.id
        db.commit()
        print(f"[OK] 메뉴 마스터 {len(MENU_SEED)}개 시드 완료")
    else:
        # 새 메뉴 추가분만 처리
        new_menus = [s for s in MENU_SEED if s[0] not in existing_keys]
        if new_menus:
            key_to_id = {r.MenuKey: r.id for r in db.query(MenuInfo).all()}
            for menu_key, menu_name, parent_key, sort_order in new_menus:
                parent_id = key_to_id.get(parent_key) if parent_key else None
                m = MenuInfo(MenuKey=menu_key, MenuName=menu_name, ParentId=parent_id, SortOrder=sort_order)
                db.add(m)
                db.flush()
                key_to_id[menu_key] = m.id
            db.commit()
            print(f"[OK] 메뉴 마스터 {len(new_menus)}개 추가")

        # 기존 메뉴 ParentId·SortOrder 동기화
        key_to_id = {r.MenuKey: r.id for r in db.query(MenuInfo).all()}
        updated = 0
        for menu_key, menu_name, parent_key, sort_order in MENU_SEED:
            menu = db.query(MenuInfo).filter(MenuInfo.MenuKey == menu_key).first()
            if not menu:
                continue
            expected_parent = key_to_id.get(parent_key) if parent_key else None
            changed = False
            if menu.ParentId != expected_parent:
                menu.ParentId = expected_parent
                changed = True
            if menu.SortOrder != sort_order:
                menu.SortOrder = sort_order
                changed = True
            if menu.MenuName != menu_name:
                menu.MenuName = menu_name
                changed = True
            if changed:
                updated += 1
        # 시드에 없는 메뉴 삭제 (schedule-insert 등)
        seed_keys = {s[0] for s in MENU_SEED}
        removed = db.query(MenuInfo).filter(MenuInfo.MenuKey.notin_(seed_keys)).delete(synchronize_session="fetch")
        if updated or removed:
            db.commit()
            print(f"[OK] 메뉴 마스터 동기화: {updated}개 수정, {removed}개 삭제")

    try:
        # ── 최고관리자 계정 시드 (permission=1) ──
        admin_user = (
            db.query(UserInfo).filter(UserInfo.LoginId == "superadmin").first()
            or db.query(UserInfo).filter(UserInfo.LoginId == "admin").first()
            or db.query(UserInfo).filter(UserInfo.UserName == "관리자").first()
        )
        if admin_user:
            changed = False
            if admin_user.LoginId != "superadmin":
                admin_user.LoginId = "superadmin"
                admin_user.Password = hash_password("superadmin1234!")
                changed = True
            if admin_user.Permission != 1:
                admin_user.Permission = 1
                changed = True
            if admin_user.UserName != "최고관리자":
                admin_user.UserName = "최고관리자"
                changed = True
            admin_user.IsActive = 1
            if changed:
                db.commit()
                print("[SEED] 최고관리자 계정 동기화 완료")
        else:
            admin_user = UserInfo(
                Permission=1,
                UserName="최고관리자",
                LoginId="superadmin",
                Password=hash_password("superadmin1234!"),
                IsActive=1,
            )
            db.add(admin_user)
            db.commit()
            print("[SEED] 최고관리자 계정 생성 완료")

        # ── 관리자 전체 메뉴 권한 시드 (없는 권한만 추가, 중복 방지) ──
        if admin_user:
            from sqlalchemy import text
            all_menu_ids = {r.id for r in db.query(MenuInfo.id).all()}

            # 최신 커밋 상태 반영을 위해 세션 갱신
            db.expire_all()
            existing_perms = {
                r.MenuId for r in
                db.query(UserPermission.MenuId).filter(UserPermission.UserId == admin_user.id).all()
            }
            new_perms = all_menu_ids - existing_perms
            if new_perms:
                added = 0
                for menu_id in sorted(new_perms):
                    # DB 레벨 중복 방지: 이미 있으면 스킵
                    exists = db.query(UserPermission).filter(
                        UserPermission.UserId == admin_user.id,
                        UserPermission.MenuId == menu_id,
                    ).first()
                    if not exists:
                        db.add(UserPermission(UserId=admin_user.id, MenuId=menu_id))
                        added += 1
                if added:
                    db.commit()
                    print(f"[OK] 관리자 메뉴 권한 {added}개 추가")

        # ── 관리자 계정 시드 (permission=2) ──
        manager_user = (
            db.query(UserInfo).filter(UserInfo.LoginId == "admin").first()
            or db.query(UserInfo).filter(UserInfo.LoginId == "manager").first()
        )
        if manager_user:
            changed = False
            if manager_user.LoginId != "admin":
                manager_user.LoginId = "admin"
                manager_user.Password = hash_password("admin1234!")
                changed = True
            if manager_user.Permission != 2:
                manager_user.Permission = 2
                changed = True
            if manager_user.UserName != "관리자":
                manager_user.UserName = "관리자"
                changed = True
            manager_user.IsActive = 1
            if changed:
                db.commit()
                print("[SEED] 관리자 계정 동기화 완료")
        else:
            manager_user = UserInfo(
                Permission=2,
                UserName="관리자",
                LoginId="admin",
                Password=hash_password("admin1234!"),
                IsActive=1,
            )
            db.add(manager_user)
            db.commit()
            print("[SEED] 관리자 계정 생성 완료")

        # ── 관리자 메뉴 권한 시드 (DB 백업 제외) ──
        if manager_user:
            MANAGER_MENUS = [
                "dashboard", "schedule-list",
                "robot-list", "business-list",
                "map-edit", "place-list", "path-list",
                "video", "statistics", "log",
                "alert-total", "alert-schedule", "alert-robot", "alert-notice",
                "menu-permissions",
            ]
            existing_mgr_perms = {
                r.MenuId for r in
                db.query(UserPermission.MenuId).filter(UserPermission.UserId == manager_user.id).all()
            }
            key_to_id = {r.MenuKey: r.id for r in db.query(MenuInfo).all()}
            added_mgr = 0
            for menu_key in MANAGER_MENUS:
                menu_id = key_to_id.get(menu_key)
                if menu_id and menu_id not in existing_mgr_perms:
                    db.add(UserPermission(UserId=manager_user.id, MenuId=menu_id))
                    added_mgr += 1
            if added_mgr:
                db.commit()
                print(f"[SEED] 관리자 메뉴 권한 {added_mgr}개 추가")

        # ── 일반 사용자 계정 시드 (permission=3) ──
        normal_user = db.query(UserInfo).filter(UserInfo.LoginId == "user").first()
        if not normal_user:
            normal_user = UserInfo(
                Permission=3,
                UserName="사용자",
                LoginId="user",
                Password=hash_password("user1234!"),
                IsActive=1,
            )
            db.add(normal_user)
            db.commit()
            print("[SEED] 일반 사용자 계정 생성 완료")
        elif normal_user.Permission != 3:
            normal_user.Permission = 3
            db.commit()
            print("[SEED] 일반 사용자 권한 3으로 업데이트")

        # ── 일반 사용자 기본 메뉴 권한 시드 ──
        if normal_user:
            USER_DEFAULT_MENUS = [
                "dashboard", "schedule-list",
                "video", "statistics",
                "alert-total", "alert-schedule", "alert-robot", "alert-notice",
            ]
            existing_user_perms = {
                r.MenuId for r in
                db.query(UserPermission.MenuId).filter(UserPermission.UserId == normal_user.id).all()
            }
            if not key_to_id:
                key_to_id = {r.MenuKey: r.id for r in db.query(MenuInfo).all()}
            added_user = 0
            for menu_key in USER_DEFAULT_MENUS:
                menu_id = key_to_id.get(menu_key)
                if menu_id and menu_id not in existing_user_perms:
                    db.add(UserPermission(UserId=normal_user.id, MenuId=menu_id))
                    added_user += 1
            if added_user:
                db.commit()
                print(f"[OK] 일반 사용자 메뉴 권한 {added_user}개 추가")

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

        # ── 기존 로봇 중 모듈 미등록분에 내장 카메라 시드 ──
        DEFAULT_BUILT_IN_CAMERAS = {
            "QUADRUPED": [("전방", "/video1"), ("후방", "/video2")],
            "AMR":       [("전방", "/video1")],
            "HUMANOID":  [("전방", "/video1"), ("후방", "/video2")],
            "COBOT":     [],
        }
        all_robots_for_seed = db.query(RobotInfo).filter(RobotInfo.DeletedAt.is_(None)).all()
        seeded_count = 0
        for r in all_robots_for_seed:
            has_modules = db.query(RobotModule).filter(RobotModule.RobotId == r.id).first()
            if has_modules:
                continue
            cams = DEFAULT_BUILT_IN_CAMERAS.get(r.RobotType or "", [])
            for idx, (label, path) in enumerate(cams):
                mod = RobotModule(
                    RobotId=r.id, ModuleType="camera", Label=label,
                    IsBuiltIn=1, SortOrder=idx,
                )
                db.add(mod)
                db.flush()
                db.add(ModuleCameraInfo(ModuleId=mod.id, StreamType="rtsp", Port=8554, Path=path))
            if cams:
                seeded_count += 1
        if seeded_count:
            db.commit()
            print(f"[OK] 기존 로봇 {seeded_count}대에 내장 카메라 모듈 시드 완료")

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


@app.on_event("shutdown")
def shutdown_event():
    from app.recording.manager import stop_all
    stop_all()


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
    print(f"[LISTEN] 위치 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    while True:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.0)
        try:
            msg = json.dumps({"action": "POSITION"}).encode("utf-8")
            sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))

            data, addr = sock.recvfrom(4096)
            pos = json.loads(data.decode("utf-8"))

            if pos.get("timestamp", 0) > 0:
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    runtime.update_position(rid, pos["x"], pos["y"], pos["yaw"])

        except socket.timeout:
            pass
        except Exception as e:
            print("[ERR POS]", e)
            log_event("error", "position_recv_error", "로봇 위치 수신 실패",
                      error_json=str(e),
                      robot_id=get_robot_id(), robot_name=get_robot_name())
        finally:
            sock.close()

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


_was_online: dict[int, bool] = {}  # robot_id → 이전 온라인 상태

def _try_status_once() -> dict | None:
    """STATUS 요청 1회 시도. 성공 시 응답 dict, 실패 시 None."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(2.0)
    try:
        msg = json.dumps({"action": "STATUS"}).encode("utf-8")
        sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))
        data, addr = sock.recvfrom(8192)
        return json.loads(data.decode("utf-8"))
    except socket.timeout:
        return None
    except Exception as e:
        print("[ERR STATUS]", e)
        return None
    finally:
        sock.close()


RETRY_COUNT = 3          # 실패 시 즉시 재시도 횟수
RETRY_INTERVAL = 0.5     # 재시도 간격(초)
ERROR_THRESHOLD = 3      # Error 상태 전환 기준 (연속 실패 횟수)
OFFLINE_THRESHOLD = 10   # Offline 확정 기준 (연속 실패 횟수)


def status_thread():
    """receiver.py 경유로 배터리 상태 폴링 + 온라인/오프라인 전환 로그"""
    print(f"[LISTEN] 상태 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    fail_count = 0

    _hb_count = 0
    while True:
        # 1차 시도 + 실패 시 즉시 재시도
        resp = _try_status_once()
        if resp is None:
            for _ in range(RETRY_COUNT):
                time.sleep(RETRY_INTERVAL)
                resp = _try_status_once()
                if resp is not None:
                    break

        success = False
        if resp is not None:
            battery = resp.get("BatteryStatus", {})
            charge_state = resp.get("ChargeStatus")
            device_temp = resp.get("DeviceTemperature", {})
            if battery:
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    runtime.update_status(rid, battery, time.time(), charge_state=charge_state, device_temp=device_temp)
                    success = True
                    fail_count = 0

                    # 오프라인 → 온라인 전환 감지
                    if not _was_online.get(rid, False):
                        _was_online[rid] = True
                        log_event("robot", "robot_online", "로봇 온라인",
                                  robot_id=get_robot_id(), robot_name=get_robot_name())

        if not success:
            fail_count += 1

            # Error 기준 도달 시 로그 (최초 1회)
            if fail_count == ERROR_THRESHOLD:
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    log_event("error", "robot_connection_error", "로봇 통신 연결 불안정",
                              error_json=f"연속 {fail_count}회 실패",
                              robot_id=get_robot_id(), robot_name=get_robot_name())

            # Offline 확정
            if fail_count >= OFFLINE_THRESHOLD:
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None and _was_online.get(rid, False):
                    _was_online[rid] = False
                    log_event("robot", "robot_offline", "로봇 오프라인",
                              robot_id=get_robot_id(), robot_name=get_robot_name())

        time.sleep(REQ_INTERVAL_HB)


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
NEAR_SKIP_DISTANCE = 0.5   # 목표 웨이포인트까지 이 거리(m) 이내면 이미 도착으로 간주

def nav_thread():
    last_status = None
    ever_moved = False      # 현재 WP에서 이동(!=0)을 한 번이라도 감지했는지
    zero_count = 0          # status==0 연속 카운트
    pause_since = 0         # 255 연속 시작 시간
    last_stand_sent = 0     # 마지막 STAND 전송 시간
    retry_count = 0

    print(f"[LISTEN] 네비 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    while True:
        arrived = False

        # ── 리셋 신호 감지 (새 주행 시작 / 정지 / 다음 WP 전송 시) ──
        reset, is_full = check_and_clear_reset_flag()
        if reset:
            last_status = None
            ever_moved = False
            zero_count = 0
            pause_since = 0
            last_stand_sent = 0
            if is_full:
                retry_count = 0
            print(f"[NAV] 상태 리셋 (last_status=None, full={is_full})")

        # ── 상태 기반 도착 감지 ──
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(1.5)
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
                    print(f"[SYNC] NAV 상태 변화: {last_status} → {status}")

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
                    from app.navigation.send_move import current_wp_index, waypoints_list
                    wp_name = waypoints_list[current_wp_index - 1].get("name", f"WP{current_wp_index}") if current_wp_index > 0 else f"WP{current_wp_index}"
                    log_event("schedule", "nav_arrival",
                              f"{wp_name} 도착 ({current_wp_index}/{len(waypoints_list)})",
                              robot_id=get_robot_id(), robot_name=get_robot_name())

                # 이동 미감지: status=0이 지속될 때 처리
                sent_time = get_nav_sent_time()
                elapsed = time.time() - sent_time if sent_time > 0 else 0
                if (not arrived and not ever_moved
                        and zero_count >= ARRIVAL_CONFIRM_COUNT
                        and is_nav_active() and cooldown_ok):
                    # 이미 목표 근처에 있으면 바로 도착 처리 (재전송 불필요)
                    target = get_current_target()
                    if target:
                        rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                        pos = runtime.get_position(rid) if rid else {"x": 0, "y": 0}
                        dx = pos["x"] - target["x"]
                        dy = pos["y"] - target["y"]
                        dist = (dx**2 + dy**2) ** 0.5
                        if dist < NEAR_SKIP_DISTANCE:
                            arrived = True
                            print(f"[OK] NAV 이미 목표 근처 (거리={dist:.2f}m < {NEAR_SKIP_DISTANCE}m) — 다음 WP로 진행")

                    # 목표와 멀면 재전송 (5초 대기 후)
                    if not arrived and elapsed >= 5.0:
                        if retry_count < NAV_MAX_RETRIES:
                            retry_count += 1
                            print(f"[WARN] NAV 이동 미감지 — 재전송 ({retry_count}/{NAV_MAX_RETRIES})")
                            try:
                                navigation_resend_current()
                            except Exception as e:
                                print(f"[ERR] 재전송 실패: {e}")
                        else:
                            arrived = True
                            print(f"[WARN] NAV 이동 미감지 — 재전송 한도 초과, 다음 WP로 진행")

                # 충전 중 여부 확인
                _rid_for_charge = runtime.get_robot_id_by_ip(ROBOT_IP)
                _is_charging = runtime.is_charging(_rid_for_charge) if _rid_for_charge else False

                # 일시 정지(255) 추적 + 앉기 방지
                if status == 255:
                    if pause_since == 0:
                        pause_since = time.time()
                    # 5초마다 STAND 전송하여 앉기 방지 (충전 중이면 스킵)
                    if is_nav_active() and not _is_charging and (time.time() - last_stand_sent) >= 5.0:
                        last_stand_sent = time.time()
                        try:
                            from app.robot_sender import send_to_robot
                            send_to_robot("STAND")
                        except Exception as e:
                            print(f"[ERR] STAND 전송 실패: {e}")
                    elif _is_charging:
                        print(f"[NAV] 충전 중 — STAND 전송 스킵")
                else:
                    pause_since = 0

                # 일시 정지(255): 연속 10초 이상 지속 시 현재 WP 재전송 (충전 중이면 스킵)
                if (not arrived and status == 255 and pause_since > 0
                        and is_nav_active() and cooldown_ok
                        and not _is_charging
                        and (time.time() - pause_since) >= 10.0
                        and retry_count < NAV_MAX_RETRIES):
                    retry_count += 1
                    pause_since = time.time()  # 재전송 후 타이머 리셋
                    print(f"[WARN] NAV 일시정지(255) 연속 10초 지속 — 재전송 ({retry_count}/{NAV_MAX_RETRIES})")
                    try:
                        navigation_resend_current()
                    except Exception as e:
                        print(f"[ERR] 재전송 실패: {e}")

                # 재전송: 전송 후 N초 지났는데 이동을 한 번도 안 했으면 명령 재전송 (충전 중이면 스킵)
                if (is_nav_active() and not ever_moved and not arrived
                        and sent_time > 0
                        and not _is_charging
                        and (time.time() - sent_time) > NAV_RETRY_TIMEOUT
                        and retry_count < NAV_MAX_RETRIES):
                    retry_count += 1
                    print(f"[WARN] NAV 재전송 시도 ({retry_count}/{NAV_MAX_RETRIES}) — {NAV_RETRY_TIMEOUT}초 내 이동 미감지")
                    try:
                        navigation_resend_current()
                    except Exception as e:
                        print(f"[ERR] 재전송 실패: {e}")

                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    runtime.update_nav(rid, False, status, time.time())
                last_status = status

        except socket.timeout:
            if is_nav_active():
                print("[NAV DEBUG] NAV_STATUS 응답 타임아웃")
        except Exception as e:
            print("[ERR NAV]", e)
            from app.navigation.send_move import current_wp_index as err_wp_idx, waypoints_list as err_wp_list
            err_route = " → ".join(wp.get("name", f"WP{i+1}") for i, wp in enumerate(err_wp_list)) if err_wp_list else ""
            err_detail = f"중단 지점: WP{err_wp_idx}/{len(err_wp_list)}"
            if err_route:
                err_detail += f"\n경로: {err_route}"
            log_event("error", "nav_error", "네비게이션 오류 발생",
                      detail=err_detail, error_json=str(e),
                      robot_id=get_robot_id(), robot_name=get_robot_name())
        finally:
            if sock:
                try: sock.close()
                except: pass

        if arrived and is_nav_active():
            rid = runtime.get_robot_id_by_ip(ROBOT_IP)
            if rid is not None:
                runtime.update_nav(rid, True, last_status, time.time())
            try:
                navigation_send_next()
                # 네비게이션이 완료되었으면 스케줄러 콜백 호출
                if not is_nav_active() and get_active_schedule_id() is not None:
                    on_navigation_complete()
            except Exception as e:
                print(f"[ERR] navigation_send_next 실패: {e}")
                err_route2 = " → ".join(wp.get("name", f"WP{j+1}") for j, wp in enumerate(waypoints_list)) if waypoints_list else ""
                err_detail2 = f"중단 지점: WP{current_wp_index}/{len(waypoints_list)}"
                if err_route2:
                    err_detail2 += f"\n경로: {err_route2}"
                log_event("error", "nav_error", "다음 웨이포인트 이동 실패",
                          detail=err_detail2, error_json=str(e),
                          robot_id=get_robot_id(), robot_name=get_robot_name())
                if get_active_schedule_id() is not None:
                    on_navigation_error(str(e))

        time.sleep(NAV_POLL_INTERVAL)


# ======================================================
# Thread 시작
# ======================================================
threading.Thread(target=position_thread, daemon=True).start()
threading.Thread(target=status_thread, daemon=True).start()
threading.Thread(target=nav_thread, daemon=True).start()
threading.Thread(target=scheduler_thread, daemon=True).start()


# ======================================================
# API
# ======================================================
@app.get("/robot/position")
def get_pos():
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    if rid is None:
        return {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}
    return runtime.get_position(rid)

@app.post("/robot/initpose")
def init_pose():
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    before = runtime.get_position(rid) if rid else {}
    send_init_pose()
    after = runtime.get_position(rid) if rid else {}
    return {
        "status": "ok",
        "before": before,
        "after": after,
        "msg": f"초기 위치 설정 완료: {INIT_POSE}"
    }

@app.get("/robot/status")
def get_status():
    return runtime.get_all_statuses()

@app.get("/robot/nav")
def get_nav():
    from app.navigation.send_move import is_navigating, current_wp_index, waypoints_list, nav_loop_remaining
    return {
        "is_navigating": is_navigating,
        "current_wp": current_wp_index,
        "total_wp": len(waypoints_list),
        "loop_remaining": nav_loop_remaining,
    }


@app.post("/robot/charge")
def start_charge():
    """충전소로 이동 (자동 충전) 명령 전송."""
    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {
                "Charge": 1
            }
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        log_event("robot", "robot_charging_start", "충전소 이동 명령 전송",
                  robot_id=get_robot_id(), robot_name=get_robot_name())
        return {"status": "ok", "msg": "충전소 이동 명령 전송 완료"}
    except Exception as e:
        return {"status": "error", "msg": str(e)}
    finally:
        sock.close()


@app.post("/robot/return-to-charge")
def return_to_charge():
    """작업 복귀: 진행 중인 작업 정지 → 도킹 포인트로 이동 → 도착 후 충전 명령 자동 실행."""
    from app.Database.database import SessionLocal
    from app.Database.models import LocationInfo
    from app.navigation.send_move import (
        navigation_send_next, _signal_nav_reset,
    )
    import app.navigation.send_move as nav
    from app.robot_sender import send_to_robot

    db = SessionLocal()
    try:
        # 충전소(category=charge) 찾기 → 도킹 포인트는 "{충전소이름}-1"
        charge_station = (
            db.query(LocationInfo)
            .filter(LocationInfo.Category == "charge")
            .first()
        )
        if not charge_station:
            return {"status": "error", "msg": "등록된 충전소가 없습니다."}

        dock_name = f"{charge_station.LacationName}-1"
        dock_point = (
            db.query(LocationInfo)
            .filter(LocationInfo.LacationName == dock_name)
            .first()
        )
        if not dock_point:
            return {"status": "error", "msg": f"도킹 포인트 '{dock_name}'을(를) 찾을 수 없습니다."}

        # 1) 진행 중인 스케줄 취소 (대기로 되돌림)
        from app.scheduler.engine import cancel_active_schedule
        if get_active_schedule_id() is not None:
            cancel_active_schedule("충전소 이동")

        # 2) 진행 중인 네비게이션 정지
        if nav.is_navigating:
            nav.is_navigating = False
            nav.current_wp_index = 0
            nav.nav_loop_remaining = 0
            nav.charge_on_arrival = False
            _signal_nav_reset(full=True)
            print("🛑 작업 복귀: 기존 네비게이션 정지")

        # 2) 로봇 정지 명령
        try:
            send_to_robot("STOP")
        except Exception as e:
            print(f"[WARN] STOP 전송 실패: {e}")

        time.sleep(1)  # 로봇 정지 대기

        # 3) 도킹 포인트로 네비게이션 + 도착 후 자동 충전 플래그
        nav.waypoints_list = [{
            "x": dock_point.LocationX,
            "y": dock_point.LocationY,
            "yaw": dock_point.Yaw or 0.0,
        }]
        nav.current_wp_index = 0
        nav.is_navigating = True
        nav.nav_loop_remaining = 0
        nav.charge_on_arrival = True
        _signal_nav_reset(full=True)

        print(f"🔋 작업 복귀: {dock_name} → x={dock_point.LocationX}, y={dock_point.LocationY}")
        log_event("schedule", "return_to_charge",
                  f"작업 복귀 시작: {dock_name}(으)로 이동",
                  robot_id=get_robot_id(), robot_name=get_robot_name())

        navigation_send_next()
        return {
            "status": "ok",
            "msg": f"{dock_name}(으)로 이동 시작 (도착 후 자동 충전)",
            "dock_point": dock_name,
            "charge_station": charge_station.LacationName,
        }
    finally:
        db.close()


@app.get("/robot/return-to-work/info")
def get_return_to_work_info():
    """작업 복귀 가능 여부 + 대상 경로 정보 반환"""
    from app.Database.database import SessionLocal
    from app.Database.models import LocationInfo, WayInfo, ScheduleInfo
    import app.navigation.send_move as nav

    from app.scheduler.engine import get_active_schedule_id

    source = None       # "active" | "recent"
    way_name = None
    origin_name = None
    waypoint_names = []
    schedule_name = None

    # 1) 현재 진행 중인 네비게이션 또는 활성 스케줄
    active_schedule_id = get_active_schedule_id()
    is_active = nav.is_navigating or active_schedule_id is not None

    if is_active and nav.waypoints_list:
        source = "active"
        waypoint_names = [wp.get("name", f"({wp['x']:.1f},{wp['y']:.1f})") for wp in nav.waypoints_list]
        origin_name = waypoint_names[0]
        if active_schedule_id:
            db = SessionLocal()
            try:
                sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == active_schedule_id).first()
                if sched:
                    way_name = sched.WayName
                    schedule_name = sched.WorkName
            finally:
                db.close()

    # 활성 스케줄은 있지만 waypoints_list가 비어있는 경우 — DB에서 경로 조회
    if is_active and not waypoint_names and active_schedule_id:
        db = SessionLocal()
        try:
            sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == active_schedule_id).first()
            if sched and sched.WayName:
                path = db.query(WayInfo).filter(WayInfo.WayName == sched.WayName).first()
                if path:
                    place_names = [n.strip() for n in path.WayPoints.split(" - ")]
                    valid_names = []
                    for name in place_names:
                        if db.query(LocationInfo).filter(LocationInfo.LacationName == name).first():
                            valid_names.append(name)
                    if valid_names:
                        source = "active"
                        way_name = sched.WayName
                        schedule_name = sched.WorkName
                        waypoint_names = valid_names
                        origin_name = valid_names[0]
        finally:
            db.close()

    # 2) DB에서 "진행중" 상태 스케줄 확인
    if not source:
        db = SessionLocal()
        try:
            running = (
                db.query(ScheduleInfo)
                .filter(ScheduleInfo.TaskStatus == "진행중")
                .order_by(ScheduleInfo.LastRunDate.desc())
                .first()
            )
            if running and running.WayName:
                path = db.query(WayInfo).filter(WayInfo.WayName == running.WayName).first()
                if path:
                    place_names = [n.strip() for n in path.WayPoints.split(" - ")]
                    valid_names = []
                    for name in place_names:
                        if db.query(LocationInfo).filter(LocationInfo.LacationName == name).first():
                            valid_names.append(name)
                    if valid_names:
                        source = "active"
                        way_name = running.WayName
                        schedule_name = running.WorkName
                        waypoint_names = valid_names
                        origin_name = valid_names[0]
        finally:
            db.close()

    # 3) 최근 실행된 스케줄 경로
    if not source:
        db = SessionLocal()
        try:
            recent = (
                db.query(ScheduleInfo)
                .filter(ScheduleInfo.LastRunDate.isnot(None))
                .order_by(ScheduleInfo.LastRunDate.desc())
                .first()
            )
            if recent and recent.WayName:
                path = db.query(WayInfo).filter(WayInfo.WayName == recent.WayName).first()
                if path:
                    place_names = [n.strip() for n in path.WayPoints.split(" - ")]
                    valid = True
                    for name in place_names:
                        if not db.query(LocationInfo).filter(LocationInfo.LacationName == name).first():
                            valid = False
                            break
                    if valid and place_names:
                        source = "recent"
                        way_name = recent.WayName
                        schedule_name = recent.WorkName
                        waypoint_names = place_names
                        origin_name = place_names[0]
        finally:
            db.close()

    if not source:
        return {"available": False, "msg": "복귀할 경로가 없습니다."}

    return {
        "available": True,
        "source": source,
        "source_label": "진행 중인 작업" if source == "active" else "최근 작업",
        "retrace_available": source == "active" and nav.is_navigating and nav.current_wp_index > 0,
        "schedule_name": schedule_name,
        "way_name": way_name,
        "origin": origin_name,
        "waypoints": waypoint_names,
    }


@app.post("/robot/return-to-work")
def return_to_work(mode: str = "direct"):
    """
    작업 복귀: 가장 최근 경로의 출발 지점으로 복귀.
    - mode="direct": 자율 주행 (출발 지점으로 직접 이동)
    - mode="retrace": 경로 역주행 (현재 위치에서 경로를 거꾸로 따라감)
    """
    from app.Database.database import SessionLocal
    from app.Database.models import LocationInfo, WayInfo, ScheduleInfo
    from app.navigation.send_move import (
        navigation_send_next, _signal_nav_reset,
    )
    import app.navigation.send_move as nav
    from app.robot_sender import send_to_robot
    from app.scheduler.engine import cancel_active_schedule, get_active_schedule_id

    # 현재 진행 중인 경로가 있으면 그것을 사용, 없으면 가장 최근 실행된 스케줄의 경로
    waypoints_snapshot = list(nav.waypoints_list) if nav.waypoints_list else []
    wp_index_snapshot = nav.current_wp_index  # 정지 전에 인덱스 저장
    way_name = None

    if not waypoints_snapshot:
        # 가장 최근 실행된 스케줄에서 경로 조회
        db = SessionLocal()
        try:
            recent = (
                db.query(ScheduleInfo)
                .filter(ScheduleInfo.LastRunDate.isnot(None))
                .order_by(ScheduleInfo.LastRunDate.desc())
                .first()
            )
            if recent and recent.WayName:
                way_name = recent.WayName
                path = db.query(WayInfo).filter(WayInfo.WayName == way_name).first()
                if path:
                    place_names = [n.strip() for n in path.WayPoints.split(" - ")]
                    for name in place_names:
                        place = db.query(LocationInfo).filter(LocationInfo.LacationName == name).first()
                        if place:
                            waypoints_snapshot.append({
                                "x": place.LocationX,
                                "y": place.LocationY,
                                "yaw": place.Yaw or 0.0,
                                "name": place.LacationName,
                            })
        finally:
            db.close()

    if not waypoints_snapshot:
        return {"status": "error", "msg": "복귀할 경로가 없습니다. 최근 작업 이력이 없습니다."}

    # 출발 지점 = 경로의 첫 번째 웨이포인트
    origin = waypoints_snapshot[0]

    # 1) 진행 중인 스케줄 취소
    if get_active_schedule_id() is not None:
        cancel_active_schedule("작업 복귀")

    # 2) 진행 중인 네비게이션 정지
    if nav.is_navigating:
        nav.is_navigating = False
        nav.current_wp_index = 0
        nav.nav_loop_remaining = 0
        nav.charge_on_arrival = False
        _signal_nav_reset(full=True)

    # 3) 로봇 정지
    try:
        send_to_robot("STOP")
    except Exception as e:
        print(f"[WARN] STOP 전송 실패: {e}")

    time.sleep(1)

    if mode == "retrace":
        # 경로 역주행: 현재 웨이포인트 위치부터 역순으로 출발 지점까지
        # 현재 진행 중이었던 인덱스 기준으로 지나온 경로를 역순 생성
        # wp_index_snapshot은 전송 후 +1된 값이므로 -1 해서 현재 향하던 포인트 제외
        wp_index = min(wp_index_snapshot, len(waypoints_snapshot))
        passed = max(wp_index - 1, 0)  # 실제 도착 완료한 포인트까지
        retrace_wps = list(reversed(waypoints_snapshot[:max(passed, 1)]))

        # yaw를 역방향으로 재계산
        for i in range(len(retrace_wps)):
            if i < len(retrace_wps) - 1:
                nx = retrace_wps[i + 1]["x"]
                ny = retrace_wps[i + 1]["y"]
                retrace_wps[i]["yaw"] = round(math.atan2(ny - retrace_wps[i]["y"], nx - retrace_wps[i]["x"]), 3)

        nav.waypoints_list = retrace_wps
        route_desc = " → ".join(wp.get("name", f"({wp['x']:.1f},{wp['y']:.1f})") for wp in retrace_wps)
        print(f"🔙 작업 복귀 (역주행): {len(retrace_wps)}개 포인트 — {route_desc}")
    else:
        # 자율 주행: 출발 지점으로 직접 이동
        nav.waypoints_list = [origin]
        print(f"🔙 작업 복귀 (자율주행): {origin.get('name', '')} → x={origin['x']}, y={origin['y']}")

    nav.current_wp_index = 0
    nav.is_navigating = True
    nav.nav_loop_remaining = 0
    nav.charge_on_arrival = False
    _signal_nav_reset(full=True)

    mode_label = "경로 역주행" if mode == "retrace" else "자율 주행"
    origin_name = origin.get("name", f"({origin['x']:.1f}, {origin['y']:.1f})")
    log_event("schedule", "return_to_work",
              f"작업 복귀 시작 ({mode_label}): {origin_name}(으)로 이동",
              robot_id=get_robot_id(), robot_name=get_robot_name())

    navigation_send_next()
    return {
        "status": "ok",
        "msg": f"작업 복귀 시작 ({mode_label}) → {origin_name}",
        "mode": mode,
        "origin": origin_name,
    }


@app.post("/robot/test-error/{error_code}")
def test_robot_error(error_code: str):
    """로봇 에러 코드 알림 테스트 (예: /robot/test-error/0xA302)"""
    global _last_logged_error_code

    code = int(error_code, 16) if error_code.startswith("0x") else int(error_code)
    error_hex = f"0x{code:04X}"
    error_msg = ROBOT_ERROR_CODES.get(code, f"알 수 없는 에러 ({error_hex})")

    if error_msg is None:
        return {"status": "skip", "msg": "정상 코드 (0x0000)"}

    _last_logged_error_code = code
    log_event("error", "robot_error_code",
              f"로봇 에러: {error_msg}",
              error_json=json.dumps({"error_code": error_hex, "test": True}, ensure_ascii=False),
              robot_id=get_robot_id(), robot_name=get_robot_name())

    return {"status": "ok", "error_code": error_hex, "message": error_msg}

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
