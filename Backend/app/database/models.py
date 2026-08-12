from sqlalchemy import (
    Column,
    Integer,
    SmallInteger,
    String,
    Double,
    Float,
    Date,
    DateTime,
    Text,
    JSON,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import LONGBLOB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database.database import Base

# =========================
# 로봇 기본 정보
# =========================
class RobotInfo(Base):
    __tablename__ = "robot_info"
    id = Column(Integer, primary_key=True, index=True)
    UserId = Column(Integer)
    RobotName = Column(String(100))
    RobotType = Column(String(20), nullable=True)          # QUADRUPED / COBOT / AMR / HUMANOID
    RobotIP = Column(String(45), nullable=True)            # 로봇 IP (카메라 RTSP URL도 이 IP로 동적 생성)
    RobotPort = Column(Integer, nullable=True, default=30000)  # 로봇 UDP 포트
    ProductCompany = Column(String(100))
    SerialNumber = Column(String(100))
    ModelName = Column(String(100))
    Group = Column(String(100))
    SWversion = Column(String(100))
    Site = Column(String(100))
    BusinessId = Column(Integer, nullable=True)
    CurrentFloorId = Column(Integer, nullable=True)
    CurrentMapId = Column(Integer, nullable=True)
    LimitBattery = Column(Integer, default=30)
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    DeletedAt = Column(DateTime, nullable=True, default=None)

# =========================
# 로봇 위치 정보 (누적)
# =========================
class LocationInfo(Base):
    __tablename__ = "location_info"
    id = Column(Integer, primary_key=True, index=True)
    UserId = Column(Integer)
    RobotName = Column(String(100))
    LacationName = Column(String(100))
    FloorId = Column(Integer)
    LocationX = Column(Double)
    LocationY = Column(Double)
    Yaw = Column(Double, default=0.0)
    MapId = Column(Integer)
    Category = Column(String(20), default="waypoint")
    Imformation = Column(String(100))
    # 위험구역(Category="danger") 폴리곤 꼭짓점 [[x,y], ...] (월드 좌표).
    # 일반 장소는 NULL. danger 는 LocationX/Y 에 centroid 를 두고 여기에 점 배열 저장.
    Polygon = Column(JSON, nullable=True)

# =========================
# 로그 / 이벤트 정보
# =========================
class LogDataInfo(Base):
    __tablename__ = "logdata_info"

    id = Column(Integer, primary_key=True, autoincrement=True)
    Category = Column(String(20), nullable=False)          # robot|system|schedule|error
    Action = Column(String(50), nullable=False, comment="system_startup|nav_start|nav_arrival|nav_complete|nav_loop|nav_error|place_move_start|path_move_start|robot_battery_low|robot_charging_start|robot_charging_complete|robot_connection_error|rtsp_error")
    Message = Column(String(500), nullable=False)
    Detail = Column(Text, nullable=True)                   # JSON 문자열 (상세 정보)
    RobotId = Column(Integer, nullable=True)
    RobotName = Column(String(100), nullable=True)
    BusinessId = Column(Integer, nullable=True, comment="사업장 ID (system 로그는 NULL)")
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)

    alert = relationship("Alert", back_populates="log", uselist=False)


# =========================
# 공지사항
# =========================
class Notice(Base):
    __tablename__ = "notice_info"

    id = Column(Integer, primary_key=True, autoincrement=True)
    Title = Column(String(100), nullable=False)
    Content = Column(Text, nullable=False)                 # 본문 (max 2000자)
    Importance = Column(String(10), nullable=False, default="normal")  # high|normal
    UserId = Column(Integer, nullable=False, comment="작성자 ID")
    BusinessId = Column(Integer, nullable=False, comment="사업장 ID")
    AttachmentName = Column(String(255), nullable=True)
    AttachmentUrl = Column(String(500), nullable=True)
    AttachmentSize = Column(Integer, nullable=True, comment="첨부파일 크기(bytes)")
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    DeletedAt = Column(DateTime, nullable=True, default=None)

    alert = relationship("Alert", back_populates="notice", uselist=False)
    user = relationship("UserInfo", primaryjoin="Notice.UserId == UserInfo.id", foreign_keys="[Notice.UserId]", uselist=False, viewonly=True)


# =========================
# 알림
# =========================
class Alert(Base):
    __tablename__ = "alert_info"

    id = Column(Integer, primary_key=True, autoincrement=True)
    Type = Column(String(20), nullable=False)              # Robot|Notice|Schedule
    Status = Column(String(20), nullable=True)             # error|info|event
    Content = Column(String(500), nullable=False)
    Detail = Column(Text, nullable=True)                   # Robot/Schedule 상세
    ErrorJson = Column(Text, nullable=True)                # 에러 상세 JSON
    RobotName = Column(String(100), nullable=True)
    LogId = Column(Integer, ForeignKey("logdata_info.id", ondelete="SET NULL"), nullable=True)
    NoticeId = Column(Integer, ForeignKey("notice_info.id", ondelete="SET NULL"), nullable=True)
    BusinessId = Column(Integer, nullable=True, comment="사업장 ID (system 알림은 NULL)")
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    DeletedAt = Column(DateTime, nullable=True, default=None)

    log = relationship("LogDataInfo", back_populates="alert")
    notice = relationship("Notice", back_populates="alert")
    read_statuses = relationship("AlertReadStatus", back_populates="alert", cascade="all, delete-orphan")


