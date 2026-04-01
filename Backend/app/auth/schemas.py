from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ── 요청 ──

class LoginRequest(BaseModel):
    login_id: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=1, max_length=100)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6, max_length=12)


class AccountDeleteRequest(BaseModel):
    password: str = Field(..., min_length=1)


# ── 응답 ──

class UserResponse(BaseModel):
    id: int
    login_id: Optional[str] = None
    user_name: Optional[str] = None
    role: Optional[int] = None
    permissions: list[str] = []

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    user: UserResponse


class MeResponse(BaseModel):
    user: UserResponse


class MessageResponse(BaseModel):
    status: str = "ok"
    message: str = ""
