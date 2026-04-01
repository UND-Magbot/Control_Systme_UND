import os
import re
import shutil
import subprocess
from datetime import datetime
from urllib.parse import urlparse

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.Database.database import DATABASE_URL
from app.Database.models import UserInfo, BusinessInfo


def _parse_db_url(url: str) -> dict:
    """SQLAlchemy DATABASE_URL에서 host, port, user, password, db_name 파싱."""
    # mysql+pymysql://user:pass@host:port/dbname
    clean = url.replace("mysql+pymysql://", "mysql://")
    parsed = urlparse(clean)
    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 3306,
        "user": parsed.username or "root",
        "password": parsed.password or "",
        "db_name": parsed.path.lstrip("/"),
    }


def _sanitize_filename(name: str) -> str:
    """파일명에 사용 불가한 문자를 _로 치환."""
    return re.sub(r'[<>:"/\\|?*\s]+', "_", name).strip("_") or "backup"


class BackupService:

    @staticmethod
    def create_backup(db: Session, user_id: int, backup_path: str) -> dict:
        # 1) 사용자 조회 → BusinessId 확인
        user = db.query(UserInfo).filter(
            UserInfo.id == user_id,
            UserInfo.DeletedAt.is_(None),
        ).first()
        if not user:
            raise HTTPException(status_code=400, detail="사용자 정보를 찾을 수 없습니다")

        if not user.BusinessId:
            raise HTTPException(status_code=400, detail="소속 사업자가 설정되지 않았습니다")

        # 2) BusinessInfo에서 BusinessName 조회
        business = db.query(BusinessInfo).filter(
            BusinessInfo.id == user.BusinessId,
            BusinessInfo.DeletedAt.is_(None),
        ).first()
        if not business:
            raise HTTPException(status_code=400, detail="사업자 정보를 찾을 수 없습니다")

        biz_name = _sanitize_filename(business.BusinessName)

        # 3) 백업 경로 검증
        real_path = os.path.realpath(backup_path)

        if not os.path.isdir(real_path):
            raise HTTPException(status_code=400, detail="백업 경로가 존재하지 않습니다")

        if not os.access(real_path, os.W_OK):
            raise HTTPException(status_code=400, detail="백업 경로에 쓰기 권한이 없습니다")

        # 4) mysqldump 설치 확인
        if not shutil.which("mysqldump"):
            raise HTTPException(status_code=500, detail="mysqldump가 설치되어 있지 않습니다")

        # 5) mysqldump 실행
        db_info = _parse_db_url(DATABASE_URL)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_name = f"{biz_name}_{timestamp}.sql"
        file_path = os.path.join(real_path, file_name)

        cmd = [
            "mysqldump",
            "-h", db_info["host"],
            "-P", str(db_info["port"]),
            "-u", db_info["user"],
            f"--password={db_info['password']}",
            "--single-transaction",
            "--routines",
            "--triggers",
            db_info["db_name"],
        ]

        try:
            with open(file_path, "w", encoding="utf-8") as f:
                result = subprocess.run(
                    cmd,
                    stdout=f,
                    stderr=subprocess.PIPE,
                    timeout=300,
                )
        except subprocess.TimeoutExpired:
            # 실패 시 불완전한 파일 제거
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(status_code=500, detail="백업 시간이 초과되었습니다 (5분)")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"백업 파일 생성 실패: {e}")

        if result.returncode != 0:
            # 실패 시 불완전한 파일 제거
            if os.path.exists(file_path):
                os.remove(file_path)
            stderr_msg = result.stderr.decode("utf-8", errors="replace").strip()
            raise HTTPException(status_code=500, detail=f"mysqldump 실행 실패: {stderr_msg}")

        return {
            "status": "ok",
            "message": "백업이 완료되었습니다",
            "file_name": file_name,
        }