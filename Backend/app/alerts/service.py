from datetime import datetime
from sqlalchemy.orm import Session, joinedload, subqueryload
from sqlalchemy import desc, func
from fastapi import HTTPException

from app.Database.models import Alert, AlertReadStatus, Notice, UserInfo


class AlertService:
    def __init__(self, db: Session):
        self.db = db

    def get_list(
        self,
        alert_type: str = None,
        status: str = None,
        is_read: str = None,
        search: str = None,
        UserId: int = 0,
        page: int = 1,
        size: int = 20,
    ):
        query = (
            self.db.query(Alert)
            .outerjoin(AlertReadStatus, (AlertReadStatus.AlertId == Alert.id) & (AlertReadStatus.UserId == UserId))
            .filter(Alert.DeletedAt.is_(None))
        )

        if alert_type:
            query = query.filter(Alert.Type == alert_type)
        if status:
            query = query.filter(Alert.Status == status)
        if search:
            query = query.filter(Alert.Content.contains(search))
        if is_read == "true":
            query = query.filter(AlertReadStatus.id.isnot(None))
        elif is_read == "false":
            query = query.filter(AlertReadStatus.id.is_(None))

        total = query.count()

        alerts = (
            query.options(subqueryload(Alert.notice))
            .order_by(desc(Alert.CreatedAt))
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )

        # isRead 판정을 위해 읽음 상태 조회
        alert_ids = [a.id for a in alerts]
        read_set = set()
        if alert_ids:
            read_rows = (
                self.db.query(AlertReadStatus.AlertId)
                .filter(
                    AlertReadStatus.AlertId.in_(alert_ids),
                    AlertReadStatus.UserId == UserId,
                )
                .all()
            )
            read_set = {r.AlertId for r in read_rows}

        items = []
        for alert in alerts:
            item = {
                "id": alert.id,
                "Type": alert.Type,
                "Status": alert.Status,
                "Content": alert.Content,
                "Detail": alert.Detail,
                "ErrorJson": alert.ErrorJson,
                "RobotName": alert.RobotName,
                "date": alert.CreatedAt.strftime("%Y-%m-%d %H:%M"),
                "isRead": alert.id in read_set,
                "NoticeId": alert.NoticeId,
                "notice": None,
            }
            if alert.Type == "Notice" and alert.notice and alert.notice.DeletedAt is None:
                user = self.db.query(UserInfo).filter(UserInfo.id == alert.notice.UserId).first()
                item["notice"] = {
                    "Title": alert.notice.Title,
                    "Content": alert.notice.Content,
                    "Importance": alert.notice.Importance,
                    "UserId": alert.notice.UserId,
                    "UserName": user.UserName if user else None,
                    "AttachmentName": alert.notice.AttachmentName,
                    "AttachmentUrl": alert.notice.AttachmentUrl,
                }
            items.append(item)

        unread_count = self._get_unread_count(UserId)

        return {
            "items": items,
            "total": total,
            "page": page,
            "size": size,
            "unread_count": unread_count,
        }

    def mark_read(self, alert_id: int, UserId: int = 0):
        alert = self.db.query(Alert).filter(
            Alert.id == alert_id,
            Alert.DeletedAt.is_(None),
        ).first()
        if not alert:
            raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다.")

        exists = self.db.query(AlertReadStatus).filter(
            AlertReadStatus.AlertId == alert_id,
            AlertReadStatus.UserId == UserId,
        ).first()
        if not exists:
            read_status = AlertReadStatus(AlertId=alert_id, UserId=UserId)
            self.db.add(read_status)
            self.db.commit()

    def mark_all_read(self, UserId: int = 0):
        unread_alerts = (
            self.db.query(Alert.id)
            .outerjoin(
                AlertReadStatus,
                (AlertReadStatus.AlertId == Alert.id) & (AlertReadStatus.UserId == UserId),
            )
            .filter(Alert.DeletedAt.is_(None), AlertReadStatus.id.is_(None))
            .all()
        )

        for (alert_id,) in unread_alerts:
            self.db.add(AlertReadStatus(AlertId=alert_id, UserId=UserId))

        self.db.commit()

    def _get_unread_count(self, UserId: int = 0) -> dict:
        results = (
            self.db.query(Alert.Type, func.count(Alert.id))
            .outerjoin(
                AlertReadStatus,
                (AlertReadStatus.AlertId == Alert.id) & (AlertReadStatus.UserId == UserId),
            )
            .filter(Alert.DeletedAt.is_(None), AlertReadStatus.id.is_(None))
            .group_by(Alert.Type)
            .all()
        )

        counts = {"total": 0, "robot": 0, "schedule": 0, "notice": 0}
        for alert_type, count in results:
            key = alert_type.lower()
            if key in counts:
                counts[key] = count
            counts["total"] += count

        return counts

    def get_unread_count(self, UserId: int = 0) -> dict:
        return self._get_unread_count(UserId)
