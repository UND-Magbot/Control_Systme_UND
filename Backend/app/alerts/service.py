from datetime import datetime
from sqlalchemy.orm import Session, subqueryload
from sqlalchemy import desc, func, or_
from fastapi import HTTPException

from app.database.models import Alert, AlertReadStatus, Notice, UserInfo


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
        robot_names: list[str] = None,
    ):
        query = (
            self.db.query(Alert)
            .outerjoin(AlertReadStatus, (AlertReadStatus.AlertId == Alert.id) & (AlertReadStatus.UserId == UserId))
            .filter(Alert.DeletedAt.is_(None))
        )

        if robot_names is not None:
            query = query.filter(
                or_(Alert.RobotName.in_(robot_names), Alert.Type == "Notice")
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
            query.options(subqueryload(Alert.notice), subqueryload(Alert.log))
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

        # 공지 작성자 벌크 조회 (N+1 방지)
        notice_user_ids = {
            a.notice.UserId for a in alerts
            if a.Type == "Notice" and a.notice and a.notice.DeletedAt is None and a.notice.UserId
        }
        notice_users = (
            {u.id: u for u in self.db.query(UserInfo).filter(UserInfo.id.in_(notice_user_ids)).all()}
            if notice_user_ids else {}
        )

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
                "log": None,
            }
            if alert.log:
                item["log"] = {
                    "Category": alert.log.Category,
                    "Action": alert.log.Action,
                    "Message": alert.log.Message,
                    "Detail": alert.log.Detail,
                    "RobotName": alert.log.RobotName,
                    "CreatedAt": alert.log.CreatedAt.strftime("%Y-%m-%d %H:%M:%S"),
                }
            if alert.Type == "Notice" and alert.notice and alert.notice.DeletedAt is None:
                user = notice_users.get(alert.notice.UserId)
                item["notice"] = {
                    "Title": alert.notice.Title,
                    "Content": alert.notice.Content,
                    "Importance": alert.notice.Importance,
                    "UserId": alert.notice.UserId,
                    "UserName": user.UserName if user else None,
                    "AttachmentName": alert.notice.AttachmentName,
                    "AttachmentUrl": alert.notice.AttachmentUrl,
                    "AttachmentSize": alert.notice.AttachmentSize,
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

    def get_one(self, alert_id: int, UserId: int = 0):
        """단일 알림 상세 조회. 목록과 동일한 item 포맷 반환."""
        alert = (
            self.db.query(Alert)
            .options(subqueryload(Alert.notice), subqueryload(Alert.log))
            .filter(Alert.id == alert_id, Alert.DeletedAt.is_(None))
            .first()
        )
        if not alert:
            return None

        read_row = (
            self.db.query(AlertReadStatus)
            .filter(
                AlertReadStatus.AlertId == alert_id,
                AlertReadStatus.UserId == UserId,
            )
            .first()
        )

        item = {
            "id": alert.id,
            "Type": alert.Type,
            "Status": alert.Status,
            "Content": alert.Content,
            "Detail": alert.Detail,
            "ErrorJson": alert.ErrorJson,
            "RobotName": alert.RobotName,
            "date": alert.CreatedAt.strftime("%Y-%m-%d %H:%M"),
            "isRead": read_row is not None,
            "NoticeId": alert.NoticeId,
            "notice": None,
            "log": None,
        }
        if alert.log:
            item["log"] = {
                "Category": alert.log.Category,
                "Action": alert.log.Action,
                "Message": alert.log.Message,
                "Detail": alert.log.Detail,
                "RobotName": alert.log.RobotName,
                "CreatedAt": alert.log.CreatedAt.strftime("%Y-%m-%d %H:%M:%S"),
            }
        if alert.Type == "Notice" and alert.notice and alert.notice.DeletedAt is None:
            user = (
                self.db.query(UserInfo)
                .filter(UserInfo.id == alert.notice.UserId)
                .first()
            )
            item["notice"] = {
                "Title": alert.notice.Title,
                "Content": alert.notice.Content,
                "Importance": alert.notice.Importance,
                "UserId": alert.notice.UserId,
                "UserName": user.UserName if user else None,
                "AttachmentName": alert.notice.AttachmentName,
                "AttachmentUrl": alert.notice.AttachmentUrl,
                "AttachmentSize": alert.notice.AttachmentSize,
            }
        return item

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

    def mark_all_read(self, UserId: int = 0, alert_type: str = None):
        query = (
            self.db.query(Alert.id)
            .outerjoin(
                AlertReadStatus,
                (AlertReadStatus.AlertId == Alert.id) & (AlertReadStatus.UserId == UserId),
            )
            .filter(Alert.DeletedAt.is_(None), AlertReadStatus.id.is_(None))
        )
        if alert_type:
            query = query.filter(Alert.Type == alert_type)
        unread_alerts = query.all()

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
