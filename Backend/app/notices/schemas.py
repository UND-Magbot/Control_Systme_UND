from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime


class NoticeCreateReq(BaseModel):
    Title: str = Field(..., max_length=100)
    Content: str = Field(..., max_length=2000)
    Importance: Literal["high", "normal"] = "normal"
    UserId: int
    AttachmentName: Optional[str] = None
    AttachmentUrl: Optional[str] = None


class NoticeUpdateReq(BaseModel):
    Title: Optional[str] = Field(None, max_length=100)
    Content: Optional[str] = Field(None, max_length=2000)
    Importance: Optional[Literal["high", "normal"]] = None
    AttachmentName: Optional[str] = None
    AttachmentUrl: Optional[str] = None


class NoticeResponse(BaseModel):
    id: int
    Title: str
    Content: str
    Importance: str
    UserId: int
    AttachmentName: Optional[str] = None
    AttachmentUrl: Optional[str] = None
    CreatedAt: datetime
    UpdatedAt: datetime

    class Config:
        from_attributes = True


class NoticeListResponse(BaseModel):
    items: list[NoticeResponse]
    total: int
    page: int
    size: int
