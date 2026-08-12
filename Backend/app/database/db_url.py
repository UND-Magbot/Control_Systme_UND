# app/database/db_url.py
"""DB 접속 문자열 해석 — APP_ENV(prod|dev)로 대상 스키마를 분기한다.

.env 작성 방식 두 가지를 모두 지원한다.
  1) DATABASE_URL 을 통째로 지정 (기존 방식, 그대로 동작)
  2) APP_ENV + DB_HOST/DB_USER/DB_PASSWORD 만 지정하고 스키마명은 프로필에서 파생
어느 쪽이든 APP_ENV 와 실제 스키마명이 어긋나면 기동을 막는다.
"""
import os
from urllib.parse import urlparse, quote

# 프로필별 기본 스키마. DB_NAME 을 주면 그쪽이 우선한다.
PROFILE_DB_NAME = {
    "prod": "control_system",
    "dev": "control_system_dev",
}

_QUERY = "connect_timeout=5&read_timeout=10&write_timeout=10"
_DEV_SUFFIX = "_dev"


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


def _schema_of(url: str) -> str:
    """접속 문자열에서 스키마명만 뽑는다."""
    return url.rsplit("/", 1)[-1].split("?", 1)[0]


def _verify(profile: str, schema: str) -> None:
    """프로필과 스키마가 어긋나면 RuntimeError."""
    if not profile:
        # 미설정은 막지 않는다 — APP_ENV 없는 기존 배포가 재빌드로 죽으면 안 된다.
        print(f"[WARN] APP_ENV 미설정 — DB 프로필 검증 생략 (스키마: {schema})")
        return
    if profile not in PROFILE_DB_NAME:
        raise RuntimeError(f"APP_ENV 값이 잘못되었습니다: {profile!r} (prod | dev 중 하나)")

    is_dev_schema = schema.endswith(_DEV_SUFFIX)
    if profile == "dev" and not is_dev_schema:
        raise RuntimeError(
            f"APP_ENV=dev 인데 운영 스키마 '{schema}' 에 접속하려 합니다. "
            "개발 인스턴스가 운영 DB를 물면 스케줄러가 이중으로 돕니다. "
            ".env 의 DATABASE_URL 또는 DB_NAME 을 확인하세요."
        )
    if profile == "prod" and is_dev_schema:
        raise RuntimeError(
            f"APP_ENV=prod 인데 개발 스키마 '{schema}' 에 접속하려 합니다."
        )


def resolve_database_url() -> tuple[str, str]:
    """(접속문자열, 로그용 표기) 를 반환. 표기에는 비밀번호가 들어가지 않는다."""
    profile = _env("APP_ENV").lower()
    url = _env("DATABASE_URL")

    if not url:
        host, user, password = _env("DB_HOST"), _env("DB_USER"), _env("DB_PASSWORD")
        if not (host and user and password):
            raise RuntimeError(
                "DB 접속 정보가 없습니다. .env 에 DATABASE_URL 을 통째로 지정하거나, "
                "APP_ENV 와 DB_HOST/DB_USER/DB_PASSWORD 를 설정하세요."
            )
        schema = _env("DB_NAME") or PROFILE_DB_NAME.get(profile, "")
        if not schema:
            raise RuntimeError(
                "접속할 스키마를 정하지 못했습니다. APP_ENV(prod|dev) 또는 DB_NAME 을 설정하세요."
            )
        url = (f"mysql+pymysql://{quote(user)}:{quote(password)}"
               f"@{host}:{_env('DB_PORT', '3306')}/{schema}?{_QUERY}")

    schema = _schema_of(url)
    _verify(profile, schema)

    p = urlparse(url.replace("mysql+pymysql://", "mysql://"))
    return url, f"{p.hostname}:{p.port or 3306}/{schema} (APP_ENV={profile or '미설정'})"
