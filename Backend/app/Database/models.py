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
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.Database.database import Base

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

    # 스케줄러 추적
    LastRunDate = Column(DateTime, nullable=True)
    RunCount = Column(Integer, default=0)
    MaxRunCount = Column(Integer, nullable=True)


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
    recordings = relationship("RecordingInfo", back_populates="module", cascade="all, delete-orphan")


# =========================
# 카메라 모듈 상세 정보
# =========================
class ModuleCameraInfo(Base):
    __tablename__ = "module_camera_info"

    id = Column(Integer, primary_key=True, index=True)
    ModuleId = Column(Integer, ForeignKey("robot_module.id", ondelete="CASCADE"), unique=True, nullable=False)
    StreamType = Column(String(10), nullable=False)             # rtsp | ws
    CameraIP = Column(String(45), nullable=True)                # NULL → RobotIP 사용
    Port = Column(Integer, nullable=True)                       # 8554 (RTSP), 8765 (WS)
    Path = Column(String(100), nullable=True)                   # /video1, /video2

    module = relationship("RobotModule", back_populates="camera_info")


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
    CreatedAt = Column(DateTime, server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


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
