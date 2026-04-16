import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.database.models import UserInfo, UserPermission, MenuInfo
from app.auth.audit import write_audit
from app.auth.password import hash_password, verify_password, validate_password_format
from app.auth.jwt_handler import create_access_token, create_refresh_token, decode_token


class AuthService:

    # ── 로그인 ──

    @staticmethod
    def login(db: Session, login_id: str, password: str, ip_address: str | None = None, remember: bool = False) -> dict:
        user = (
            db.query(UserInfo)
            .filter(UserInfo.LoginId == login_id, UserInfo.DeletedAt.is_(None))
            .first()
        )

        if not user:
            write_audit(db, None, "login_failed", ip_address=ip_address,
                                     detail=json.dumps({"login_id": login_id, "reason": "USER_NOT_FOUND"}))
            raise HTTPException(status_code=401, detail="존재하지 않는 아이디입니다")

        if not user.IsActive:
            write_audit(db, user.id, "login_failed", ip_address=ip_address,
                                     detail=json.dumps({"reason": "USER_DISABLED"}))
            raise HTTPException(status_code=401, detail="비활성화된 계정입니다")

        if not verify_password(password, user.Password):
            write_audit(db, user.id, "login_failed", ip_address=ip_address,
                                     detail=json.dumps({"reason": "WRONG_PASSWORD"}))
            raise HTTPException(status_code=401, detail="비밀번호가 일치하지 않습니다")

        # 다중 서버 동시 로그인 허용 — 로그인 시 기존 세션을 무효화하지 않음
        user.LastLoginAt = datetime.now(timezone.utc)
        db.commit()

        # 토큰 발급 (refresh token에 버전 내장)
        access_token = create_access_token(user.id, user.LoginId, user.UserName, user.Permission, user.TokenVersion or 0)
        refresh_token = create_refresh_token(user.id, user.TokenVersion, remember=remember)

        # 권한 목록 조회
        permissions = AuthService._get_permissions(db, user)

        write_audit(db, user.id, "login", ip_address=ip_address)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "id": user.id,
                "login_id": user.LoginId,
                "user_name": user.UserName,
                "role": user.Permission,
                "permissions": permissions,
            },
        }

    # ── 토큰 갱신 ──

    @staticmethod
    def refresh(db: Session, refresh_token: str) -> dict:
        """JWT 서명+만료 검증 → 토큰 버전 비교 (정수 비교, 해시 아님)."""
        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="리프레시 토큰이 유효하지 않습니다")

        user_id = int(payload["sub"])
        token_version = payload.get("ver", 0)

        user = (
            db.query(UserInfo)
            .filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None))
            .first()
        )

        if not user or not user.IsActive:
            raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다")

        # 토큰 버전 비교 — JWT 안의 숫자 vs DB의 숫자
        if token_version != (user.TokenVersion or 0):
            raise HTTPException(status_code=401, detail="토큰이 무효화되었습니다")

        new_access = create_access_token(user.id, user.LoginId, user.UserName, user.Permission, user.TokenVersion or 0)
        permissions = AuthService._get_permissions(db, user)

        return {
            "access_token": new_access,
            "user": {
                "id": user.id,
                "login_id": user.LoginId,
                "user_name": user.UserName,
                "role": user.Permission,
                "permissions": permissions,
            },
        }

    # ── 로그아웃 ──

    @staticmethod
    def logout(db: Session, user_id: int, ip_address: str | None = None):
        user = db.query(UserInfo).filter(UserInfo.id == user_id).first()
        if user:
            user.TokenVersion = (user.TokenVersion or 0) + 1
            db.commit()
        write_audit(db, user_id, "logout", ip_address=ip_address)

    # ── 현재 사용자 정보 ──

    @staticmethod
    def get_me(db: Session, user_id: int) -> dict:
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다")

        permissions = AuthService._get_permissions(db, user)
        return {
            "id": user.id,
            "login_id": user.LoginId,
            "user_name": user.UserName,
            "role": user.Permission,
            "permissions": permissions,
            "business_id": user.BusinessId,
        }

    # ── 비밀번호 변경 ──

    @staticmethod
    def change_password(db: Session, user_id: int, current_password: str, new_password: str, ip_address: str | None = None):
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다")

        if not verify_password(current_password, user.Password):
            raise HTTPException(status_code=400, detail="현재 비밀번호가 일치하지 않습니다")

        if not validate_password_format(new_password):
            raise HTTPException(status_code=422, detail="영문, 숫자, 특수문자 조합 6~16자리로 입력하세요")

        if verify_password(new_password, user.Password):
            raise HTTPException(status_code=400, detail="현재 비밀번호와 다른 비밀번호를 입력하세요")

        user.Password = hash_password(new_password)
        user.TokenVersion = (user.TokenVersion or 0) + 1  # 기존 세션 무효화
        db.commit()

        write_audit(db, user_id, "password_changed", ip_address=ip_address)

    # ── 본인 탈퇴 ──

    @staticmethod
    def delete_account(db: Session, user_id: int, password: str, ip_address: str | None = None):
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다")

        if not verify_password(password, user.Password):
            raise HTTPException(status_code=400, detail="비밀번호가 일치하지 않습니다")

        # 마지막 관리자 보호
        if user.Permission == 1:
            admin_count = db.query(UserInfo).filter(
                UserInfo.Permission == 1,
                UserInfo.DeletedAt.is_(None),
                UserInfo.IsActive == 1,
            ).count()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="마지막 관리자 계정은 삭제할 수 없습니다")

        user.DeletedAt = datetime.now(timezone.utc)
        user.TokenVersion = (user.TokenVersion or 0) + 1
        db.commit()

        write_audit(db, user_id, "account_deleted", target_type="user", target_id=user_id, ip_address=ip_address)

    # ── 내부 유틸 ──

    @staticmethod
    def _get_permissions(db: Session, user: UserInfo) -> list[str]:
        """사용자 메뉴 권한의 MenuKey 목록 반환."""
        rows = (
            db.query(MenuInfo.MenuKey)
            .join(UserPermission, UserPermission.MenuId == MenuInfo.id)
            .filter(UserPermission.UserId == user.id)
            .all()
        )
        return [r.MenuKey for r in rows]

