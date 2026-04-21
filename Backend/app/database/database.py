# app/database.py
import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

# Backend/ 루트 디렉토리 (app/Database/database.py → 2단계 상위)
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATABASE_URL = "mysql+pymysql://root:1234@192.168.0.21:3306/control_system_dev?connect_timeout=5&read_timeout=10&write_timeout=10"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=30,
    max_overflow=40,
    pool_recycle=600,
    pool_timeout=30,
)


# ─── 쿼리 타임아웃 ───
# 각 커넥션에 세션 레벨 타임아웃을 세팅하여, 개별 쿼리가 너무 오래
# 풀을 점유하는 상황(공용 DB 락/느린 쿼리)에서 연쇄 고갈을 방지한다.
_STMT_TIMEOUT_MS = 10_000        # SELECT 등: 10초 (ms)
_STMT_TIMEOUT_S = 10             # MariaDB용: 초 단위
_LOCK_WAIT_TIMEOUT_S = 10        # UPDATE/DELETE 락 대기: 10초


@event.listens_for(engine, "connect")
def _set_mysql_timeouts(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    try:
        # MySQL 5.7.8+ : MAX_EXECUTION_TIME (ms, SELECT에만 적용)
        try:
            cur.execute(f"SET SESSION MAX_EXECUTION_TIME={_STMT_TIMEOUT_MS}")
        except Exception:
            # MariaDB 10.1+ : max_statement_time (초, 모든 문장)
            try:
                cur.execute(f"SET SESSION max_statement_time={_STMT_TIMEOUT_S}")
            except Exception:
                pass
        # InnoDB 락 대기 (MySQL·MariaDB 공통)
        try:
            cur.execute(f"SET SESSION innodb_lock_wait_timeout={_LOCK_WAIT_TIMEOUT_S}")
        except Exception:
            pass
    finally:
        try:
            cur.close()
        except Exception:
            pass


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


