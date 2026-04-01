from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class BusinessCreateReq(BaseModel):
    BusinessName: str
    ZipCode: Optional[str] = None
    Address: Optional[str] = None
    AddressDetail: Optional[str] = None
    RepresentName: Optional[str] = None
    Contact: Optional[str] = None
    Description: Optional[str] = None


class BusinessUpdateReq(BaseModel):
    BusinessName: Optional[str] = None
    ZipCode: Optional[str] = None
    Address: Optional[str] = None
    AddressDetail: Optional[str] = None
    RepresentName: Optional[str] = None
    Contact: Optional[str] = None
    Description: Optional[str] = None


class BusinessResponse(BaseModel):
    id: int
    BusinessName: str
    ZipCode: Optional[str] = None
    Address: Optional[str] = None
    AddressDetail: Optional[str] = None
    RepresentName: Optional[str] = None
    Contact: Optional[str] = None
    Description: Optional[str] = None
    AreaCount: int = 0
    RobotCount: int = 0
    CreatedAt: Optional[datetime] = None
    UpdatedAt: Optional[datetime] = None

    class Config:
        from_attributes = True


class BusinessListResponse(BaseModel):
    items: List[BusinessResponse]
    total: int
    page: int
    size: int


class AreaCreateReq(BaseModel):
    BusinessId: int
    FloorName: str


class AreaResponse(BaseModel):
    id: int
    BusinessId: int
    FloorName: str
    CreatedAt: Optional[datetime] = None

    class Config:
        from_attributes = True
