from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db, get_current_user
from app.auth.schemas import (
    LoginRequest,
    LoginResponse,
    MeResponse,
    PasswordChangeRequest,
    AccountDeleteRequest,
    MessageResponse,
    UserResponse,
)
from app.auth.audit import get_client_ip
from app.auth.service import AuthService
from app.auth.constants import REFRESH_TOKEN_EXPIRE_DAYS
from app.auth.jwt_handler import decode_token_allow_expired
from app.Database.models import UserInfo

router = APIRouter(prefix="/api/auth", tags=["인증"])


REFRESH_MAX_AGE = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600  # 7일

def _set_token_cookies(response: Response, access_token: str, refresh_token: str, remember: bool = False):
    """HttpOnly 쿠키에 토큰 설정.
    remember=False: 세션 쿠키 → 브라우저 닫으면 만료
    remember=True: max_age=7일 → 자동 로그인
    """
    max_age = REFRESH_MAX_AGE if remember else None
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=max_age,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=max_age,
    )


def _clear_token_cookies(response: Response):
    """인증 쿠키 삭제."""
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("refresh_token", path="/api/auth")


# ── 로그인 ──

@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    result = AuthService.login(db, body.login_id, body.password, ip_address=ip, remember=body.auto_login)
    _set_token_cookies(response, result["access_token"], result["refresh_token"], remember=body.auto_login)
    return LoginResponse(user=UserResponse(**result["user"]))


# ── 토큰 갱신 ──

@router.post("/refresh", response_model=LoginResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        _clear_token_cookies(response)
        raise HTTPException(status_code=401, detail="리프레시 토큰이 없습니다")

    # refresh_token payload에서 remember 여부 확인
    payload = decode_token_allow_expired(refresh_token)
    remember = payload.get("remember", False) if payload else False

    result = AuthService.refresh(db, refresh_token)
    # access_token 쿠키 갱신 (remember에 따라 max_age 설정)
    max_age = REFRESH_MAX_AGE if remember else None
    response.set_cookie(
        key="access_token",
        value=result["access_token"],
        httponly=True,
        samesite="lax",
        path="/",
        max_age=max_age,
    )
    return LoginResponse(user=UserResponse(**result["user"]))


# ── 로그아웃 ──

@router.post("/logout", response_model=MessageResponse)
def logout(request: Request, response: Response, current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    AuthService.logout(db, current_user.id, ip_address=ip)
    _clear_token_cookies(response)
    return MessageResponse(message="로그아웃 되었습니다")


# ── 현재 사용자 정보 ──

@router.get("/me")
def get_me(request: Request, db: Session = Depends(get_db)):
    try:
        current_user = get_current_user(request, db)
    except HTTPException:
        return {"user": None}
    user_data = AuthService.get_me(db, current_user.id)
    return MeResponse(user=UserResponse(**user_data))


# ── 비밀번호 변경 ──

@router.put("/password", response_model=MessageResponse)
def change_password(body: PasswordChangeRequest, request: Request, response: Response, current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    AuthService.change_password(db, current_user.id, body.current_password, body.new_password, ip_address=ip)
    _clear_token_cookies(response)
    return MessageResponse(message="비밀번호가 변경되었습니다. 다시 로그인해주세요.")


# ── 본인 탈퇴 ──

@router.delete("/account", response_model=MessageResponse)
def delete_account(body: AccountDeleteRequest, request: Request, response: Response, current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    AuthService.delete_account(db, current_user.id, body.password, ip_address=ip)
    _clear_token_cookies(response)
    return MessageResponse(message="계정이 삭제되었습니다")
