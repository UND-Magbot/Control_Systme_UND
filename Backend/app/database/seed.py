"""서버 기동 시 기본 데이터 시드.

startup_event에서 호출되며, 존재하지 않는 기본 데이터(메뉴 마스터,
관리자/매니저/일반 사용자, 각 사용자 메뉴 권한, 기존 로봇 내장 카메라)를
생성 또는 동기화한다.
"""

import os

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.models import (
    UserInfo,
    RobotInfo,
    UserPermission,
    MenuInfo,
    RobotModule,
    ModuleCameraInfo,
)
from app.auth.password import hash_password


# ─────────────────────────────────────────────────────────
# 메뉴 마스터 시드 데이터
# ─────────────────────────────────────────────────────────
# (MenuKey, MenuName, ParentKey, SortOrder, IsGroup)
MENU_SEED = [
    ("dashboard",        "대시보드",     None,              1, False),
    ("schedule-mgmt",    "작업관리",     None,              2, True),
    ("schedule-list",    "작업 목록",    "schedule-mgmt",   1, False),
    ("robot-mgmt",       "운영관리",     None,              3, True),
    ("robot-list",       "로봇 목록",    "robot-mgmt",      1, False),
    ("business-list",    "사업장 목록",  "robot-mgmt",      2, False),
    ("map-management",   "맵 관리",      None,              4, True),
    ("map-edit",         "맵 편집",      "map-management",  1, False),
    ("place-list",       "장소 목록",    "map-management",  2, False),
    ("path-list",        "경로 목록",    "map-management",  3, False),
    ("data-mgmt",        "데이터관리",   None,              5, True),
    ("video",            "영상 관리",    "data-mgmt",       1, False),
    ("statistics",       "통계 관리",    "data-mgmt",       2, False),
    ("log",              "로그 관리",    "data-mgmt",       3, False),
    ("voice",            "음성 관리",    "data-mgmt",       4, False),
    ("alerts",           "알림",         None,              6, True),
    ("alert-total",      "전체",         "alerts",          1, False),
    ("alert-schedule",   "스케줄",       "alerts",          2, False),
    ("alert-robot",      "로봇",         "alerts",          3, False),
    ("alert-notice",     "공지사항",     "alerts",          4, False),
    ("settings",         "설정",         None,              7, True),
    ("menu-permissions", "메뉴 권한",    "settings",        1, False),
    ("password-change",  "비밀번호 변경", "settings",        2, False),
    ("db-backup",        "DB 백업",      "settings",        3, False),
]

MANAGER_MENUS = [
    "dashboard", "schedule-list",
    "robot-list", "business-list",
    "map-edit", "place-list", "path-list",
    "video", "statistics", "log", "voice",
    "alert-total", "alert-schedule", "alert-robot", "alert-notice",
    "menu-permissions",
]

USER_DEFAULT_MENUS = [
    "dashboard", "schedule-list",
    "video", "statistics",
    "alert-total", "alert-schedule", "alert-robot", "alert-notice",
]


def get_default_menu_keys(permission: int) -> list[str]:
    """Permission(1/2/3)에 따른 기본 메뉴 키 프리셋."""
    if permission == 1:
        return [s[0] for s in MENU_SEED if not s[4]]  # superadmin: 모든 리프
    if permission == 2:
        return list(MANAGER_MENUS)
    if permission == 3:
        return list(USER_DEFAULT_MENUS)
    return []

DEFAULT_BUILT_IN_CAMERAS = {
    "QUADRUPED": [("전방", "/video1"), ("후방", "/video2")],
    "AMR":       [("전방", "/video1")],
    "HUMANOID":  [("전방", "/video1"), ("후방", "/video2")],
    "COBOT":     [],
}

