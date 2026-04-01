import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.Database.models import UserInfo, UserPermission, MenuInfo, AuditLog
from app.auth.password import hash_password, validate_password_format


class UserService:

    # ── 사용자 목록 ──

    @staticmethod
    def list_users(db: Session, search: str | None = None, page: int = 1, size: int = 20) -> dict:
        query = db.query(UserInfo).filter(UserInfo.DeletedAt.is_(None))
        if search:
            query = query.filter(
                (UserInfo.UserName.contains(search)) | (UserInfo.LoginId.contains(search))
            )
        total = query.count()
        items = query.order_by(UserInfo.id.asc()).offset((page - 1) * size).limit(size).all()
        return {
            "items": [
                {
                    "id": u.id,
                    "login_id": u.LoginId,
                    "user_name": u.UserName,
                    "permission": u.Permission,
                    "is_active": u.IsActive,
                    "last_login_at": u.LastLoginAt,
                    "created_at": u.CreatedAt,
                }
                for u in items
            ],
            "total": total,
            "page": page,
            "size": size,
        }

    # ── 사용자 상세 ──

    @staticmethod
    def get_user(db: Session, user_id: int) -> dict:
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

        permissions = [
            r.MenuKey for r in
            db.query(MenuInfo.MenuKey)
            .join(UserPermission, UserPermission.MenuId == MenuInfo.id)
            .filter(UserPermission.UserId == user_id)
            .all()
        ]

        return {
            "id": user.id,
            "login_id": user.LoginId,
            "user_name": user.UserName,
            "permission": user.Permission,
            "is_active": user.IsActive,
            "last_login_at": user.LastLoginAt,
            "created_at": user.CreatedAt,
            "permissions": permissions,
        }

    # ── 사용자 생성 ──

    @staticmethod
    def create_user(db: Session, login_id: str, password: str, user_name: str, permission: int, admin_id: int, ip_address: str | None = None) -> dict:
        # 중복 체크
        existing = db.query(UserInfo).filter(UserInfo.LoginId == login_id, UserInfo.DeletedAt.is_(None)).first()
        if existing:
            raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다")

        if not validate_password_format(password):
            raise HTTPException(status_code=422, detail="영문, 숫자, 특수문자 조합 6~12자리로 입력하세요")

        user = UserInfo(
            LoginId=login_id,
            Password=hash_password(password),
            UserName=user_name,
            Permission=permission,
            IsActive=1,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        UserService._write_audit(db, admin_id, "user_created", "user", user.id, ip_address=ip_address,
                                  detail=json.dumps({"login_id": login_id, "user_name": user_name, "permission": permission}, ensure_ascii=False))

        return {"id": user.id, "login_id": user.LoginId, "user_name": user.UserName, "permission": user.Permission}

    # ── 사용자 수정 ──

    @staticmethod
    def update_user(db: Session, user_id: int, user_name: str | None, permission: int | None, is_active: int | None, admin_id: int, ip_address: str | None = None):
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

        changes = {}
        if user_name is not None and user_name != user.UserName:
            changes["user_name"] = {"from": user.UserName, "to": user_name}
            user.UserName = user_name
        if permission is not None and permission != user.Permission:
            # 마지막 관리자 역할 변경 차단
            if user.Permission == 1 and permission != 1:
                admin_count = db.query(UserInfo).filter(
                    UserInfo.Permission == 1, UserInfo.DeletedAt.is_(None), UserInfo.IsActive == 1
                ).count()
                if admin_count <= 1:
                    raise HTTPException(status_code=400, detail="마지막 관리자의 역할은 변경할 수 없습니다")
            changes["permission"] = {"from": user.Permission, "to": permission}
            user.Permission = permission
        if is_active is not None and is_active != user.IsActive:
            changes["is_active"] = {"from": user.IsActive, "to": is_active}
            user.IsActive = is_active
            if is_active == 0:
                user.RefreshTokenHash = None  # 비활성화 시 세션 무효화

        if changes:
            db.commit()
            UserService._write_audit(db, admin_id, "user_updated", "user", user_id, ip_address=ip_address,
                                      detail=json.dumps(changes, ensure_ascii=False))

    # ── 사용자 삭제 ──

    @staticmethod
    def delete_user(db: Session, user_id: int, admin_id: int, ip_address: str | None = None):
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

        # 마지막 관리자 삭제 차단
        if user.Permission == 1:
            admin_count = db.query(UserInfo).filter(
                UserInfo.Permission == 1, UserInfo.DeletedAt.is_(None), UserInfo.IsActive == 1
            ).count()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="마지막 관리자 계정은 삭제할 수 없습니다")

        user.DeletedAt = datetime.now(timezone.utc)
        user.RefreshTokenHash = None
        db.commit()

        UserService._write_audit(db, admin_id, "user_deleted", "user", user_id, ip_address=ip_address,
                                  detail=json.dumps({"login_id": user.LoginId, "user_name": user.UserName}, ensure_ascii=False))

    # ── 비밀번호 초기화 ──

    @staticmethod
    def reset_password(db: Session, user_id: int, new_password: str, admin_id: int, ip_address: str | None = None):
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

        if not validate_password_format(new_password):
            raise HTTPException(status_code=422, detail="영문, 숫자, 특수문자 조합 6~12자리로 입력하세요")

        user.Password = hash_password(new_password)
        user.RefreshTokenHash = None
        db.commit()

        UserService._write_audit(db, admin_id, "password_reset", "user", user_id, ip_address=ip_address)

    # ── 메뉴 권한 조회 ──

    @staticmethod
    def get_permissions(db: Session, user_id: int) -> list[str]:
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

        rows = (
            db.query(MenuInfo.MenuKey)
            .join(UserPermission, UserPermission.MenuId == MenuInfo.id)
            .filter(UserPermission.UserId == user_id)
            .all()
        )
        return [r.MenuKey for r in rows]

    # ── 메뉴 권한 설정 (변경분만 처리: 추가된 것 INSERT, 제거된 것 DELETE) ──

    @staticmethod
    def set_permissions(db: Session, user_id: int, menu_keys: list[str], admin_id: int, ip_address: str | None = None):
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

        # MenuKey → menu_info.id 변환
        all_key_to_id = {
            r.MenuKey: r.id for r in db.query(MenuInfo.id, MenuInfo.MenuKey).all()
        }
        new_menu_ids = {all_key_to_id[k] for k in menu_keys if k in all_key_to_id}

        # 기존 권한 조회
        existing_rows = (
            db.query(UserPermission.id, UserPermission.MenuId)
            .filter(UserPermission.UserId == user_id)
            .all()
        )
        existing_menu_ids = {r.MenuId for r in existing_rows}

        # 차집합 계산
        to_add = new_menu_ids - existing_menu_ids
        to_remove = existing_menu_ids - new_menu_ids

        # 제거할 행만 DELETE
        if to_remove:
            db.query(UserPermission).filter(
                UserPermission.UserId == user_id,
                UserPermission.MenuId.in_(to_remove),
            ).delete(synchronize_session=False)

        # 추가할 것만 INSERT
        if to_add:
            for menu_id in sorted(to_add):
                db.add(UserPermission(UserId=user_id, MenuId=menu_id))

        if to_add or to_remove:
            db.commit()

            # audit 로그 (MenuKey 기반)
            id_to_key = {v: k for k, v in all_key_to_id.items()}
            old_keys = sorted([id_to_key.get(mid, str(mid)) for mid in existing_menu_ids])
            new_keys = sorted(menu_keys)
            UserService._write_audit(db, admin_id, "permission_changed", "user", user_id, ip_address=ip_address,
                                      detail=json.dumps({"from": old_keys, "to": new_keys}, ensure_ascii=False))

    # ── 내부 유틸 ──

    @staticmethod
    def _write_audit(
        db: Session,
        user_id: int | None,
        action: str,
        target_type: str | None = None,
        target_id: int | None = None,
        detail: str | None = None,
        ip_address: str | None = None,
    ):
        log = AuditLog(
            UserId=user_id,
            Action=action,
            TargetType=target_type,
            TargetId=target_id,
            Detail=detail,
            IpAddress=ip_address,
        )
        db.add(log)
        db.commit()