# =========================
# 알림 읽음 상태
# =========================
class AlertReadStatus(Base):
    __tablename__ = "alert_read_status"

    id = Column(Integer, primary_key=True, autoincrement=True)
    AlertId = Column(Integer, ForeignKey("alert_info.id", ondelete="CASCADE"), nullable=False)
    UserId = Column(Integer, nullable=False)
    ReadAt = Column(DateTime, server_default=func.now(), nullable=False)

    alert = relationship("Alert", back_populates="read_statuses")



# =========================
# 사용자 정보
# =========================
class UserInfo(Base):
    __tablename__ = "user_info"

    id = Column(Integer, primary_key=True, index=True)
    Permission = Column(Integer)                                    # 역할: 1=admin, 2=user
    UserName = Column(String(50), nullable=True)
    LoginId = Column(String(50), unique=True, nullable=True)
    Password = Column(String(255), nullable=True)                   # bcrypt 해시
    RefreshTokenHash = Column(String(255), nullable=True)           # (미사용, 하위호환용)
    TokenVersion = Column(Integer, default=0, nullable=False)       # 토큰 버전 (증가 시 기존 토큰 무효)
    IsActive = Column(Integer, default=1)                           # 1=활성, 0=정지
    BusinessId = Column(Integer, nullable=True)                     # 소속 사업자 FK
    LastLoginAt = Column(DateTime, nullable=True)
    CreatedAt = Column(DateTime, server_default=func.now())
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now())
    DeletedAt = Column(DateTime, nullable=True, default=None)       # 소프트 삭제 (탈퇴)


# =========================
# 메뉴 정보 (마스터)
# =========================
class MenuInfo(Base):
    __tablename__ = "menu_info"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ParentId = Column(Integer, ForeignKey("menu_info.id", ondelete="CASCADE"), nullable=True)
    MenuKey = Column(String(50), unique=True, nullable=False)       # 고유 식별자 (dashboard, robot-list 등)
    MenuName = Column(String(100), nullable=False)                  # 표시명
    SortOrder = Column(Integer, default=0)                          # 정렬 순서
    IsGroup = Column(SmallInteger, nullable=False, default=0, server_default="0")    # 1=그룹 노드(권한 대상 아님)
    IsVisible = Column(SmallInteger, nullable=False, default=1, server_default="1")  # 0=UI 숨김

    parent = relationship("MenuInfo", remote_side="MenuInfo.id", uselist=False)
    children = relationship("MenuInfo", back_populates="parent", cascade="all, delete-orphan")


# =========================
# 사용자 메뉴 권한
# =========================
class UserPermission(Base):
    __tablename__ = "user_permission"
    __table_args__ = (
        UniqueConstraint("UserId", "MenuId", name="uq_user_menu"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    UserId = Column(Integer, ForeignKey("user_info.id", ondelete="CASCADE"), nullable=False)
    MenuId = Column(Integer, ForeignKey("menu_info.id", ondelete="CASCADE"), nullable=False)
    CreatedAt = Column(DateTime, server_default=func.now())

    user = relationship("UserInfo", primaryjoin="UserPermission.UserId == UserInfo.id", foreign_keys="[UserPermission.UserId]", uselist=False, viewonly=True)
    menu = relationship("MenuInfo", uselist=False, viewonly=True)


# =========================
# 감사 로그
# =========================
class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    UserId = Column(Integer, nullable=True)
    Action = Column(String(50), nullable=False)                     # login, logout, password_changed, user_created 등
    TargetType = Column(String(50), nullable=True)                  # user, robot, path, place, schedule, notice, business, area
    TargetId = Column(Integer, nullable=True)
    Detail = Column(Text, nullable=True)                            # JSON 컨텍스트
    IpAddress = Column(String(45), nullable=True)
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)


# =========================
# 경로 정보
# =========================
class WayInfo(Base):
    __tablename__ = "way_info"

    id = Column(Integer, primary_key=True)
    UserId = Column(Integer)
    RobotName = Column(String(50))
    TaskType = Column(String(50))
    WayName = Column(String(50))
    WayPoints = Column(Text)
    WaitSeconds = Column(Text)  # JSON array of int, len == stop count of WayPoints
    # 경유지 도착 상호작용 (PRD-Waypoint-Arrival-Interaction). WayPoints 정차 지점과 1:1 병렬 JSON.
    # [{announceId, announceText, confirm(none|button|voice|gesture), waitSec, onTimeout(wait|skip|abort)}]
    # NULL/빈 배열이면 기존 WaitSeconds 동작 그대로(하위 호환).
    StopActions = Column(Text)
    UpdateTime= Column(DateTime)


# =========================
# 사업장 정보
# =========================
class BusinessInfo(Base):
    __tablename__ = "business_info"
    id = Column(Integer, primary_key=True, index=True)
    BusinessName = Column(String(100), nullable=False)
    ZipCode = Column(String(10), nullable=True)
    Address = Column(String(200), nullable=True)
    AddressDetail = Column(String(200), nullable=True)
    RepresentName = Column(String(50), nullable=True)
    Contact = Column(String(30), nullable=True)
    Description = Column(String(500), nullable=True)
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    DeletedAt = Column(DateTime, nullable=True, default=None)

# =========================
# 층 정보
# =========================
class FloorInfo(Base):
    __tablename__ = "floor_info"
    id = Column(Integer, primary_key=True, index=True)
    BusinessId = Column(Integer, nullable=False)
    FloorName = Column(String(50), nullable=False)  # B1, 1F, 2F 등
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)

