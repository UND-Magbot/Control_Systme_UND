from pydantic import BaseModel


class BackupErrorResponse(BaseModel):
    detail: str