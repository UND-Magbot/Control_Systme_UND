from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc
from fastapi import HTTPException

from app.Database.models import Notice, Alert


class NoticeService:
    def __init__(self, db: Session):
        self.db = db

    def create(self, title: str, content: str, importance: str, user_id: str, attachment_name: str = None, attachment_url: str = None) -> Notice:
        notice = Notice(
            Title=title,
            Content=content,
            Importance=importance,
            UserId=user_id,
            AttachmentName=attachment_name,
            AttachmentUrl=attachment_url,
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
               importance: str = None, attachment_name: str = None, attachment_url: str = None) -> Notice:
        notice = self.db.query(Notice).filter(
            Notice.id == notice_id,
            Notice.DeletedAt.is_(None),
        ).first()
        if not notice:
            raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

        if title is not None:
            notice.Title = title

        if content is not None:
            notice.Content = content
        if importance is not None:
            notice.Importance = importance
        if attachment_name is not None:
            notice.AttachmentName = attachment_name
        if attachment_url is not None:
            notice.AttachmentUrl = attachment_url

        # alert.Content 동기화
        alert = self.db.query(Alert).filter(
            Alert.NoticeId == notice_id,
            Alert.DeletedAt.is_(None),
        ).first()
        if alert and title:
            alert.Content = title

        self.db.commit()
        self.db.refresh(notice)
        return notice

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