# =========================
# 로봇 맵 정보
# =========================
class RobotMapInfo(Base):
    __tablename__ = "robot_map_info"
    id = Column(Integer, primary_key=True, index=True)
    BusinessId = Column(Integer, nullable=False)
    FloorId = Column(Integer, nullable=False)
    MapName = Column(String(100), nullable=False)   # 맵 이름 (사용자 입력)
    PgmFilePath = Column(String(300))
    YamlFilePath = Column(String(300))
    ImgFilePath = Column(String(300))
    ZipFilePath = Column(String(300))
    Adddate = Column(DateTime, server_default=func.now())


# =========================
# 맵별·로봇별 초기 위치
# =========================
class MapInitPose(Base):
    __tablename__ = "map_init_pose"
    id = Column(Integer, primary_key=True, autoincrement=True)
    MapId = Column(Integer, nullable=False)
    RobotId = Column(Integer, nullable=False)
    PosX = Column(Float, nullable=False)
    PosY = Column(Float, nullable=False)
    Yaw = Column(Float, nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("MapId", "RobotId", name="uq_map_robot"),
    )


# =========================
# 맵 실물 파일 중앙 저장소 (공유 MySQL BLOB)
# =========================
class RobotMapFile(Base):
    """관제 PC 여러 대가 공유 DB만으로 맵 파일을 주고받기 위한 청크 BLOB 저장소.

    pgm/yaml/png/zip 을 4MB 청크(Seq)로 나눠 저장한다. 청크 분할은
    MySQL max_allowed_packet(기본 16MB) 한도를 넘지 않기 위함이며,
    덕분에 서버 설정 변경 없이 28MB 급 zip 도 안전하게 저장된다.
    로컬 static/maps 는 이 테이블의 read-through 캐시로 동작한다.
    """
    __tablename__ = "robot_map_file"
    id = Column(Integer, primary_key=True, autoincrement=True)
    MapId = Column(Integer, nullable=False, index=True)
    Kind = Column(String(8), nullable=False)        # pgm / yaml / png / zip
    Seq = Column(Integer, nullable=False, default=0)  # 청크 순번 (소형 파일은 0)
    Data = Column(LONGBLOB, nullable=False)         # 청크 바이트 (≤ 4MB)
    Sha256 = Column(String(64))                      # 파일 전체 해시 (무결성 검증)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("MapId", "Kind", "Seq", name="uq_map_kind_seq"),
    )


# =========================
# 경로(구간) 정보
# =========================
class RouteInfo(Base):
    __tablename__ = "route_info"
    id = Column(Integer, primary_key=True, index=True)
    MapId = Column(Integer, nullable=False)
    StartPlaceName = Column(String(100), nullable=False)
    EndPlaceName = Column(String(100), nullable=False)
    Direction = Column(String(20), nullable=False)  # forward, reverse, bidirectional


class ScheduleInfo(Base):
    __tablename__ = "schedule_info"

    id = Column(Integer, primary_key=True)
    UserId = Column(Integer)
    RobotName = Column(String(50))
    WorkName  = Column(String(100))
    TaskType = Column(String(50))
    WayName = Column(String(50))
    TaskStatus  = Column(String(20))

    StartDate  = Column(DateTime)
    EndDate  = Column(DateTime)

    # 레거시 호환 필드
    Repeat = Column(String(50), default="N")
    Repeat_Day = Column(String(100))
    Repeat_End = Column(String(50))

    # 3모드 스케줄 필드
    ScheduleMode = Column(String(20), default="once")       # "once" | "weekly" | "interval"
    ExecutionTime = Column(String(200), nullable=True)        # weekly: "HH:MM" 또는 "09:00,13:00,18:00"
    IntervalMinutes = Column(Integer, nullable=True)         # interval: 반복 간격(분)
    ActiveStartTime = Column(String(5), nullable=True)       # interval: 활동 시작 "HH:MM"
    ActiveEndTime = Column(String(5), nullable=True)         # interval: 활동 종료 "HH:MM"
    SeriesStartDate = Column(Date, nullable=True)            # 반복 시작일
    SeriesEndDate = Column(Date, nullable=True)              # 반복 종료일 (null=무기한)
    SeriesExceptions = Column(String(500), nullable=True)    # 스킵 날짜들 (YYYY-MM-DD, 콤마구분)
    SeriesGroupId = Column(String(36), nullable=True, index=True)  # 반복 시리즈 그룹 UUID (split row들이 공유)

    # 스케줄러 추적
    LastRunDate = Column(DateTime, nullable=True)
    RunCount = Column(Integer, default=0)
    MaxRunCount = Column(Integer, nullable=True)

    # 실행 보장 (PRD-Schedule-Execution §2.3)
    GraceMinutes = Column(Integer, nullable=True, default=10)           # 놓친 회차 허용 지연(분)
    MaxDurationMin = Column(Integer, nullable=True, default=60)         # 회차 TTL — 초과 시 강제 종료
    ReturnPolicy = Column(String(10), nullable=True, default="charge")  # charge | place | none
    ReturnPlaceId = Column(Integer, nullable=True)                      # ReturnPolicy=place 일 때 대기장소
    PausedUntil = Column(DateTime, nullable=True)                       # 일시정지 해제 시각 (연속 실패 자동 정지 포함)
    StopActionsOverride = Column(Text, nullable=True)                   # 스케줄 레벨 발화·확인 오버라이드(JSON)

    # 상시 대기 응대 (PRD-Schedule-Execution §3.3) — 운영 시간대·요일·유효기간은 interval 필드를 그대로 쓴다
    StandbyTrigger = Column(String(10), nullable=True, default="button")   # mic | button — 호출 방식
    StandbyDestinations = Column(Text, nullable=True)                      # 응대 허용 목적지 id 목록(콤마). NULL=전체
    StandbyMaxSessionMin = Column(Integer, nullable=True, default=20)      # 응대 1건 최대(분) — 초과 시 강제 복귀
    StandbyRetryCount = Column(Integer, nullable=True, default=2)          # 못 알아들었을 때 되묻는 횟수
    StandbyRetryWindowSec = Column(Integer, nullable=True, default=10)     # 되묻고 기다리는 시간(초)
    StandbyIdleSitSec = Column(Integer, nullable=True, default=40)         # 대기 중 SIT 전환 임계(4족 과열 보호)


