from fastapi import APIRouter, Depends, Request, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db, get_current_user, require_admin
from app.auth.schemas import MessageResponse
from app.Database.models import UserInfo, MenuInfo
from app.users.schemas import (
    UserCreateRequest,
    UserUpdateRequest,
    ResetPasswordRequest,
    PermissionUpdateRequest,
    UserListResponse,
    UserDetailResponse,
    PermissionResponse,
)
from app.auth.audit import get_client_ip
from app.users.service import UserService

router = APIRouter(prefix="/api/users", tags=["사용자 관리"])


# ── 메뉴 트리 조회 (/{user_id} 보다 먼저 등록해야 함) ──

@router.get("/menus", tags=["메뉴"])
def get_menu_tree(current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db)):
    """menu_info 테이블에서 메뉴 트리를 조회하여 반환."""
    all_menus = db.query(MenuInfo).order_by(MenuInfo.SortOrder.asc()).all()

    # id → menu 매핑
    menu_map = {}
    for m in all_menus:
        menu_map[m.id] = {
            "id": m.MenuKey,
            "label": m.MenuName,
            "children": [],
        }

    # 트리 구성
    roots = []
    for m in all_menus:
        node = menu_map[m.id]
        if m.ParentId and m.ParentId in menu_map:
            menu_map[m.ParentId]["children"].append(node)
        else:
            roots.append(node)

    # children이 비어있으면 제거 (리프 노드)
    def clean(nodes):
        for n in nodes:
            if not n["children"]:
                del n["children"]
            else:
                clean(n["children"])
    clean(roots)

    return roots


# ── 사용자 목록 ──

@router.get("", response_model=UserListResponse)
def list_users(
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    admin: UserInfo = Depends(require_admin),
    db: Session = Depends(get_db),
):
    result = UserService.list_users(db, search=search, page=page, size=size)
    return result


# ── 사용자 생성 ──

@router.post("", response_model=UserDetailResponse)
def create_user(body: UserCreateRequest, request: Request, admin: UserInfo = Depends(require_admin), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    result = UserService.create_user(
        db, body.login_id, body.password, body.user_name, body.permission, admin.id,
        ip_address=ip, business_id=body.business_id, menu_ids=body.menu_ids,
    )
    return result


# ── 사용자 상세 ──

@router.get("/{user_id}", response_model=UserDetailResponse)
def get_user(user_id: int, admin: UserInfo = Depends(require_admin), db: Session = Depends(get_db)):
    return UserService.get_user(db, user_id)


# ── 사용자 수정 ──

@router.put("/{user_id}", response_model=MessageResponse)
def update_user(user_id: int, body: UserUpdateRequest, request: Request, admin: UserInfo = Depends(require_admin), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    UserService.update_user(db, user_id, body.user_name, body.permission, body.is_active, admin.id, ip_address=ip)
    return MessageResponse(message="사용자 정보가 수정되었습니다")


# ── 사용자 삭제 ──

@router.delete("/{user_id}", response_model=MessageResponse)
def delete_user(user_id: int, request: Request, admin: UserInfo = Depends(require_admin), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    UserService.delete_user(db, user_id, admin.id, ip_address=ip)
    return MessageResponse(message="사용자가 삭제되었습니다")


# ── 비밀번호 초기화 ──

@router.post("/{user_id}/reset-password", response_model=MessageResponse)
def reset_password(user_id: int, body: ResetPasswordRequest, request: Request, admin: UserInfo = Depends(require_admin), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    UserService.reset_password(db, user_id, body.new_password, admin.id, ip_address=ip)
    return MessageResponse(message="비밀번호가 초기화되었습니다")


# ── 메뉴 권한 조회 ──

@router.get("/{user_id}/permissions", response_model=PermissionResponse)
def get_permissions(user_id: int, admin: UserInfo = Depends(require_admin), db: Session = Depends(get_db)):
    menu_ids = UserService.get_permissions(db, user_id)
    return PermissionResponse(menu_ids=menu_ids)


# ── 메뉴 권한 설정 ──

@router.put("/{user_id}/permissions", response_model=MessageResponse)
def set_permissions(user_id: int, body: PermissionUpdateRequest, request: Request, admin: UserInfo = Depends(require_admin), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    UserService.set_permissions(db, user_id, body.menu_ids, admin.id, ip_address=ip)
    return MessageResponse(message="권한이 설정되었습니다")
