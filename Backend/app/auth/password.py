from passlib.context import CryptContext
import re

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 영문 + 숫자 + 특수문자 조합, 6~16자
PASSWORD_REGEX = re.compile(
    r"^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?]).{6,16}$"
)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def validate_password_format(password: str) -> bool:
    return bool(PASSWORD_REGEX.match(password))
