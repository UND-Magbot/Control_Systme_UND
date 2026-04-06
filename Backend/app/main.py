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
from app.Database.models import BusinessInfo, AreaInfo, RobotMapInfo, RobotModule, ModuleCameraInfo, RobotInfo
from app.logs.routes import router as log_router
from app.alerts.routes import router as alert_router
from app.notices.routes import router as notice_router
from app.businesses.routes import router as business_router
from app.auth.routes import router as auth_router
from app.users.routes import router as users_router
from app.backup.routes import router as backup_router
from app.statistics.routes import router as statistics_router
from app.logs.service import log_event
from app.robot_sender import send_to_robot
from app.navigation.send_move import (
    navigation_send_next, navigation_resend_current,
    is_nav_active, get_current_target, get_nav_sent_time, check_and_clear_reset_flag,
    current_wp_index, waypoints_list, nav_loop_remaining
)

import os
import time
import threading
import socket
import json
import struct
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


# ======================================================
# MJPEG
# ======================================================
def rtsp_to_mjpeg(rtsp_url):
    cap = cv2.VideoCapture(rtsp_url)
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
INIT_POSE = {"PosX": 3.635, "PosY": 0.144, "PosZ": 0.0, "Yaw": -0.042}

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
    print(f"🚀 [INIT_POSE] 전송 완료 → {ROBOT_IP}:{ROBOT_PORT} | {INIT_POSE}")

    # 3) 3초 후 위치 다시 확인
    time.sleep(3)
    after = runtime.get_position(rid) if rid else {}
    print(f"📍 [INIT_POSE] 전송 후 위치: x={after.get('x')}, y={after.get('y')}, yaw={after.get('yaw')}")

    dx = abs(after.get("x", 0) - before.get("x", 0))
    dy = abs(after.get("y", 0) - before.get("y", 0))
    if dx > 0.01 or dy > 0.01:
        print(f"✅ [INIT_POSE] 위치 변화 감지! dx={dx:.3f}, dy={dy:.3f} → 적용 성공")
    else:
        print(f"⚠️ [INIT_POSE] 위치 변화 없음 (dx={dx:.3f}, dy={dy:.3f}) → 적용 안 됐을 수 있음")


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
        print("🔄 기존 DB 감지 — user_info 컬럼 마이그레이션 실행 중...")
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
        print("✅ user_info 컬럼 마이그레이션 완료")

    # robot_info 테이블에 RobotType, RobotIP, RobotPort 컬럼 추가
    if "robot_info" in inspector.get_table_names():
        robot_cols = {col["name"] for col in inspector.get_columns("robot_info")}
        if "RobotType" not in robot_cols:
            print("🔄 robot_info 컬럼 마이그레이션 실행 중...")
            with engine.begin() as conn:
                conn.execute(text("""
                    ALTER TABLE robot_info
                      ADD COLUMN RobotType VARCHAR(20) NULL AFTER RobotName,
                      ADD COLUMN RobotIP VARCHAR(45) NULL AFTER RobotType,
                      ADD COLUMN RobotPort INT NULL DEFAULT 30000 AFTER RobotIP
                """))
            print("✅ robot_info 컬럼 마이그레이션 완료 (RobotType, RobotIP, RobotPort)")

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
                    print(f"🔄 robot_info 밀린 데이터 {len(rows)}건 복원 중...")
                    for row in rows:
                        conn.execute(_t(
                            "UPDATE robot_info SET Adddate = :date_val, LimitBattery = 22, BusinessId = 1 "
                            "WHERE id = :rid"
                        ), {"date_val": str(row[2]), "rid": row[0]})
                    print("✅ robot_info 데이터 복원 완료")

        # Adddate(VARCHAR) → CreatedAt/UpdatedAt/DeletedAt(DATETIME) 마이그레이션
        robot_cols = {col["name"] for col in inspector.get_columns("robot_info")}
        if "Adddate" in robot_cols and "CreatedAt" not in robot_cols:
            print("🔄 robot_info Adddate → CreatedAt/UpdatedAt/DeletedAt 마이그레이션 중...")
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
            print("✅ robot_info Adddate → CreatedAt/UpdatedAt/DeletedAt 완료")

    # business_info Adddate → CreatedAt/UpdatedAt/DeletedAt 마이그레이션
    if "business_info" in inspector.get_table_names():
        biz_cols = {col["name"] for col in inspector.get_columns("business_info")}
        if "Adddate" in biz_cols and "CreatedAt" not in biz_cols:
            print("🔄 business_info Adddate → CreatedAt/UpdatedAt/DeletedAt 마이그레이션 중...")
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
            print("✅ business_info Adddate → CreatedAt/UpdatedAt/DeletedAt 완료")

    # area_info Adddate → CreatedAt 마이그레이션
    if "area_info" in inspector.get_table_names():
        area_cols = {col["name"] for col in inspector.get_columns("area_info")}
        if "Adddate" in area_cols and "CreatedAt" not in area_cols:
            print("🔄 area_info Adddate → CreatedAt 마이그레이션 중...")
            with engine.begin() as conn:
                conn.execute(text("""
                    ALTER TABLE area_info
                      ADD COLUMN CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER FloorName
                """))
                conn.execute(text("""
                    UPDATE area_info
                    SET CreatedAt = CASE
                        WHEN Adddate IS NOT NULL THEN Adddate
                        ELSE CURRENT_TIMESTAMP
                    END
                """))
                conn.execute(text("ALTER TABLE area_info DROP COLUMN Adddate"))
            print("✅ area_info Adddate → CreatedAt 완료")

    # user_permission 테이블이 기존 VARCHAR MenuId로 존재하면 재생성
    if "user_permission" in inspector.get_table_names():
        up_cols = {col["name"]: col for col in inspector.get_columns("user_permission")}
        menu_id_col = up_cols.get("MenuId")
        if menu_id_col and str(menu_id_col["type"]).startswith("VARCHAR"):
            print("🔄 user_permission 테이블 VARCHAR→INT FK 마이그레이션 중...")
            with engine.begin() as conn:
                conn.execute(text("DROP TABLE user_permission"))
            print("✅ 기존 user_permission 삭제 (create_all에서 재생성)")


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
        ("business-list",    "사업자 목록", "robot-mgmt",      2),
        ("map-management",   "맵 관리",     None,              4),
        ("place-list",       "장소 목록",   "map-management",  1),
        ("path-list",        "경로 목록",   "map-management",  2),
        ("data-mgmt",        "데이터관리",  None,              5),
        ("video",            "영상",        "data-mgmt",       1),
        ("statistics",       "통계",        "data-mgmt",       2),
        ("log",              "로그",        "data-mgmt",       3),
        ("alerts",           "알림",        None,              6),
        ("alert-total",      "전체",        "alerts",          1),
        ("alert-schedule",   "작업일정",    "alerts",          2),
        ("alert-emergency",  "긴급사항",    "alerts",          3),
        ("alert-robot",      "로봇상태",    "alerts",          4),
        ("alert-notice",     "공지사항",    "alerts",          5),
        ("settings",         "설정",        None,              7),
        ("menu-permissions", "메뉴 권한",   "settings",        1),
        ("password-change",  "비밀번호 변경","settings",        2),
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
        print(f"✅ 메뉴 마스터 {len(MENU_SEED)}개 시드 완료")
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
            print(f"✅ 메뉴 마스터 {len(new_menus)}개 추가")

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
            print(f"✅ 메뉴 마스터 동기화: {updated}개 수정, {removed}개 삭제")

    try:
        # ── 관리자 계정 시드 ──
        admin_user = db.query(UserInfo).filter(UserInfo.UserName == "관리자").first()
        if admin_user and not admin_user.LoginId:
            admin_user.LoginId = "admin"
            admin_user.Password = hash_password("admin1234!")
            admin_user.Permission = 1
            admin_user.IsActive = 1
            db.commit()
            print("✅ 기존 '관리자' 계정에 admin/admin1234! 매칭 완료")
        elif not admin_user:
            new_admin = UserInfo(
                Permission=1,
                UserName="관리자",
                LoginId="admin",
                Password=hash_password("admin1234!"),
                IsActive=1,
            )
            db.add(new_admin)
            db.commit()
            admin_user = new_admin
            print("✅ 기본 관리자 계정 생성 완료 (admin/admin1234!)")

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
                    print(f"✅ 관리자 메뉴 권한 {added}개 추가")

        # ── 일반 사용자 계정 시드 ──
        normal_user = db.query(UserInfo).filter(UserInfo.LoginId == "user").first()
        if not normal_user:
            normal_user = UserInfo(
                Permission=2,
                UserName="사용자",
                LoginId="user",
                Password=hash_password("user1234!"),
                IsActive=1,
            )
            db.add(normal_user)
            db.commit()
            print("✅ 일반 사용자 계정 생성 완료 (user/user1234!)")

        # ── 일반 사용자 기본 메뉴 권한 시드 (설정 제외) ──
        if normal_user:
            USER_DEFAULT_MENUS = [
                "dashboard",
                "schedule-list",
                "robot-list", "business-list",
                "map-management", "place-list", "path-list",
                "video", "statistics", "log",
                "alert-total", "alert-schedule", "alert-emergency", "alert-robot", "alert-notice",
                "password-change",
            ]
            existing_user_perms = {
                r.MenuId for r in
                db.query(UserPermission.MenuId).filter(UserPermission.UserId == normal_user.id).all()
            }
            key_to_id = {r.MenuKey: r.id for r in db.query(MenuInfo).all()}
            added_user = 0
            for menu_key in USER_DEFAULT_MENUS:
                menu_id = key_to_id.get(menu_key)
                if menu_id and menu_id not in existing_user_perms:
                    db.add(UserPermission(UserId=normal_user.id, MenuId=menu_id))
                    added_user += 1
            if added_user:
                db.commit()
                print(f"✅ 일반 사용자 메뉴 권한 {added_user}개 추가")

        # 사용자 캐싱 (기존 호환)
        user = db.query(UserInfo).order_by(UserInfo.id.asc()).first()
        if user:
            cached_user["id"] = user.id
            cached_user["UserName"] = user.UserName
            print(f"✅ 현재 사용자: {cached_user['UserName']} (id={cached_user['id']})")

        # robot_info에서 첫 번째 로봇 캐싱
        robot = db.query(RobotInfo).order_by(RobotInfo.id.asc()).first()
        if robot:
            cached_robot["id"] = robot.id
            cached_robot["RobotName"] = robot.RobotName
            print(f"✅ 현재 로봇: {cached_robot['RobotName']} (id={cached_robot['id']})")

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
            print(f"✅ 기존 로봇 {seeded_count}대에 내장 카메라 모듈 시드 완료")

        # 전체 로봇 런타임 상태 초기화
        all_robots = db.query(RobotInfo).order_by(RobotInfo.id.asc()).all()
        runtime.init_runtime(all_robots)
    finally:
        db.close()

    time.sleep(2)
    # send_init_pose()
    log_event("system", "system_startup", "서버 시작")


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
    print(f"📡 위치 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

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
            log_event("error", "position_recv_error", f"로봇 위치 수신 오류: {e}",
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

def status_thread():
    """receiver.py 경유로 배터리 상태 폴링 + 온라인/오프라인 전환 로그"""
    print(f"📡 상태 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

    fail_count = 0

    while True:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.0)
        success = False
        try:
            msg = json.dumps({"action": "STATUS"}).encode("utf-8")
            sock.sendto(msg, (RECEIVER_IP, RECEIVER_PORT))

            data, addr = sock.recvfrom(8192)
            resp = json.loads(data.decode("utf-8"))

            battery = resp.get("BatteryStatus", {})
            if battery:
                rid = runtime.get_robot_id_by_ip(ROBOT_IP)
                if rid is not None:
                    runtime.update_status(rid, battery, time.time())
                    success = True
                    fail_count = 0

                    # 오프라인 → 온라인 전환 감지
                    if not _was_online.get(rid, False):
                        _was_online[rid] = True
                        log_event("robot", "robot_online", "로봇 온라인",
                                  robot_id=get_robot_id(), robot_name=get_robot_name())

        except socket.timeout:
            fail_count += 1
        except Exception as e:
            fail_count += 1
            print("[ERR STATUS]", e)
            log_event("error", "robot_connection_error", f"로봇 상태 수신 오류: {e}",
                      robot_id=get_robot_id(), robot_name=get_robot_name())
        finally:
            sock.close()

        # 연속 3회 실패 시 온라인 → 오프라인 전환 로그
        if not success and fail_count >= 3:
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
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(1.5)

    last_status = None
    ever_moved = False      # 현재 WP에서 이동(!=0)을 한 번이라도 감지했는지
    zero_count = 0          # status==0 연속 카운트
    pause_since = 0         # 255 연속 시작 시간
    last_stand_sent = 0     # 마지막 STAND 전송 시간
    retry_count = 0

    print(f"📡 네비 Listener 시작 (via receiver.py {RECEIVER_IP}:{RECEIVER_PORT})")

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
        try:
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
                    print(f"🔄 NAV 상태 변화: {last_status} → {status}")

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
                    log_event("schedule", "nav_arrival",
                              f"웨이포인트 {current_wp_index}/{len(waypoints_list)} 도착",
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
                        dx = robot_position["x"] - target["x"]
                        dy = robot_position["y"] - target["y"]
                        dist = (dx**2 + dy**2) ** 0.5
                        if dist < NEAR_SKIP_DISTANCE:
                            arrived = True
                            print(f"✅ NAV 이미 목표 근처 (거리={dist:.2f}m < {NEAR_SKIP_DISTANCE}m) — 다음 WP로 진행")

                    # 목표와 멀면 재전송 (5초 대기 후)
                    if not arrived and elapsed >= 5.0:
                        if retry_count < NAV_MAX_RETRIES:
                            retry_count += 1
                            print(f"⚠️ NAV 이동 미감지 — 재전송 ({retry_count}/{NAV_MAX_RETRIES})")
                            try:
                                navigation_resend_current()
                            except Exception as e:
                                print(f"[ERR] 재전송 실패: {e}")
                        else:
                            arrived = True
                            print(f"⚠️ NAV 이동 미감지 — 재전송 한도 초과, 다음 WP로 진행")

                # 일시 정지(255) 추적 + 앉기 방지
                if status == 255:
                    if pause_since == 0:
                        pause_since = time.time()
                    # 5초마다 STAND 전송하여 앉기 방지
                    if is_nav_active() and (time.time() - last_stand_sent) >= 5.0:
                        last_stand_sent = time.time()
                        try:
                            from app.robot_sender import send_to_robot
                            send_to_robot("STAND")
                        except Exception as e:
                            print(f"[ERR] STAND 전송 실패: {e}")
                else:
                    pause_since = 0

                # 일시 정지(255): 연속 5초 이상 지속 시 현재 WP 재전송
                if (not arrived and status == 255 and pause_since > 0
                        and is_nav_active() and cooldown_ok
                        and (time.time() - pause_since) >= 10.0
                        and retry_count < NAV_MAX_RETRIES):
                    retry_count += 1
                    pause_since = time.time()  # 재전송 후 타이머 리셋
                    print(f"⚠️ NAV 일시정지(255) 연속 10초 지속 — 재전송 ({retry_count}/{NAV_MAX_RETRIES})")
                    try:
                        navigation_resend_current()
                    except Exception as e:
                        print(f"[ERR] 재전송 실패: {e}")

                # 재전송: 전송 후 N초 지났는데 이동을 한 번도 안 했으면 명령 재전송
                if (is_nav_active() and not ever_moved and not arrived
                        and sent_time > 0
                        and (time.time() - sent_time) > NAV_RETRY_TIMEOUT
                        and retry_count < NAV_MAX_RETRIES):
                    retry_count += 1
                    print(f"⚠️ NAV 재전송 시도 ({retry_count}/{NAV_MAX_RETRIES}) — {NAV_RETRY_TIMEOUT}초 내 이동 미감지")
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
            log_event("error", "nav_error", f"네비게이션 오류: {e}",
                      robot_id=get_robot_id(), robot_name=get_robot_name())

        if arrived and is_nav_active():
            rid = runtime.get_robot_id_by_ip(ROBOT_IP)
            if rid is not None:
                runtime.update_nav(rid, True, last_status, time.time())
            try:
                navigation_send_next()
            except Exception as e:
                print(f"[ERR] navigation_send_next 실패: {e}")
                log_event("error", "nav_error", f"네비게이션 다음 웨이포인트 전송 실패: {e}",
                          robot_id=get_robot_id(), robot_name=get_robot_name())

        time.sleep(NAV_POLL_INTERVAL)


# ======================================================
# Thread 시작
# ======================================================
threading.Thread(target=position_thread, daemon=True).start()
threading.Thread(target=status_thread, daemon=True).start()
threading.Thread(target=nav_thread, daemon=True).start()


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
    # send_init_pose()
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
              f"로봇 에러 발생 [{error_hex}]: {error_msg}",
              detail=json.dumps({"error_code": error_hex, "test": True}, ensure_ascii=False),
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