class ScheduleRun(Base):
    """스케줄 회차 실행 이력 (PRD-Schedule-Execution §2.2).

    ScheduleInfo 는 '등록된 반복 규칙'이고 이 테이블은 '개별 회차'다.
    (ScheduleId, PlannedAt) 유니크가 중복 실행 방지 키이자 grace 판정 근거 —
    LastRunDate 시:분 비교로는 지연 실행을 표현할 수 없다.
    """
    __tablename__ = "schedule_run"
    __table_args__ = (UniqueConstraint("ScheduleId", "PlannedAt", name="uq_schedule_run_planned"),)

    id = Column(Integer, primary_key=True, index=True)
    ScheduleId = Column(Integer, index=True, nullable=False)   # FK 미설정 — 스케줄이 지워져도 이력은 남는다
    SeriesGroupId = Column(String(36), nullable=True, index=True)
    WorkName = Column(String(100), nullable=True)              # 비정규화: 삭제된 스케줄의 이력도 읽히게
    RobotName = Column(String(50), nullable=True, index=True)
    PlannedAt = Column(DateTime, nullable=False, index=True)   # 예정 시각 = 회차 식별 키
    StartedAt = Column(DateTime, nullable=True)
    EndedAt = Column(DateTime, nullable=True)
    Result = Column(String(20), nullable=False)                # running/success/completed_delayed/missed/skipped_offline/timeout/aborted/cancelled/error
    Reason = Column(String(200), nullable=True)                # 알림 본문에 그대로 쓰인다
    DelaySec = Column(Integer, nullable=True)                  # 예정 대비 지연(초)
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)


class ServiceSession(Base):
    """응대 세션 — 상시 대기에서 '한 사람을 안내한 건' (PRD-Schedule-Execution §3.3 b).

    ScheduleRun(회차)과 별개다. 상시 대기는 하루 1 run 안에서 N건의 세션이 생긴다.
    run 은 "오늘 대기 근무를 했는가", session 은 "그중 몇 명을 안내했는가".
    """
    __tablename__ = "service_session"

    id = Column(Integer, primary_key=True, index=True)
    ScheduleId = Column(Integer, index=True, nullable=True)    # 작업 없이 받은 호출이면 NULL
    RunId = Column(Integer, nullable=True, index=True)      # 소속 회차(ScheduleRun.id)
    RobotName = Column(String(50), nullable=True, index=True)

    StartedAt = Column(DateTime, nullable=False)
    EndedAt = Column(DateTime, nullable=True)
    ReturnedAt = Column(DateTime, nullable=True)            # 대기장소 복귀 완료 — 세션의 진짜 끝

    Heard = Column(String(300), nullable=True)              # STT 원문 / 버튼 호출이면 NULL
    MatchedIntent = Column(String(30), nullable=True)       # navigate 등
    MatchedSlot = Column(String(50), nullable=True)         # 판정된 목적지 표현
    Confidence = Column(Float, nullable=True)
    RetryCount = Column(Integer, nullable=False, default=0) # 되묻기 횟수 (0=한 번에 인식)

    DestinationId = Column(Integer, nullable=True)          # LocationInfo.id
    DestinationName = Column(String(100), nullable=True)

    Result = Column(String(24), nullable=False)             # running/completed/completed_delayed/no_match/unknown_dest/nav_failed/aborted_*
    ExtendedCount = Column(Integer, nullable=False, default=0)  # 세션 연장 횟수 (0~2)
    Reason = Column(String(200), nullable=True)
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)