# ─────────────────────────────────────────────────────────
# 메뉴 마스터 스키마 마이그레이션 (Alembic 부재)
# ─────────────────────────────────────────────────────────
def migrate_menu_info_columns(db: Session) -> None:
    """menu_info에 IsGroup/IsVisible 컬럼이 없으면 ALTER TABLE로 추가. 멱등."""
    rows = db.execute(text(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menu_info'"
    )).fetchall()
    existing = {r[0] for r in rows}
    if not existing:
        return  # 테이블 자체가 아직 없으면 create_all이 생성

    altered = False
    if "IsGroup" not in existing:
        db.execute(text("ALTER TABLE menu_info ADD COLUMN IsGroup TINYINT(1) NOT NULL DEFAULT 0"))
        altered = True
    if "IsVisible" not in existing:
        db.execute(text("ALTER TABLE menu_info ADD COLUMN IsVisible TINYINT(1) NOT NULL DEFAULT 1"))
        altered = True
    if altered:
        db.commit()
        print("[OK] menu_info 스키마 마이그레이션 완료 (IsGroup/IsVisible)")

        # 그룹 노드로 분류된 MenuKey에 대해 IsGroup=1 백필
        group_keys = [s[0] for s in MENU_SEED if s[4]]
        if group_keys:
            db.query(MenuInfo).filter(MenuInfo.MenuKey.in_(group_keys)).update(
                {MenuInfo.IsGroup: 1}, synchronize_session=False
            )
            # 그룹 노드를 참조하는 user_permission 행 정리 (방어적)
            db.query(UserPermission).filter(
                UserPermission.MenuId.in_(
                    db.query(MenuInfo.id).filter(MenuInfo.IsGroup == 1)
                )
            ).delete(synchronize_session=False)
            db.commit()
            print(f"[OK] 그룹 노드 {len(group_keys)}개 IsGroup 백필 완료")


# ─────────────────────────────────────────────────────────
# 메뉴 마스터
# ─────────────────────────────────────────────────────────
def seed_menus(db: Session) -> None:
    migrate_menu_info_columns(db)

    existing_keys = {r.MenuKey for r in db.query(MenuInfo.MenuKey).all()}

    if not existing_keys:
        # 1차: 부모 메뉴 먼저 (ParentKey=None)
        key_to_id: dict[str, int] = {}
        for menu_key, menu_name, parent_key, sort_order, is_group in MENU_SEED:
            if parent_key is None:
                m = MenuInfo(
                    MenuKey=menu_key, MenuName=menu_name, ParentId=None,
                    SortOrder=sort_order, IsGroup=1 if is_group else 0, IsVisible=1,
                )
                db.add(m)
                db.flush()
                key_to_id[menu_key] = m.id
        # 2차: 자식 메뉴
        for menu_key, menu_name, parent_key, sort_order, is_group in MENU_SEED:
            if parent_key is not None:
                m = MenuInfo(
                    MenuKey=menu_key, MenuName=menu_name, ParentId=key_to_id[parent_key],
                    SortOrder=sort_order, IsGroup=1 if is_group else 0, IsVisible=1,
                )
                db.add(m)
                db.flush()
                key_to_id[menu_key] = m.id
        db.commit()
        print(f"[OK] 메뉴 마스터 {len(MENU_SEED)}개 시드 완료")
        return

    # 새 메뉴 추가분만 처리
    new_menus = [s for s in MENU_SEED if s[0] not in existing_keys]
    if new_menus:
        key_to_id = {r.MenuKey: r.id for r in db.query(MenuInfo).all()}
        for menu_key, menu_name, parent_key, sort_order, is_group in new_menus:
            parent_id = key_to_id.get(parent_key) if parent_key else None
            m = MenuInfo(
                MenuKey=menu_key, MenuName=menu_name, ParentId=parent_id,
                SortOrder=sort_order, IsGroup=1 if is_group else 0, IsVisible=1,
            )
            db.add(m)
            db.flush()
            key_to_id[menu_key] = m.id
        db.commit()
        print(f"[OK] 메뉴 마스터 {len(new_menus)}개 추가")

    # 기존 메뉴 ParentId·SortOrder·IsGroup 동기화 (IsVisible은 운영자가 관리하므로 덮어쓰지 않음)
    key_to_id = {r.MenuKey: r.id for r in db.query(MenuInfo).all()}
    updated = 0
    for menu_key, menu_name, parent_key, sort_order, is_group in MENU_SEED:
        menu = db.query(MenuInfo).filter(MenuInfo.MenuKey == menu_key).first()
        if not menu:
            continue
        expected_parent = key_to_id.get(parent_key) if parent_key else None
        expected_group = 1 if is_group else 0
        changed = False
        if menu.ParentId != expected_parent:
            menu.ParentId = expected_parent
            changed = True
        if menu.SortOrder != sort_order:
            menu.SortOrder = sort_order
            changed = True
        # MenuName은 관리자가 바꿀 수 있으므로 최초 1회만 동기화하지 않음 — 시드 재실행 시 덮어쓰지 않음
        if (menu.IsGroup or 0) != expected_group:
            menu.IsGroup = expected_group
            changed = True
        if changed:
            updated += 1
    # 시드에 없는 메뉴 삭제 (schedule-insert 등)
    seed_keys = {s[0] for s in MENU_SEED}
    removed = db.query(MenuInfo).filter(MenuInfo.MenuKey.notin_(seed_keys)).delete(synchronize_session="fetch")
    if updated or removed:
        db.commit()
        print(f"[OK] 메뉴 마스터 동기화: {updated}개 수정, {removed}개 삭제")


