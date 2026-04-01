from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db, require_admin
from app.auth.audit import get_client_ip, write_audit
from app.backup.schemas import BackupRequest, BackupResponse
from app.backup.service import BackupService
from app.Database.models import UserInfo

router = APIRouter(prefix="/api/backup", tags=["백업"])


@router.post("", response_model=BackupResponse)
def create_backup(
    body: BackupRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_admin),
):
    ip = get_client_ip(request)
    result = BackupService.create_backup(db, current_user.id, body.backup_path)

    write_audit(
        db,
        user_id=current_user.id,
        action="db_backup",
        detail=f"file: {result['file_name']}, path: {body.backup_path}",
        ip_address=ip,
    )

    return BackupResponse(**result)