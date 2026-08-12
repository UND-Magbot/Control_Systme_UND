"""이 백엔드 인스턴스의 정체성 — 개발이냐 운영이냐.

환경변수를 쓰지 않는다. 설정 항목을 만들면 언젠가 잘못 설정되거나 복사되는데,
DB 이름은 이미 다르게 설정돼 있고 틀릴 수가 없다.
  control_system_dev → 개발 / control_system → 운영
"""
from __future__ import annotations

import socket
import threading

from sqlalchemy import text

from app.database.database import engine

DEV_DB_SUFFIX = "_dev"

ROLE_DEV = "dev"
ROLE_PROD = "prod"

_lock = threading.Lock()
_cache: dict | None = None


def _probe() -> dict:
    """접속 중인 데이터베이스 이름을 읽어 역할을 판정한다."""
    database = None
    try:
        with engine.connect() as conn:
            database = conn.execute(text("SELECT DATABASE()")).scalar()
    except Exception as e:  # noqa: BLE001 - DB 미가용이어도 기동을 막지 않는다
        print(f"[CLUSTER] 인스턴스 역할 판정 실패(운영으로 간주): {str(e)[:80]}")

    role = ROLE_DEV if (database or "").endswith(DEV_DB_SUFFIX) else ROLE_PROD
    return {"role": role, "database": database, "host": socket.gethostname()}


def info() -> dict:
    """{role, database, host}. 최초 1회만 조회하고 캐시한다(런타임에 안 바뀐다)."""
    global _cache
    if _cache is not None:
        return dict(_cache)
    with _lock:
        if _cache is None:
            _cache = _probe()
    return dict(_cache)


def role() -> str:
    return info()["role"]


def is_dev() -> bool:
    return role() == ROLE_DEV
