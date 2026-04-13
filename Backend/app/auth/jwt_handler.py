import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.auth.constants import (
    JWT_SECRET_KEY,
    JWT_ALGORITHM,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS,
)


def create_access_token(user_id: int, login_id: str, username: str, role: int, token_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "login_id": login_id,
        "username": username,
        "role": role,
        "ver": token_version,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": now,
        "jti": uuid.uuid4().hex,
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: int, token_version: int = 0, remember: bool = False) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "remember": remember,
        "exp": now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        "iat": now,
        "jti": uuid.uuid4().hex,
        "type": "refresh",
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    """토큰 디코딩. 만료/변조 시 None 반환."""
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None


def decode_token_allow_expired(token: str) -> dict | None:
    """만료된 토큰도 디코딩 (에러 코드 구분용)."""
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM], options={"verify_exp": False})
    except JWTError:
        return None


