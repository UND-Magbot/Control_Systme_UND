import json
import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.database.models import UserInfo, UserPermission, MenuInfo
from app.auth.password import hash_password, validate_password_format
from app.auth.audit import write_audit

logger = logging.getLogger(__name__)


class UserService:

    # ── 사용자 목록 ──

    @staticmethod
    def list_users(db: Session, search: str | None = None, page: int = 1, size: int = 20, business_id: int | None = None) -> dict:
        query = db.query(UserInfo).filter(UserInfo.DeletedAt.is_(None))
        if business_id is not None:
            query = query.filter(UserInfo.BusinessId == business_id)
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
    def create_user(db: Session, login_id: str, password: str, user_name: str, permission: int, admin_id: int,
                    ip_address: str | None = None, business_id: int | None = None, menu_ids: list[str] | None = None) -> dict:
        # 중복 체크
        existing = db.query(UserInfo).filter(UserInfo.LoginId == login_id, UserInfo.DeletedAt.is_(None)).first()
        if existing:
            raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다")

        if not validate_password_format(password):
            raise HTTPException(status_code=422, detail="영문, 숫자, 특수문자 조합 6~16자리로 입력하세요")

        user = UserInfo(
            LoginId=login_id,
            Password=hash_password(password),
            UserName=user_name,
            Permission=permission,
            BusinessId=business_id,
            IsActive=1,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # 메뉴 권한 설정 — 클라이언트가 menu_ids를 생략하면 permission에 따른 seed 기본값 적용
        if menu_ids is None:
            from app.database.seed import get_default_menu_keys
            menu_ids = get_default_menu_keys(permission)
        if menu_ids:
            UserService.set_permissions(db, user.id, menu_ids, admin_id, ip_address=ip_address)

        write_audit(db, admin_id, "user_created", "user", user.id, ip_address=ip_address,
                                  detail=json.dumps({"login_id": login_id, "user_name": user_name, "permission": permission, "business_id": business_id}, ensure_ascii=False))

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
                user.TokenVersion = (user.TokenVersion or 0) + 1  # 기존 세션 무효화

        if changes:
            db.commit()
            write_audit(db, admin_id, "user_updated", "user", user_id, ip_address=ip_address,
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
        user.TokenVersion = (user.TokenVersion or 0) + 1
        db.commit()

        write_audit(db, admin_id, "user_deleted", "user", user_id, ip_address=ip_address,
                                  detail=json.dumps({"login_id": user.LoginId, "user_name": user.UserName}, ensure_ascii=False))

    # ── 비밀번호 초기화 ──

    @staticmethod
    def reset_password(db: Session, user_id: int, new_password: str, admin_id: int, ip_address: str | None = None):
        user = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if not user:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

        if not validate_password_format(new_password):
            raise HTTPException(status_code=422, detail="영문, 숫자, 특수문자 조합 6~16자리로 입력하세요")

        user.Password = hash_password(new_password)
        user.TokenVersion = (user.TokenVersion or 0) + 1  # 기존 세션 무효화
        db.commit()

        write_audit(db, admin_id, "password_reset", "user", user_id, ip_address=ip_address)

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

        # MenuKey → menu_info.id 변환 (그룹 노드 제외)
        all_rows = db.query(MenuInfo.id, MenuInfo.MenuKey, MenuInfo.IsGroup).all()
        key_to_id = {r.MenuKey: r.id for r in all_rows if not r.IsGroup}
        dropped = [k for k in menu_keys if k not in key_to_id]
        if dropped:
            logger.warning(
                "set_permissions: unknown MenuKey(s) ignored for user_id=%s: %s",
                user_id, dropped,
            )
        new_menu_ids = {key_to_id[k] for k in menu_keys if k in key_to_id}

        # 첫 화면 메뉴(dashboard)는 모든 사용자에게 필수 권한
        dashboard_id = next((r.id for r in all_rows if r.MenuKey == "dashboard"), None)
        if dashboard_id is not None:
            new_menu_ids.add(dashboard_id)

        # 보안: superadmin은 menu-permissions 강제 포함 (본인 락아웃 방지 + 일관성)
        if user.Permission == 1:
            mp_id = next((r.id for r in all_rows if r.MenuKey == "menu-permissions"), None)
            if mp_id is not None:
                new_menu_ids.add(mp_id)

        # 보안: 본인이면 menu-permissions 제거 금지 (자기 락아웃 방지)
        if admin_id == user_id:
            mp_id = next((r.id for r in all_rows if r.MenuKey == "menu-permissions"), None)
            if mp_id is not None and mp_id not in new_menu_ids:
                raise HTTPException(
                    status_code=400,
                    detail="본인의 메뉴 권한 페이지 접근 권한은 제거할 수 없습니다",
                )

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
            # 본인 자기 권한 수정은 세션 유지 (TokenVersion 증가 스킵)
            # 타 사용자 권한 수정은 기존대로 토큰 무효화 → 다음 API 호출 시 refresh로 새 권한 반영
            if admin_id != user_id:
                user.TokenVersion = (user.TokenVersion or 0) + 1
            db.commit()

            # audit 로그 (MenuKey 기반)
            id_to_key = {r.id: r.MenuKey for r in all_rows}
            old_keys = sorted([id_to_key.get(mid, str(mid)) for mid in existing_menu_ids])
            new_keys = sorted([id_to_key.get(mid, "") for mid in new_menu_ids if id_to_key.get(mid)])
            write_audit(db, admin_id, "permission_changed", "user", user_id, ip_address=ip_address,
                                      detail=json.dumps({"from": old_keys, "to": new_keys}, ensure_ascii=False))

    # ── 메뉴 관리 (관리자 전용: 이름·순서·가시성) ──

    @staticmethod
    def list_menus_admin(db: Session) -> list[dict]:
        """menu_info 전체를 평탄 리스트로 반환."""
        rows = db.query(MenuInfo).order_by(MenuInfo.SortOrder.asc(), MenuInfo.id.asc()).all()
        return [
            {
                "id": m.id,
                "menu_key": m.MenuKey,
                "menu_name": m.MenuName,
                "parent_id": m.ParentId,
                "sort_order": m.SortOrder or 0,
                "is_group": bool(m.IsGroup),
                "is_visible": bool(m.IsVisible),
            }
            for m in rows
        ]

    @staticmethod
    def update_menu(db: Session, menu_id: int, menu_name: str | None, sort_order: int | None,
                    is_visible: bool | None, admin_id: int, ip_address: str | None = None) -> dict:
        """MenuName/SortOrder/IsVisible만 수정 가능. MenuKey/ParentId/IsGroup는 seed.py에서만 관리."""
        menu = db.query(MenuInfo).filter(MenuInfo.id == menu_id).first()
        if not menu:
            raise HTTPException(status_code=404, detail="메뉴를 찾을 수 없습니다")

        changes: dict = {}
        if menu_name is not None:
            trimmed = menu_name.strip()
            if not trimmed:
                raise HTTPException(status_code=400, detail="메뉴명은 공백일 수 없습니다")
            if trimmed != menu.MenuName:
                changes["menu_name"] = {"from": menu.MenuName, "to": trimmed}
                menu.MenuName = trimmed
        if sort_order is not None and sort_order != (menu.SortOrder or 0):
            changes["sort_order"] = {"from": menu.SortOrder or 0, "to": sort_order}
            menu.SortOrder = sort_order
        if is_visible is not None:
            new_val = 1 if is_visible else 0
            if new_val != (menu.IsVisible or 0):
                changes["is_visible"] = {"from": bool(menu.IsVisible), "to": bool(is_visible)}
                menu.IsVisible = new_val
                # 부모-자식 가시성 정합성: 켜면 조상까지 승격, 끄면 자손까지 숨김
                cascade = _cascade_visibility(db, menu, new_val)
                if cascade:
                    changes["cascade_shown" if new_val else "cascade_hidden"] = cascade

        if changes:
            db.commit()
            write_audit(
                db, admin_id, "menu_updated", "menu", menu_id, ip_address=ip_address,
                detail=json.dumps({"menu_key": menu.MenuKey, **changes}, ensure_ascii=False),
            )

        return {
            "id": menu.id,
            "menu_key": menu.MenuKey,
            "menu_name": menu.MenuName,
            "parent_id": menu.ParentId,
            "sort_order": menu.SortOrder or 0,
            "is_group": bool(menu.IsGroup),
            "is_visible": bool(menu.IsVisible),
        }


def _cascade_visibility(db: Session, menu: MenuInfo, new_val: int) -> list[str]:
    """가시성 정합성 보정.
    켤 때(1): 숨겨진 조상을 모두 표시로 올림 → 승격된 조상 MenuKey 목록 반환.
    끌 때(0): 표시 중인 자손을 모두 숨김으로 내림 → 숨겨진 자손 MenuKey 목록 반환.
    """
    affected: list[str] = []
    if new_val == 1:
        cur = menu
        while cur.ParentId is not None:
            parent = db.query(MenuInfo).filter(MenuInfo.id == cur.ParentId).first()
            if parent is None:
                break
            if (parent.IsVisible or 0) == 0:
                parent.IsVisible = 1
                affected.append(parent.MenuKey)
            cur = parent
    else:
        stack = [menu.id]
        while stack:
            cur_id = stack.pop()
            children = db.query(MenuInfo).filter(MenuInfo.ParentId == cur_id).all()
            for c in children:
                if (c.IsVisible or 0) == 1:
                    c.IsVisible = 0
                    affected.append(c.MenuKey)
                stack.append(c.id)
    return affected

