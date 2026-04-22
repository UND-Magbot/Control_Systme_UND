from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db, get_current_user, require_admin, require_manager, is_admin
from app.auth.schemas import MessageResponse
from app.database.models import UserInfo, MenuInfo
from app.users.schemas import (
    UserCreateRequest,
    UserUpdateRequest,
    ResetPasswordRequest,
    PermissionUpdateRequest,
    UserListResponse,
    UserDetailResponse,
    PermissionResponse,
    MenuUpdateRequest,
    MenuAdminItem,
    MenuPresetResponse,
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
            "is_group": bool(m.IsGroup),
            "is_visible": bool(m.IsVisible),
            "sort_order": m.SortOrder or 0,
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


# ── 메뉴 관리 (superadmin 전용): 평탄 리스트 조회 ──

@router.get("/menus/admin", response_model=list[MenuAdminItem], tags=["메뉴"])
def list_menus_admin(current_user: UserInfo = Depends(require_admin), db: Session = Depends(get_db)):
    return UserService.list_menus_admin(db)


# ── 메뉴 관리: 이름·순서·가시성 수정 ──

@router.put("/menus/{menu_id}", response_model=MenuAdminItem, tags=["메뉴"])
def update_menu(
    menu_id: int,
    body: MenuUpdateRequest,
    request: Request,
    current_user: UserInfo = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ip = get_client_ip(request)
    return UserService.update_menu(
        db, menu_id, body.menu_name, body.sort_order, body.is_visible,
        current_user.id, ip_address=ip,
    )


# ── 역할별 기본 메뉴 프리셋 (UserRegisterModal 미리보기용) ──

@router.get("/menu-presets", response_model=MenuPresetResponse, tags=["메뉴"])
def get_menu_presets(
    permission: int = Query(..., ge=1, le=3),
    current_user: UserInfo = Depends(require_manager),
    db: Session = Depends(get_db),
):
    from app.database.seed import get_default_menu_keys
    return MenuPresetResponse(permission=permission, menu_keys=get_default_menu_keys(permission))


# ── 사용자 목록 ──

@router.get("", response_model=UserListResponse)
def list_users(
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: UserInfo = Depends(require_manager),
    db: Session = Depends(get_db),
):
    business_id = None if is_admin(current_user) else current_user.BusinessId
    result = UserService.list_users(db, search=search, page=page, size=size, business_id=business_id)
    return result


# ── 사용자 생성 ──

@router.post("", response_model=UserDetailResponse)
def create_user(body: UserCreateRequest, request: Request, current_user: UserInfo = Depends(require_manager), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    # 하위 관리자는 자기 사업장으로 강제
    biz_id = body.business_id if is_admin(current_user) else current_user.BusinessId
    result = UserService.create_user(
        db, body.login_id, body.password, body.user_name, body.permission, current_user.id,
        ip_address=ip, business_id=biz_id, menu_ids=body.menu_ids,
    )
    return result


# ── 사용자 상세 ──

@router.get("/{user_id}", response_model=UserDetailResponse)
def get_user(user_id: int, current_user: UserInfo = Depends(require_manager), db: Session = Depends(get_db)):
    if not is_admin(current_user) and current_user.BusinessId:
        target = db.query(UserInfo).filter(UserInfo.id == user_id, UserInfo.DeletedAt.is_(None)).first()
        if target and target.BusinessId != current_user.BusinessId:
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    return UserService.get_user(db, user_id)


# ── 사용자 수정 ──

@router.put("/{user_id}", response_model=MessageResponse)
def update_user(user_id: int, body: UserUpdateRequest, request: Request, current_user: UserInfo = Depends(require_manager), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    UserService.update_user(db, user_id, body.user_name, body.permission, body.is_active, current_user.id, ip_address=ip)
    return MessageResponse(message="사용자 정보가 수정되었습니다")


# ── 사용자 삭제 ──

@router.delete("/{user_id}", response_model=MessageResponse)
def delete_user(user_id: int, request: Request, current_user: UserInfo = Depends(require_manager), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    UserService.delete_user(db, user_id, current_user.id, ip_address=ip)
    return MessageResponse(message="사용자가 삭제되었습니다")


# ── 비밀번호 초기화 ──

@router.post("/{user_id}/reset-password", response_model=MessageResponse)
def reset_password(user_id: int, body: ResetPasswordRequest, request: Request, current_user: UserInfo = Depends(require_manager), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    UserService.reset_password(db, user_id, body.new_password, current_user.id, ip_address=ip)
    return MessageResponse(message="비밀번호가 초기화되었습니다")


# ── 메뉴 권한 조회 ──

@router.get("/{user_id}/permissions", response_model=PermissionResponse)
def get_permissions(user_id: int, current_user: UserInfo = Depends(require_manager), db: Session = Depends(get_db)):
    menu_ids = UserService.get_permissions(db, user_id)
    return PermissionResponse(menu_ids=menu_ids)


# ── 메뉴 권한 설정 ──

@router.put("/{user_id}/permissions", response_model=MessageResponse)
def set_permissions(user_id: int, body: PermissionUpdateRequest, request: Request, current_user: UserInfo = Depends(require_manager), db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    UserService.set_permissions(db, user_id, body.menu_ids, current_user.id, ip_address=ip)
    return MessageResponse(message="권한이 설정되었습니다")
