import os
from dotenv import load_dotenv

load_dotenv()

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
if not JWT_SECRET_KEY:
    raise RuntimeError("환경변수 JWT_SECRET_KEY가 설정되지 않았습니다.")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1557
REFRESH_TOKEN_EXPIRE_DAYS = 7
