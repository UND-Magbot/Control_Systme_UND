import os
import uuid
from fastapi import APIRouter, Depends, Query, Request, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional

from app.Database.database import SessionLocal
from app.Database.models import UserInfo
from app.auth.audit import write_audit, get_client_ip
from app.auth.dependencies import get_current_user, require_permission
from app.notices.schemas import NoticeCreateReq, NoticeUpdateReq, NoticeResponse, NoticeListResponse
from app.notices.service import NoticeService

router = APIRouter(prefix="/DB", tags=["notices"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/notices", response_model=NoticeListResponse)
def get_notices(
    search: Optional[str] = Query(None),
    importance: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("alert-notice")),
):
    return NoticeService(db).get_list(search=search, importance=importance, page=page, size=size)


@router.get("/notices/{notice_id}", response_model=NoticeResponse)
def get_notice(notice_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("alert-notice"))):
    return NoticeService(db).get_by_id(notice_id)


@router.post("/notices")
def create_notice(req: NoticeCreateReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("alert-notice"))):
    notice = NoticeService(db).create(
        title=req.Title,
        content=req.Content,
        importance=req.Importance,
        user_id=req.UserId,
        attachment_name=req.AttachmentName,
        attachment_url=req.AttachmentUrl,
        attachment_size=req.AttachmentSize,
    )
    write_audit(db, current_user.id, "notice_created", "notice", notice.id,
                detail=f"제목: {req.Title}, 중요도: {req.Importance}",
                ip_address=get_client_ip(request))
    return {"status": "ok", "id": notice.id}


@router.put("/notices/{notice_id}", response_model=NoticeResponse)
def update_notice(notice_id: int, req: NoticeUpdateReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("alert-notice"))):
    notice, changes = NoticeService(db).update(
        notice_id=notice_id,
        title=req.Title,
        content=req.Content,
        importance=req.Importance,
        attachment_name=req.AttachmentName,
        attachment_url=req.AttachmentUrl,
        attachment_size=req.AttachmentSize,
    )
    detail = ", ".join(changes) if changes else None
    write_audit(db, current_user.id, "notice_updated", "notice", notice_id, detail=detail,
                ip_address=get_client_ip(request))
    return notice


@router.delete("/notices/{notice_id}")
def delete_notice(notice_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("alert-notice"))):
    svc = NoticeService(db)
    notice = svc.get_by_id(notice_id)
    title = notice.Title
    svc.delete(notice_id)
    write_audit(db, current_user.id, "notice_deleted", "notice", notice_id,
                detail=f"제목: {title}",
                ip_address=get_client_ip(request))
    return {"status": "ok"}


@router.post("/notices/upload")
async def upload_notice_file(file: UploadFile = File(...), current_user: UserInfo = Depends(require_permission("alert-notice"))):
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="파일 크기는 10MB 이하만 가능합니다")

    ext = os.path.splitext(file.filename or "")[1].lower()
    allowed = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".hwp", ".txt", ".png", ".jpg", ".jpeg", ".gif"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="허용되지 않는 파일 형식입니다")

    stored_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, stored_name)
    with open(file_path, "wb") as f:
        f.write(contents)

    return {
        "original_name": file.filename,
        "stored_name": stored_name,
        "url": f"/DB/notices/files/{stored_name}",
        "size": len(contents),
    }


@router.get("/notices/files/{filename}")
def download_notice_file(filename: str, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("alert-notice"))):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")

    # DB에서 원본 파일명 조회
    from app.Database.models import Notice
    notice = db.query(Notice).filter(Notice.AttachmentUrl.like(f"%{filename}%"), Notice.DeletedAt.is_(None)).first()
    original_name = notice.AttachmentName if notice and notice.AttachmentName else filename

    return FileResponse(file_path, filename=original_name)