# ─────────────────────────────────────────────────────────
# 사용자 계정
# ─────────────────────────────────────────────────────────
def _seed_password(env_key: str, account_label: str) -> str:
    """시드 계정 비밀번호를 환경변수에서 읽는다(하드코딩 금지). 미설정 시 즉시 오류.

    실제로 계정을 생성하거나 LoginId 마이그레이션으로 비밀번호를 기록하는 시점에만
    호출된다. 따라서 이미 시드된 기존 배포(계정 존재·마이그레이션 불필요)는 이 env 가
    없어도 정상 기동한다(신규 시드/마이그레이션 시에만 요구).
    """
    pw = os.getenv(env_key, "").strip()
    if not pw:
        raise RuntimeError(
            f"{account_label} 시드 비밀번호 환경변수 {env_key} 가 설정되지 않았습니다. "
            f".env 에 {env_key}=<강력한 비밀번호> 를 설정하세요."
        )
    return pw


def seed_super_admin(db: Session) -> UserInfo:
    admin_user = (
        db.query(UserInfo).filter(UserInfo.LoginId == "superadmin").first()
        or db.query(UserInfo).filter(UserInfo.LoginId == "admin").first()
        or db.query(UserInfo).filter(UserInfo.UserName == "관리자").first()
    )
    if admin_user:
        changed = False
        if admin_user.LoginId != "superadmin":
            admin_user.LoginId = "superadmin"
            admin_user.Password = hash_password(_seed_password("SEED_SUPERADMIN_PASSWORD", "최고관리자"))
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
            Password=hash_password(_seed_password("SEED_SUPERADMIN_PASSWORD", "최고관리자")),
            IsActive=1,
        )
        db.add(admin_user)
        db.commit()
        print("[SEED] 최고관리자 계정 생성 완료")
    return admin_user


def seed_super_admin_permissions(db: Session, admin_user: UserInfo) -> None:
    """최고관리자는 모든 메뉴 권한을 보유."""
    all_menu_ids = {r.id for r in db.query(MenuInfo.id).all()}

    # 최신 커밋 상태 반영을 위해 세션 갱신
    db.expire_all()
    existing_perms = {
        r.MenuId for r in
        db.query(UserPermission.MenuId).filter(UserPermission.UserId == admin_user.id).all()
    }
    new_perms = all_menu_ids - existing_perms
    if not new_perms:
        return

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


def seed_manager(db: Session) -> UserInfo:
    manager_user = (
        db.query(UserInfo).filter(UserInfo.LoginId == "admin").first()
        or db.query(UserInfo).filter(UserInfo.LoginId == "manager").first()
    )
    if manager_user:
        changed = False
        if manager_user.LoginId != "admin":
            manager_user.LoginId = "admin"
            manager_user.Password = hash_password(_seed_password("SEED_MANAGER_PASSWORD", "관리자"))
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
            Password=hash_password(_seed_password("SEED_MANAGER_PASSWORD", "관리자")),
            IsActive=1,
        )
        db.add(manager_user)
        db.commit()
        print("[SEED] 관리자 계정 생성 완료")
    return manager_user


def seed_manager_permissions(db: Session, manager_user: UserInfo) -> None:
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


