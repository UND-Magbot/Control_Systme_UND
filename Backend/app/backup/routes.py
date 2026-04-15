from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db, require_admin
from app.auth.audit import get_client_ip, write_audit
from app.backup.service import BackupService
from app.database.models import UserInfo

router = APIRouter(prefix="/api/backup", tags=["백업"])


@router.post("/download")
def download_backup(
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_admin),
):
    ip = get_client_ip(request)
    result = BackupService.create_backup(db, current_user.id)

    write_audit(
        db,
        user_id=current_user.id,
        action="db_backup",
        detail=f"file: {result['file_name']}",
        ip_address=ip,
    )

    return FileResponse(
        path=result["file_path"],
        filename=result["file_name"],
        media_type="application/sql",
        background=result["cleanup"],
    )