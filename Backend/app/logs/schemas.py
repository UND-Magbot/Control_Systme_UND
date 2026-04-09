from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class LogCreateReq(BaseModel):
    Category: str = Field(..., max_length=20)
    Action: str = Field(..., max_length=50)
    Message: str = Field(..., max_length=500)
    Detail: Optional[str] = None
    RobotId: Optional[int] = None
    RobotName: Optional[str] = None


class LogResponse(BaseModel):
    id: int
    Category: str
    Action: str
    Message: str
    Detail: Optional[str] = None
    RobotId: Optional[int] = None
    RobotName: Optional[str] = None
    CreatedAt: datetime

    class Config:
        from_attributes = True


class LogListResponse(BaseModel):
    items: list[LogResponse]
    total: int
    page: int
    size: int
    earliest_date: Optional[str] = None
