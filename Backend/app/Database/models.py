from sqlalchemy import (
    Column,
    Integer,
    String,
    Double,
    Float,
    DateTime,
    Text,
    ForeignKey,
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
    ProductCompany = Column(String(100))
    SerialNumber = Column(String(100))
    ModelName = Column(String(100))
    Group = Column(String(100))
    SWversion = Column(String(100))
    Site = Column(String(100))
    BusinessId = Column(Integer, nullable=True)
    Adddate = Column(DateTime, server_default=func.now())
    LimitBattery = Column(Integer)

# =========================
# 로봇 위치 정보 (누적)
# =========================
class LocationInfo(Base):
    __tablename__ = "location_info"
    id = Column(Integer, primary_key=True, index=True)
    UserId = Column(Integer)
    RobotName = Column(String(100))
    LacationName = Column(String(100))
    Floor = Column(String(50))
    LocationX = Column(Double)
    LocationY = Column(Double)
    Yaw = Column(Double, default=0.0)
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
    Permission = Column(Integer)
    UserName = Column(String(50), nullable=True)


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
    Adddate = Column(DateTime, server_default=func.now())

# =========================
# 영역(층) 정보
# =========================
class AreaInfo(Base):
    __tablename__ = "area_info"
    id = Column(Integer, primary_key=True, index=True)
    BusinessId = Column(Integer, nullable=False)
    FloorName = Column(String(50), nullable=False)  # B1, 1F, 2F 등
    Adddate = Column(DateTime, server_default=func.now())

# =========================
# 로봇 맵 정보
# =========================
class RobotMapInfo(Base):
    __tablename__ = "robot_map_info"
    id = Column(Integer, primary_key=True, index=True)
    BusinessId = Column(Integer, nullable=False)
    AreaId = Column(Integer, nullable=False)
    AreaName = Column(String(100), nullable=False)   # 영역 이름 (사용자 입력)
    PgmFilePath = Column(String(300))
    YamlFilePath = Column(String(300))
    ImgFilePath = Column(String(300))
    InitPosX = Column(Float)
    InitPosY = Column(Float)
    InitYaw = Column(Float)
    Adddate = Column(DateTime, server_default=func.now())


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

    Repeat = Column(String(50), default=False)
    Repeat_Day = Column(String(100))
    Repeat_End = Column(String(50))

    # CreateTime = Column(DateTime)
