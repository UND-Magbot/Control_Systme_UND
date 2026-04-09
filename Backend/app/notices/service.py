from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc
from fastapi import HTTPException

from app.Database.models import Notice, Alert


class NoticeService:
    def __init__(self, db: Session):
        self.db = db

    def create(self, title: str, content: str, importance: str, user_id: str, attachment_name: str = None, attachment_url: str = None, attachment_size: int = None) -> Notice:
        notice = Notice(
            Title=title,
            Content=content,
            Importance=importance,
            UserId=user_id,
            AttachmentName=attachment_name,
            AttachmentUrl=attachment_url,
            AttachmentSize=attachment_size,
        )
        self.db.add(notice)
        self.db.flush()

        # alert 테이블에도 동시 생성
        alert = Alert(
            Type="Notice",
            Status="info",
            Content=title,
            NoticeId=notice.id,
        )
        self.db.add(alert)

        self.db.commit()
        self.db.refresh(notice)
        return notice

    def update(self, notice_id: int, title: str = None, content: str = None,
               importance: str = None, attachment_name: str = None, attachment_url: str = None, attachment_size: int = None):
        notice = self.db.query(Notice).filter(
            Notice.id == notice_id,
            Notice.DeletedAt.is_(None),
        ).first()
        if not notice:
            raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

        changes = []
        field_map = {
            "제목": ("Title", title),
            "내용": ("Content", content),
            "중요도": ("Importance", importance),
            "첨부파일명": ("AttachmentName", attachment_name),
            "첨부파일URL": ("AttachmentUrl", attachment_url),
            "첨부파일크기": ("AttachmentSize", attachment_size),
        }

        for label, (attr, new_val) in field_map.items():
            if new_val is None:
                continue
            old_val = getattr(notice, attr)
            if old_val != new_val:
                if label == "내용":
                    changes.append(f"{label}: 변경됨")
                else:
                    changes.append(f"{label}: {old_val or ''} → {new_val or ''}")
                setattr(notice, attr, new_val)

        # alert.Content 동기화
        alert = self.db.query(Alert).filter(
            Alert.NoticeId == notice_id,
            Alert.DeletedAt.is_(None),
        ).first()
        if alert and title:
            alert.Content = title

        self.db.commit()
        self.db.refresh(notice)
        return notice, changes

    def delete(self, notice_id: int):
        notice = self.db.query(Notice).filter(
            Notice.id == notice_id,
            Notice.DeletedAt.is_(None),
        ).first()
        if not notice:
            raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

        now = datetime.now()
        notice.DeletedAt = now

        # 연결된 alert도 soft delete
        alert = self.db.query(Alert).filter(
            Alert.NoticeId == notice_id,
            Alert.DeletedAt.is_(None),
        ).first()
        if alert:
            alert.DeletedAt = now

        self.db.commit()

    def get_by_id(self, notice_id: int) -> Notice:
        notice = self.db.query(Notice).filter(
            Notice.id == notice_id,
            Notice.DeletedAt.is_(None),
        ).first()
        if not notice:
            raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")
        return notice

    def get_list(self, search: str = None, importance: str = None, page: int = 1, size: int = 20):
        query = self.db.query(Notice).filter(Notice.DeletedAt.is_(None))

        if search:
            query = query.filter(
                (Notice.Title.contains(search)) | (Notice.Content.contains(search))
            )
        if importance:
            query = query.filter(Notice.Importance == importance)

        total = query.count()
        items = (
            query.order_by(desc(Notice.CreatedAt))
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )

        return {"items": items, "total": total, "page": page, "size": size}