# =========================
# 로봇 모듈 (장착 장비 registry)
# =========================
class RobotModule(Base):
    __tablename__ = "robot_module"

    id = Column(Integer, primary_key=True, index=True)
    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), nullable=False)
    ParentModuleId = Column(Integer, ForeignKey("robot_module.id", ondelete="CASCADE"), nullable=True)
    ModuleType = Column(String(20), nullable=False)             # camera, arm, gripper, sensor
    Label = Column(String(50), nullable=False)                  # "전방", "후방", "UR5e"
    IsBuiltIn = Column(Integer, default=0)                      # 1=내장, 0=외장
    IsActive = Column(Integer, default=1)
    SortOrder = Column(Integer, default=0)
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    parent = relationship("RobotModule", remote_side="RobotModule.id", uselist=False)
    children = relationship("RobotModule", back_populates="parent", cascade="all, delete-orphan")
    camera_info = relationship("ModuleCameraInfo", back_populates="module", uselist=False, cascade="all, delete-orphan")
    arm_info = relationship("ModuleArmInfo", back_populates="module", uselist=False, cascade="all, delete-orphan")
    recordings = relationship("RecordingInfo", back_populates="module", cascade="all, delete-orphan")


# =========================
# 카메라 모듈 상세 정보
# =========================
class ModuleCameraInfo(Base):
    __tablename__ = "module_camera_info"

    id = Column(Integer, primary_key=True, index=True)
    ModuleId = Column(Integer, ForeignKey("robot_module.id", ondelete="CASCADE"), unique=True, nullable=False)
    StreamType = Column(String(10), nullable=False)             # rtsp | ws | http
    CameraIP = Column(String(45), nullable=True)                # NULL → RobotIP 사용
    Port = Column(Integer, nullable=True)                       # 8554 (RTSP), 8765 (WS), 8554 (HTTP MJPEG)
    Path = Column(String(100), nullable=True)                   # /video1, /video2, /stream

    module = relationship("RobotModule", back_populates="camera_info")


# =========================
# 팔(arm) 모듈 상세 정보
# =========================
class ModuleArmInfo(Base):
    """RM 6축 팔 등 arm 모듈의 연결 상세.

    팔은 관제 서버에서 직접 안 보이는 경우가 많아(사설망 뒤) Firefly arm-agent 경유로 접속한다:
      관제 → AgentHost:AgentPort(arm-agent) → ArmIP:ArmPort(사설망 팔).
    이 등록값이 arm 제어 서비스(/robot/arm/*)에 주소를 제공한다(실 연결은 RM 콘솔 소관).
    """
    __tablename__ = "module_arm_info"

    id = Column(Integer, primary_key=True, index=True)
    ModuleId = Column(Integer, ForeignKey("robot_module.id", ondelete="CASCADE"), unique=True, nullable=False)
    Vendor = Column(String(30), nullable=True)                  # realman
    Model = Column(String(30), nullable=True)                   # RM65-B
    AgentHost = Column(String(45), nullable=True)               # arm-agent 호스트 (예: 192.168.1.103 Firefly)
    AgentPort = Column(Integer, nullable=True)                  # arm-agent 포트 (예: 12346)
    ArmIP = Column(String(45), nullable=True)                   # 사설망 팔 IP (예: 192.168.137.x) — agent가 사용
    ArmPort = Column(Integer, nullable=True)                    # 팔 제어 포트 (예: 8080)
    DoF = Column(Integer, nullable=True)                        # 자유도 (예: 6)

    module = relationship("RobotModule", back_populates="arm_info")


# =========================
# 엘리베이터 / 층 정차 (다층 자율 조작·전환의 좌표 소스)
# =========================
class ElevatorInfo(Base):
    """사업장 내 엘리베이터. 서비스 층은 ElevatorFloorStop 행으로 정의된다."""
    __tablename__ = "elevator_info"

    id = Column(Integer, primary_key=True, index=True)
    BusinessId = Column(Integer, nullable=False, index=True)
    Name = Column(String(50), nullable=False)                   # "본관 승객용" 등
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    stops = relationship("ElevatorFloorStop", back_populates="elevator", cascade="all, delete-orphan")


class ElevatorFloorStop(Base):
    """엘리베이터가 정차하는 층 + 그 층의 FSM 좌표 3종(로비진입/패널정위치/내부정지).

    POI는 기존 LocationInfo(맵 편집에서 찍은 장소) id 를 참조만 한다(새 좌표 입력 UI 없음).
    자율 전환은 3종 POI + 맵이 모두 지정된('완료') 층 사이에서만 허용한다(백엔드 가드는 후속).
    """
    __tablename__ = "elevator_floor_stop"

    id = Column(Integer, primary_key=True, index=True)
    ElevatorId = Column(Integer, ForeignKey("elevator_info.id", ondelete="CASCADE"), nullable=False, index=True)
    FloorId = Column(Integer, nullable=False)
    MapId = Column(Integer, nullable=True)              # 그 층의 대상 맵
    LobbyLocationId = Column(Integer, nullable=True)    # 엘리베이터 문 앞(하차 재측위 seed)
    PanelLocationId = Column(Integer, nullable=True)    # 패널 조작 정위치
    InsideLocationId = Column(Integer, nullable=True)   # 내부 정지점

    elevator = relationship("ElevatorInfo", back_populates="stops")


