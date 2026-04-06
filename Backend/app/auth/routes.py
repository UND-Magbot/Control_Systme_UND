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
from app.Database.models import UserInfo

router = APIRouter(prefix="/api/auth", tags=["인증"])


REFRESH_MAX_AGE = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600  # 7일

def _set_token_cookies(response: Response, access_token: str, refresh_token: str):
    """HttpOnly 쿠키에 토큰 설정.
    access_token 쿠키 수명은 refresh_token과 동일하게 7일.
    실제 만료 판단은 JWT exp 클레임이 담당하고,
    쿠키 max_age는 '브라우저가 쿠키를 보관하는 기간'만 의미한다.
    """
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=REFRESH_MAX_AGE,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=REFRESH_MAX_AGE,
    )


def _clear_token_cookies(response: Response):
    """인증 쿠키 삭제."""
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    # 기존 path="/api/auth" 쿠키가 브라우저에 남아있을 수 있으므로 함께 삭제
    response.delete_cookie("refresh_token", path="/api/auth")


# ── 로그인 ──

@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    result = AuthService.login(db, body.login_id, body.password, ip_address=ip)
    # 이전 path="/api/auth" 쿠키가 남아있으면 충돌하므로 먼저 삭제
    response.delete_cookie("refresh_token", path="/api/auth")
    _set_token_cookies(response, result["access_token"], result["refresh_token"])
    return LoginResponse(user=UserResponse(**result["user"]))


# ── 토큰 갱신 ──

@router.post("/refresh", response_model=LoginResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        _clear_token_cookies(response)
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="리프레시 토큰이 없습니다")

    result = AuthService.refresh(db, refresh_token)
    response.delete_cookie("refresh_token", path="/api/auth")
    # access_token 쿠키만 갱신 (refresh_token은 로그인 시 발급된 것 유지)
    response.set_cookie(
        key="access_token",
        value=result["access_token"],
        httponly=True,
        samesite="lax",
        path="/",
        max_age=REFRESH_MAX_AGE,
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
    token = request.cookies.get("access_token")
    if not token:
        return {"user": None}
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
