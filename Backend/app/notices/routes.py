import os
import uuid
from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional

from app.Database.database import SessionLocal
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
):
    return NoticeService(db).get_list(search=search, importance=importance, page=page, size=size)


@router.get("/notices/{notice_id}", response_model=NoticeResponse)
def get_notice(notice_id: int, db: Session = Depends(get_db)):
    return NoticeService(db).get_by_id(notice_id)


@router.post("/notices")
def create_notice(req: NoticeCreateReq, db: Session = Depends(get_db)):
    notice = NoticeService(db).create(
        title=req.Title,
        content=req.Content,
        importance=req.Importance,
        user_id=req.UserId,
        attachment_name=req.AttachmentName,
        attachment_url=req.AttachmentUrl,
    )
    return {"status": "ok", "id": notice.id}


@router.put("/notices/{notice_id}", response_model=NoticeResponse)
def update_notice(notice_id: int, req: NoticeUpdateReq, db: Session = Depends(get_db)):
    return NoticeService(db).update(
        notice_id=notice_id,
        title=req.Title,
        content=req.Content,
        importance=req.Importance,
        attachment_name=req.AttachmentName,
        attachment_url=req.AttachmentUrl,
    )


@router.delete("/notices/{notice_id}")
def delete_notice(notice_id: int, db: Session = Depends(get_db)):
    NoticeService(db).delete(notice_id)
    return {"status": "ok"}


@router.post("/notices/upload")
async def upload_notice_file(file: UploadFile = File(...)):
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
    }


@router.get("/notices/files/{filename}")
def download_notice_file(filename: str, db: Session = Depends(get_db)):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")

    # DB에서 원본 파일명 조회
    from app.Database.models import Notice
    notice = db.query(Notice).filter(Notice.AttachmentUrl.like(f"%{filename}%"), Notice.DeletedAt.is_(None)).first()
    original_name = notice.AttachmentName if notice and notice.AttachmentName else filename

    return FileResponse(file_path, filename=original_name)
