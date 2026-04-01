from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.Database.database import SessionLocal
from app.Database.models import UserInfo, UserPermission, MenuInfo
from app.auth.jwt_handler import decode_token, decode_token_allow_expired


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> UserInfo:
    """JWT 쿠키에서 현재 사용자를 인증하여 반환."""
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="인증이 필요합니다")

    # 만료 여부 구분을 위해 먼저 만료 허용 디코딩
    payload_any = decode_token_allow_expired(token)
    if not payload_any or payload_any.get("type") != "access":
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")

    # 정상 디코딩 (만료 체크 포함)
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="토큰이 만료되었습니다")

    user_id = int(payload["sub"])
    user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()

    if not user:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다")
    if not user.IsActive:
        raise HTTPException(status_code=401, detail="비활성화된 계정입니다")

    return user


def require_admin(current_user: UserInfo = Depends(get_current_user)) -> UserInfo:
    """관리자 권한 필수."""
    if current_user.Permission != 1:
        raise HTTPException(status_code=403, detail="권한이 없습니다")
    return current_user


def require_permission(menu_key: str):
    """특정 메뉴 접근 권한 검사 (MenuKey 기반). admin은 bypass."""
    def _checker(current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db)) -> UserInfo:
        if current_user.Permission == 1:
            return current_user
        has = (
            db.query(UserPermission)
            .join(MenuInfo, UserPermission.MenuId == MenuInfo.id)
            .filter(
                UserPermission.UserId == current_user.id,
                MenuInfo.MenuKey == menu_key,
            )
            .first()
        )
        if not has:
            raise HTTPException(status_code=403, detail="해당 메뉴에 대한 접근 권한이 없습니다")
        return current_user
    return _checker
