"""감사 로그 공통 유틸리티. 각 서비스에서 임포트하여 사용."""
from fastapi import Request
from sqlalchemy.orm import Session
from app.Database.models import AuditLog


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def write_audit(
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
