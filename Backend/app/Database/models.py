from sqlalchemy import (
    Column,
    Integer,
    String,
    Double,
    Float,
    DateTime,
    Text
)
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
    CreatedAt = Column(DateTime, server_default=func.now())
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
    MapId = Column(Integer)
    Imformation = Column(String(100))

# =========================
# 로그 / 이벤트 정보
# =========================
# class LogDataInfo(Base):
#     __tablename__ = "logdata_info"



# =========================
# 사용자 정보
# =========================
# class UserInfo(Base):
#     __tablename__ = "user_info"


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
    Address = Column(String(200))
    CreatedAt = Column(DateTime, server_default=func.now())

# =========================
# 영역(층) 정보
# =========================
class AreaInfo(Base):
    __tablename__ = "area_info"
    id = Column(Integer, primary_key=True, index=True)
    BusinessId = Column(Integer, nullable=False)
    FloorName = Column(String(50), nullable=False)  # B1, 1F, 2F 등
    CreatedAt = Column(DateTime, server_default=func.now())

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

    Repeat = Column(String(50), default=False)
    Repeat_Day = Column(String(100))       
    Repeat_End = Column(String(50))        

    # CreateTime = Column(DateTime)