# =========================
# 자동문 (시설 장치 — 엘리베이터의 형제 테이블, 다형 상속 아님)
# =========================
class DoorInfo(Base):
    """자동 개폐문. 층 이동이 없어 층 1개 × POI 2개로 끝난다(엘리베이터는 층 N × POI 3).

    POI는 ElevatorFloorStop과 마찬가지로 기존 LocationInfo(맵 편집 산출물) id 참조만 한다.
    Near→Far 순서가 통과 방향이며, 반대 방향은 런타임에서 Far→Near로 해석한다.
    """
    __tablename__ = "door_info"

    id = Column(Integer, primary_key=True, index=True)
    BusinessId = Column(Integer, nullable=False, index=True)
    Name = Column(String(50), nullable=False)                   # "본관 1층 정문" 등

    FloorId = Column(Integer, nullable=True)
    MapId = Column(Integer, nullable=True)
    NearLocationId = Column(Integer, nullable=True)             # 문 안쪽 대기점
    FarLocationId = Column(Integer, nullable=True)              # 문 바깥쪽 대기점

    # auto_sensor | gpio | ble | rm_vision | manual — manual(상시 개방) 폴백 상시 지원
    ControlType = Column(String(20), nullable=True)
    ControlConfig = Column(JSON, nullable=True)                 # 드라이버별 설정(호스트/채널/버튼 POI 등)
    DetectType = Column(String(10), nullable=False, default="none")   # none | vision(door_open/door_closed)

    OpenTimeoutSec = Column(Integer, nullable=False, default=20)     # 열림 대기 한도 → 초과 시 FALLBACK
    PassTimeoutSec = Column(Integer, nullable=False, default=30)     # 통과 제한 → 초과 시 후진 폴백

    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


# =========================
# 로봇 마지막 상태 (로봇당 1행)
# =========================
class RobotLastStatus(Base):
    __tablename__ = "robot_last_status"

    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), primary_key=True)
    # Battery (1=Left or SOC, 2=Right or NULL)
    BatteryLevel1 = Column(SmallInteger, nullable=True)
    BatteryLevel2 = Column(SmallInteger, nullable=True)
    Voltage1 = Column(Float, nullable=True)
    Voltage2 = Column(Float, nullable=True)
    BatteryTemp1 = Column(Float, nullable=True)
    BatteryTemp2 = Column(Float, nullable=True)
    IsCharging1 = Column(SmallInteger, nullable=True)
    IsCharging2 = Column(SmallInteger, nullable=True)
    # Position
    PosX = Column(Double, nullable=True)
    PosY = Column(Double, nullable=True)
    PosYaw = Column(Double, nullable=True)
    CurrentFloorId = Column(Integer, nullable=True)
    # Heartbeat
    LastHeartbeat = Column(DateTime, nullable=True)
    # Working
    IsWorking = Column(SmallInteger, default=0, nullable=False, server_default="0")
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


# =========================
# 로봇 통신 엔드포인트 (로봇별 다중 IP/포트 등록)
# =========================
# 전역 ROBOT_IP/RECEIVER_IP(env) 단일 로봇 가정을 벗어나, 로봇마다 통신 대상을
# DB로 등록·조회하기 위한 테이블. 이기종 확장을 위해 Role 기반으로 여러 엔드포인트를
# 가진다(ASDU: receiver+robot / X30: motion+perception+nav / Autoxing: local).
# create_all 로 자동 생성되며, 행이 없으면 리졸버가 RobotInfo.RobotIP → env 로 폴백한다.
class RobotEndpoint(Base):
    __tablename__ = "robot_endpoint"

    id = Column(Integer, primary_key=True, autoincrement=True)
    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), nullable=False, index=True)
    # 통신 대상 역할: receiver | robot | motion | perception | nav | local
    Role = Column(String(20), nullable=False)
    Ip = Column(String(45), nullable=True)
    UdpPort = Column(Integer, nullable=True)
    TcpPort = Column(Integer, nullable=True)
    # 이기종 추가 필드(예: Autoxing local secret, ROS setup path 등) JSON
    Extra = Column(JSON, nullable=True)
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("RobotId", "Role", name="uq_robot_endpoint_role"),)

    robot = relationship("RobotInfo")


# =========================
# 녹화 정보
# =========================
class RecordingInfo(Base):
    __tablename__ = "recording_info"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    RobotId       = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), nullable=False)
    ModuleId      = Column(Integer, ForeignKey("robot_module.id", ondelete="CASCADE"), nullable=False)
    ScheduleId    = Column(Integer, ForeignKey("schedule_info.id", ondelete="SET NULL"), nullable=True)
    GroupId       = Column(String(36), nullable=False, index=True)   # UUID — 같은 녹화 세션 묶음
    RecordType    = Column(String(10), nullable=False)               # "auto" | "manual"
    VideoPath     = Column(String(500), nullable=True)
    ThumbnailPath = Column(String(500), nullable=True)
    VideoSize     = Column(Integer, nullable=True)                   # bytes
    Status        = Column(String(20), nullable=False, default="recording")  # recording|completed|error|archived
    ErrorReason   = Column(String(200), nullable=True)               # 에러 시 사유
    RecordStart   = Column(DateTime, nullable=False)
    RecordEnd     = Column(DateTime, nullable=True)
    CreatedAt     = Column(DateTime, server_default=func.now(), nullable=False)
    DeletedAt     = Column(DateTime, nullable=True, default=None)    # soft delete

    module   = relationship("RobotModule", back_populates="recordings")
    robot    = relationship("RobotInfo")
    schedule = relationship("ScheduleInfo")


