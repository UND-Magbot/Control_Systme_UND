from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ── 요청 ──

class UserCreateRequest(BaseModel):
    login_id: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=16)
    user_name: str = Field(..., min_length=1, max_length=50)
    permission: int = Field(default=3, ge=1, le=3)  # 1=superadmin, 2=admin, 3=user
    business_id: Optional[int] = None
    menu_ids: Optional[list[str]] = None  # 생성 시 메뉴 권한 자동 설정


class UserUpdateRequest(BaseModel):
    user_name: Optional[str] = Field(None, min_length=1, max_length=50)
    permission: Optional[int] = Field(None, ge=1, le=3)
    is_active: Optional[int] = Field(None, ge=0, le=1)


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=16)


class PermissionUpdateRequest(BaseModel):
    menu_ids: list[str]


# ── 응답 ──

class UserListItem(BaseModel):
    id: int
    login_id: Optional[str] = None
    user_name: Optional[str] = None
    permission: Optional[int] = None
    is_active: Optional[int] = None
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    items: list[UserListItem]
    total: int
    page: int
    size: int


class UserDetailResponse(BaseModel):
    id: int
    login_id: Optional[str] = None
    user_name: Optional[str] = None
    permission: Optional[int] = None
    is_active: Optional[int] = None
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    permissions: list[str] = []

    class Config:
        from_attributes = True


class PermissionResponse(BaseModel):
    menu_ids: list[str]


# ── 메뉴 관리 (superadmin 전용) ──

class MenuUpdateRequest(BaseModel):
    menu_name: Optional[str] = Field(None, min_length=1, max_length=100)
    sort_order: Optional[int] = Field(None, ge=1, le=999)
    is_visible: Optional[bool] = None


class MenuAdminItem(BaseModel):
    id: int
    menu_key: str
    menu_name: str
    parent_id: Optional[int] = None
    sort_order: int
    is_group: bool
    is_visible: bool


class MenuPresetResponse(BaseModel):
    permission: int
    menu_keys: list[str]
