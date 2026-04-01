from pydantic import BaseModel, Field


class BackupRequest(BaseModel):
    backup_path: str = Field(..., min_length=1, max_length=500)


class BackupResponse(BaseModel):
    status: str
    message: str
    file_name: str