# ==========================================================
# 음성 Q&A (FAQ·의도) 관리  — PRD-VOICE-FAQ
# 원본(source of truth) = 관제 DB. 로봇은 동기화된 로컬 캐시를 읽는다.
# ==========================================================

class VoiceIntent(Base):
    """화면상의 '시나리오' 1건 (로봇별). 질문 N개 ↔ 답변 N개."""
    __tablename__ = "voice_intent"

    id = Column(Integer, primary_key=True, index=True)
    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), nullable=False, index=True)
    Name = Column(String(50), nullable=False)          # 엔진 키(자동 생성). UI 미노출.
    DisplayName = Column(String(40), nullable=False)   # 운영자가 입력하는 시나리오명
    ActionType = Column(String(20), nullable=False, default="none")   # none | navigate | stop
    ConfirmText = Column(String(200), nullable=True)
    LangCode = Column(String(5), nullable=False, default="ko")        # 다국어는 Non-Goal. 확장 여지만 확보.
    IsActive = Column(Integer, nullable=False, default=1)
    SortOrder = Column(Integer, nullable=False, default=0)
    UpdatedBy = Column(Integer, ForeignKey("user_info.id", ondelete="SET NULL"), nullable=True)
    AppliedAt = Column(DateTime, nullable=True)        # 로봇에 마지막으로 반영된 시각. NULL/UpdatedAt 이전 → 미적용
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("RobotId", "Name", name="uq_voice_intent_robot_name"),)

    examples = relationship("VoiceIntentExample", back_populates="intent",
                            cascade="all, delete-orphan", order_by="VoiceIntentExample.SortOrder")
    responses = relationship("VoiceIntentResponse", back_populates="intent",
                             cascade="all, delete-orphan", order_by="VoiceIntentResponse.SortOrder")


class VoiceIntentExample(Base):
    """질문(발화 예시). 최소 2, 최대 20."""
    __tablename__ = "voice_intent_example"

    id = Column(Integer, primary_key=True, index=True)
    IntentId = Column(Integer, ForeignKey("voice_intent.id", ondelete="CASCADE"), nullable=False, index=True)
    Text = Column(String(60), nullable=False)
    IsKeyword = Column(Integer, nullable=False, default=0)   # 1 = 키워드형(단답·소음 대비)
    SortOrder = Column(Integer, nullable=False, default=0)

    intent = relationship("VoiceIntent", back_populates="examples")


class VoiceIntentResponse(Base):
    """답변. 최소 1, 최대 20. 2개 이상이면 로봇이 무작위로 하나를 골라 말한다."""
    __tablename__ = "voice_intent_response"

    id = Column(Integer, primary_key=True, index=True)
    IntentId = Column(Integer, ForeignKey("voice_intent.id", ondelete="CASCADE"), nullable=False, index=True)
    Text = Column(String(400), nullable=False)
    SortOrder = Column(Integer, nullable=False, default=0)

    intent = relationship("VoiceIntent", back_populates="responses")


class VoiceSlotValue(Base):
    """목적지 사전 + 동의어 (로봇별).

    LocationId 는 좌표를 '복사'하지 않고 FK로만 건다 — 맵에서 장소를 옮기면 음성 목적지도 따라간다.
    ON DELETE SET NULL 은 최후의 안전망이며, 정상 경로에서는 애플리케이션이 함께 삭제한다.
    """
    __tablename__ = "voice_slot_value"

    id = Column(Integer, primary_key=True, index=True)
    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), nullable=False, index=True)
    SlotName = Column(String(20), nullable=False, default="목적지")
    Value = Column(String(50), nullable=False)
    Synonyms = Column(String(300), nullable=True)     # "응급센터,이머전시" (쉼표 구분)
    LocationId = Column(Integer, ForeignKey("location_info.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (UniqueConstraint("RobotId", "SlotName", "Value", name="uq_voice_slot_robot_name_value"),)


class VoiceConfirmWord(Base):
    """음성 인식어 (로봇별 · 종류별).

    로봇이 들은 말을 **통과로 볼지** 판정하는 기준. 판정은 서버가 하고 로봇은 들은 말만
    올린다 — 기준이 코드에 박혀 있으면 운영자가 볼 수도 고칠 수도 없고, 안내 멘트가
    유도하는 말과 어긋나도 알 방법이 없다(실제로 '이동하자'로 어긋났다).

    `Kind` 로 쓰임을 나눈다:
      - `arrival` — 경유지 도착 확인("이동", "네")
      - `dismiss` — 안내를 마치고 돌아가도 되는지("없음", "괜찮아요")
    둘은 같은 자리에서 쓰이지 않으므로 섞으면 안 된다. '없음' 이 도착 확인을 통과시키거나
    '이동' 이 로봇을 돌려보내면 곤란하다.

    부분 문자열로 대조한다 — '이동' 하나면 '이동해줘'·'이동합시다' 가 모두 걸린다.
    행이 없으면 코드의 기본 목록으로 폴백한다(테이블이 비어도 동작이 끊기지 않게).
    """
    __tablename__ = "voice_confirm_word"

    KIND_ARRIVAL = "arrival"
    KIND_DISMISS = "dismiss"

    id = Column(Integer, primary_key=True, index=True)
    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), nullable=False, index=True)
    Kind = Column(String(16), nullable=False, default=KIND_ARRIVAL, index=True)
    Word = Column(String(30), nullable=False)
    IsActive = Column(Integer, nullable=False, default=1)
    SortOrder = Column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("RobotId", "Kind", "Word", name="uq_voice_confirm_robot_kind_word"),)


