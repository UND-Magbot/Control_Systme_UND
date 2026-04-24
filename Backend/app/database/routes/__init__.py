"""DB 엔드포인트 aggregator.

공용 `database` 라우터(`/DB` prefix)에 각 도메인 서브모듈이 자동으로
엔드포인트를 등록한다. main.py는 이 `database` 라우터 하나만 include하면 된다.
"""

from fastapi import APIRouter

from app.database.database import get_db  # re-export (하위 모듈에서 사용)

database = APIRouter(prefix="/DB")

# 각 도메인 서브모듈 import (side effect: database 라우터에 엔드포인트 등록)
from app.database.routes import robot        # noqa: F401
from app.database.routes import place        # noqa: F401
from app.database.routes import path_way     # noqa: F401
from app.database.routes import schedule     # noqa: F401
from app.database.routes import module       # noqa: F401
from app.database.routes import danger_zone  # noqa: F401

__all__ = ["database", "get_db"]
