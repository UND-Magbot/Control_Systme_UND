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
    Adminid = Column(String(50))
    RobotName = Column(String(100))
    ProductCompany = Column(String(100))
    SerialNumber = Column(String(100))
    ModelName = Column(String(100))
    Group = Column(String(100))
    SWversion = Column(String(100))
    Site = Column(String(100))
    Adddate = Column(DateTime, server_default=func.now())
    LimitBattery = Column(Integer)

# =========================
# 로봇 위치 정보 (누적)
# =========================
class LocationInfo(Base):
    __tablename__ = "location_info"
    id = Column(Integer, primary_key=True, index=True) 
    Adminid = Column(String(50))
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
    Adminid = Column(String(50))
    RobotName = Column(String(50))
    TaskType = Column(String(50))
    WayName = Column(String(50))
    WayPoints = Column(Text)
    UpdateTime= Column(DateTime)


class ScheduleInfo(Base):
    __tablename__ = "schedule_info"

    id = Column(Integer, primary_key=True)
    Adminid = Column(String(50))
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