class VoiceConfig(Base):
    """로봇별 음성 튜닝값 (1:1)."""
    __tablename__ = "voice_config"

    id = Column(Integer, primary_key=True, index=True)
    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), unique=True, nullable=False)
    MatchThreshold = Column(Float, nullable=False, default=0.55)
    ConfirmOnAction = Column(Integer, nullable=False, default=0)
    FallbackResponse = Column(String(300), nullable=False, default="죄송합니다. 다시 한 번 말씀해 주시겠어요?")
    SlotFuzzyThreshold = Column(Float, nullable=False, default=0.75)
    SlotFuzzyMinLen = Column(Integer, nullable=False, default=4)
    # 아래 3개는 UI 미노출(잘못 만지면 인식률이 붕괴하는데 되돌릴 방법이 없다). 개발자가 DB로 조정.
    SilenceMs = Column(Integer, nullable=False, default=700)
    TtsSpeed = Column(Float, nullable=False, default=1.0)
    SttModel = Column(String(10), nullable=False, default="small")


class VoiceDialogLog(Base):
    """대화 로그. 적재만 하고 통계 화면은 Phase 5.
    지금 쌓지 않으면 '응답 실패 주요 키워드'(= 다음에 만들 시나리오)를 나중에 만들 수 없다."""
    __tablename__ = "voice_dialog_log"

    id = Column(Integer, primary_key=True, index=True)
    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), nullable=False, index=True)
    Heard = Column(String(200), nullable=False)        # STT가 받아쓴 사용자 발화
    IntentId = Column(Integer, ForeignKey("voice_intent.id", ondelete="SET NULL"), nullable=True)  # NULL = 응답 실패
    Score = Column(Float, nullable=True)
    SlotValue = Column(String(50), nullable=True)
    Acted = Column(Integer, nullable=False, default=0)  # 실제 이동/정지까지 이어졌는가
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False, index=True)


class VoiceAnnouncement(Base):
    """안내 멘트 — 경유지 도착 시 로봇이 말할 순수 발화 문구 (로봇별).

    시나리오(VoiceIntent)와 별 유형: 질문·매칭이 없는 일방향 발화라 예시 질문 강제가 없다.
    경로 정지 옵션(WayInfo.StopActions)이 이 문구를 announceId 로 참조하고, 로봇 적용 시
    announceText 로 스냅샷을 구워 내려보낸다(오프라인 발화). PRD-Waypoint-Arrival-Interaction §4.1.
    """
    __tablename__ = "voice_announcement"

    id = Column(Integer, primary_key=True, index=True)
    RobotId = Column(Integer, ForeignKey("robot_info.id", ondelete="CASCADE"), nullable=False, index=True)
    Label = Column(String(40), nullable=False)         # 발화명 — 정지 옵션 드롭다운 표시용(필수·로봇별 유일)
    Text = Column(String(200), nullable=False)         # 실제 발화 문구
    IsActive = Column(Integer, nullable=False, default=1)
    SortOrder = Column(Integer, nullable=False, default=0)
    UpdatedBy = Column(Integer, ForeignKey("user_info.id", ondelete="SET NULL"), nullable=True)
    AppliedAt = Column(DateTime, nullable=True)        # 로봇에 마지막으로 반영된 시각. NULL/UpdatedAt 이전 → 미적용
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class ModuleVoiceInfo(Base):
    """음성 모듈 상세 (1:1). ModuleCameraInfo 와 동형.

    RobotModule.IsBuiltIn 이 내장(로봇 IP 사용)/외장(자체 IP)을 구분한다.
    Host 가 NULL 이면 RobotInfo.RobotIP 를 쓴다 — 카메라와 같은 규칙.
    """
    __tablename__ = "module_voice_info"

    id = Column(Integer, primary_key=True, index=True)
    ModuleId = Column(Integer, ForeignKey("robot_module.id", ondelete="CASCADE"), unique=True, nullable=False)
    Host = Column(String(45), nullable=True)           # NULL → RobotIP 사용
    Port = Column(Integer, nullable=False, default=8090)
    # 능력 플래그 — 이게 없으면 "마이크가 있는가"를 판정할 근거가 없어 게이팅이
    # 전부 "운영자가 알아서"가 된다 (PRD-Schedule-Execution §3.3 c).
    HasMic = Column(Integer, nullable=False, default=0)      # 상시 청취(StandbyTrigger=mic) 가능 판정
    HasSpeaker = Column(Integer, nullable=False, default=1)  # TTS 응답 가능 판정