def seed_normal_user(db: Session) -> UserInfo:
    normal_user = db.query(UserInfo).filter(UserInfo.LoginId == "user").first()
    if not normal_user:
        normal_user = UserInfo(
            Permission=3,
            UserName="사용자",
            LoginId="user",
            Password=hash_password(_seed_password("SEED_USER_PASSWORD", "일반 사용자")),
            IsActive=1,
        )
        db.add(normal_user)
        db.commit()
        print("[SEED] 일반 사용자 계정 생성 완료")
    elif normal_user.Permission != 3:
        normal_user.Permission = 3
        db.commit()
        print("[SEED] 일반 사용자 권한 3으로 업데이트")
    return normal_user


def seed_normal_user_permissions(db: Session, normal_user: UserInfo) -> None:
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
        print(f"[OK] 일반 사용자 메뉴 권한 {added_user}개 추가")


# ─────────────────────────────────────────────────────────
# 기존 로봇 내장 카메라 모듈
# ─────────────────────────────────────────────────────────
def seed_builtin_cameras(db: Session) -> None:
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


def seed_incumbent_endpoints(db: Session) -> None:
    """기존(단일) 로봇의 통신 엔드포인트를 env 전역값으로 1회 백필(멱등).

    전역 ROBOT_IP/RECEIVER_IP 로 통신하던 기존 로봇을 새 robot_endpoint 구조에
    표현해, 관제 UI 에서 조회·수정 가능하게 한다. 이미 엔드포인트 행이 있는 로봇은
    건드리지 않는다(멱등). 실패해도 스타트업을 막지 않도록 방어한다.
    """
    from app.database.models import RobotInfo, RobotEndpoint
    from app.robot_io.config import (
        ROBOT_IP, ROBOT_PORT, RECEIVER_IP, RECEIVER_PORT, RECEIVER_TCP_PORT,
    )

    try:
        # 대상: RobotIP 가 전역 ROBOT_IP 와 일치하는 로봇(현행 M20), 없으면 첫 로봇
        incumbent = db.query(RobotInfo).filter(RobotInfo.RobotIP == ROBOT_IP).first()
        if incumbent is None:
            incumbent = db.query(RobotInfo).order_by(RobotInfo.id.asc()).first()
        if incumbent is None:
            return

        has_rows = (
            db.query(RobotEndpoint).filter(RobotEndpoint.RobotId == incumbent.id).first()
            is not None
        )
        if has_rows:
            return  # 멱등: 이미 등록됨

        db.add(RobotEndpoint(
            RobotId=incumbent.id, Role="receiver",
            Ip=RECEIVER_IP, UdpPort=RECEIVER_PORT, TcpPort=RECEIVER_TCP_PORT,
        ))
        db.add(RobotEndpoint(
            RobotId=incumbent.id, Role="robot",
            Ip=incumbent.RobotIP or ROBOT_IP, UdpPort=incumbent.RobotPort or ROBOT_PORT,
        ))
        db.commit()
        print(f"[OK] 기존 로봇(id={incumbent.id}) 통신 엔드포인트 env 백필 완료 "
              f"(receiver={RECEIVER_IP}:{RECEIVER_PORT}, robot={incumbent.RobotIP or ROBOT_IP})")
    except Exception as e:
        db.rollback()
        print(f"[WARN] 엔드포인트 백필 건너뜀: {e}")


# ─────────────────────────────────────────────────────────
# 오케스트레이터
# ─────────────────────────────────────────────────────────
def migrate_way_info_columns(db: Session) -> None:
    """way_info에 StopActions 컬럼이 없으면 ALTER TABLE로 추가. 멱등.
    경유지 도착 상호작용(PRD-Waypoint-Arrival-Interaction) — 기존 테이블이라 create_all이 못 붙인다."""
    rows = db.execute(text(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'way_info'"
    )).fetchall()
    existing = {r[0] for r in rows}
    if not existing:
        return  # 테이블 자체가 아직 없으면 create_all이 생성
    if "StopActions" not in existing:
        db.execute(text("ALTER TABLE way_info ADD COLUMN StopActions TEXT NULL"))
        db.commit()
        print("[OK] way_info 스키마 마이그레이션 완료 (StopActions)")


