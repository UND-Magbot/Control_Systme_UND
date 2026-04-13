from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class NoticeDetail(BaseModel):
    Title: str
    Content: str
    Importance: str
    UserId: int
    UserName: Optional[str] = None
    AttachmentName: Optional[str] = None
    AttachmentUrl: Optional[str] = None
    AttachmentSize: Optional[int] = None

    class Config:
        from_attributes = True


class AlertResponse(BaseModel):
    id: int
    Type: str
    Status: Optional[str] = None
    Content: str
    Detail: Optional[str] = None
    ErrorJson: Optional[str] = None
    RobotName: Optional[str] = None
    date: str                          # YYYY-MM-DD HH:mm 형식
    isRead: bool
    NoticeId: Optional[int] = None
    notice: Optional[NoticeDetail] = None

    class Config:
        from_attributes = True


class UnreadCountResponse(BaseModel):
    total: int
    robot: int
    schedule: int
    notice: int


class AlertListResponse(BaseModel):
    items: list[AlertResponse]
    total: int
    page: int
    size: int
    unread_count: UnreadCountResponse