def migrate_service_session_nullable_schedule(db: Session) -> None:
    """service_session.ScheduleId 를 NULL 허용으로. 멱등.

    응대가 반드시 작업(상시대기 스케줄) 안에서만 일어난다는 전제로 만든 컬럼인데,
    작업 없이도 호출에 응하도록 바뀌었다. 그런 응대도 이력에 남아야 한다 —
    "작업이 없어서 기록이 없다"는 상태가 제일 나쁘다.
    """
    rows = db.execute(text(
        "SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_session' "
        "AND COLUMN_NAME = 'ScheduleId'"
    )).fetchall()
    if not rows:
        return  # 테이블/컬럼이 아직 없으면 create_all이 생성
    if rows[0][0] == "YES":
        return
    db.execute(text("ALTER TABLE service_session MODIFY COLUMN ScheduleId INT NULL"))
    db.commit()
    print("[OK] service_session 스키마 마이그레이션 완료 (ScheduleId NULL 허용)")


def migrate_voice_confirm_word_columns(db: Session) -> None:
    """voice_confirm_word 에 Kind 컬럼이 없으면 ALTER TABLE로 추가. 멱등.

    인식어가 '도착 확인' 하나뿐이던 시절에 만든 테이블이라 종류 구분이 없다.
    '해산 확인'(안내 후 복귀)이 같은 표를 쓰므로 나눠야 한다 — 안 나누면 '없음' 이
    도착 확인을 통과시킨다.

    유니크 키도 (RobotId, Word) → (RobotId, Kind, Word) 로 바꾼다. 안 바꾸면 같은 말을
    두 종류에 등록할 수 없다(예: '네' 는 양쪽 모두에 있을 법하다).
    """
    rows = db.execute(text(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'voice_confirm_word'"
    )).fetchall()
    existing = {r[0] for r in rows}
    if not existing:
        return  # 테이블 자체가 아직 없으면 create_all이 생성
    if "Kind" in existing:
        return

    # 기존 행은 전부 도착 확인이다 — DEFAULT 로 채워진다
    db.execute(text(
        "ALTER TABLE voice_confirm_word "
        "ADD COLUMN Kind VARCHAR(16) NOT NULL DEFAULT 'arrival'"
    ))
    idx = db.execute(text(
        "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'voice_confirm_word' "
        "AND INDEX_NAME = 'uq_voice_confirm_robot_word'"
    )).fetchall()
    if idx:
        db.execute(text("ALTER TABLE voice_confirm_word DROP INDEX uq_voice_confirm_robot_word"))
    db.execute(text(
        "ALTER TABLE voice_confirm_word "
        "ADD UNIQUE KEY uq_voice_confirm_robot_kind_word (RobotId, Kind, Word)"
    ))
    db.commit()
    print("[OK] voice_confirm_word 스키마 마이그레이션 완료 (Kind)")


def migrate_schedule_info_columns(db: Session) -> None:
    """schedule_info에 실행 보장 컬럼이 없으면 ALTER TABLE로 추가. 멱등.
    PRD-Schedule-Execution §2.3 — 기존 테이블이라 create_all이 못 붙인다."""
    rows = db.execute(text(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedule_info'"
    )).fetchall()
    existing = {r[0] for r in rows}
    if not existing:
        return  # 테이블 자체가 아직 없으면 create_all이 생성

    specs = [
        ("GraceMinutes", "INT NULL DEFAULT 10"),
        ("MaxDurationMin", "INT NULL DEFAULT 60"),
        ("ReturnPolicy", "VARCHAR(10) NULL DEFAULT 'charge'"),
        ("ReturnPlaceId", "INT NULL"),
        ("PausedUntil", "DATETIME NULL"),
        ("StopActionsOverride", "TEXT NULL"),
        # 상시 대기 응대 (§3.3)
        ("StandbyTrigger", "VARCHAR(10) NULL DEFAULT 'button'"),
        ("StandbyDestinations", "TEXT NULL"),
        ("StandbyMaxSessionMin", "INT NULL DEFAULT 20"),
        ("StandbyRetryCount", "INT NULL DEFAULT 2"),
        ("StandbyRetryWindowSec", "INT NULL DEFAULT 10"),
        ("StandbyIdleSitSec", "INT NULL DEFAULT 40"),
    ]
    added = [name for name, ddl in specs if name not in existing]
    for name, ddl in specs:
        if name not in existing:
            db.execute(text(f"ALTER TABLE schedule_info ADD COLUMN {name} {ddl}"))
    if added:
        db.commit()
        print(f"[OK] schedule_info 스키마 마이그레이션 완료 ({', '.join(added)})")


def migrate_module_voice_columns(db: Session) -> None:
    """module_voice_info에 능력 플래그(HasMic/HasSpeaker)를 추가. 멱등.

    기본값은 '마이크 없음 · 스피커 있음'이다 — 마이크는 아직 확보되지 않았고,
    없는 것을 있다고 두면 상시 대기가 자동 청취로 등록됐다가 동작하지 않는다."""
    rows = db.execute(text(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'module_voice_info'"
    )).fetchall()
    existing = {r[0] for r in rows}
    if not existing:
        return  # 테이블 자체가 아직 없으면 create_all이 생성

    specs = [
        ("HasMic", "TINYINT(1) NOT NULL DEFAULT 0"),
        ("HasSpeaker", "TINYINT(1) NOT NULL DEFAULT 1"),
    ]
    added = [name for name, _ in specs if name not in existing]
    for name, ddl in specs:
        if name not in existing:
            db.execute(text(f"ALTER TABLE module_voice_info ADD COLUMN {name} {ddl}"))
    if added:
        db.commit()
        print(f"[OK] module_voice_info 스키마 마이그레이션 완료 ({', '.join(added)})")


def migrate_voice_announcement_labels(db: Session) -> None:
    """안내 멘트의 발화명(Label)을 필수로 전환. 멱등.

    기존엔 Label이 선택(NULL 허용)이었다. 이제 정지 옵션 드롭다운에 발화명만 표시하므로
    필수·유일이어야 한다. NULL/빈 라벨은 발화 문구 앞부분으로 백필하고, 로봇 내 중복은
    뒤에 번호를 붙여 유일하게 만든다."""
    rows = db.execute(text(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'voice_announcement'"
    )).fetchall()
    if not rows:
        return  # 테이블 자체가 아직 없으면 create_all이 생성

    empties = db.execute(text(
        "SELECT id, RobotId, Text FROM voice_announcement "
        "WHERE Label IS NULL OR Label = '' ORDER BY RobotId, id"
    )).fetchall()
    if not empties:
        return

    for row in empties:
        ann_id, robot_id, txt = row[0], row[1], (row[2] or "")
        base = (txt.strip()[:36] or f"발화 {ann_id}")
        candidate = base
        n = 1
        # 같은 로봇 안에서 유일해질 때까지 접미사 부여
        while db.execute(text(
            "SELECT 1 FROM voice_announcement WHERE RobotId = :rid AND Label = :lbl "
            "AND id <> :aid LIMIT 1"
        ), {"rid": robot_id, "lbl": candidate, "aid": ann_id}).first():
            n += 1
            suffix = f" {n}"
            candidate = base[: 40 - len(suffix)] + suffix
        db.execute(text(
            "UPDATE voice_announcement SET Label = :lbl WHERE id = :aid"
        ), {"lbl": candidate, "aid": ann_id})
    db.commit()
    print(f"[OK] voice_announcement 발화명 백필 완료 ({len(empties)}건)")


def seed_all(db: Session) -> None:
    """모든 기본 데이터 시드 실행."""
    seed_menus(db)
    migrate_way_info_columns(db)
    migrate_schedule_info_columns(db)
    migrate_voice_confirm_word_columns(db)
    migrate_service_session_nullable_schedule(db)
    migrate_module_voice_columns(db)
    migrate_voice_announcement_labels(db)
    admin_user = seed_super_admin(db)
    seed_super_admin_permissions(db, admin_user)
    manager_user = seed_manager(db)
    seed_manager_permissions(db, manager_user)
    normal_user = seed_normal_user(db)
    seed_normal_user_permissions(db, normal_user)
    seed_builtin_cameras(db)
    seed_incumbent_endpoints(db)
