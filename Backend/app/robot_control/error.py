"""로봇 에러 코드 알림 테스트"""

import json

from fastapi import APIRouter

from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id
from app.logs.service import log_event
from app.robot_io.error_codes import ROBOT_ERROR_CODES, get_error_category, is_informational

router = APIRouter()

# 마지막으로 기록한 에러 코드 (중복 로그 방지용)
_last_logged_error_code = 0


@router.post("/robot/test-error/{error_code}")
def test_robot_error(error_code: str):
    """로봇 에러 코드 알림 테스트 (예: /robot/test-error/0xA302)"""
    global _last_logged_error_code

    code = int(error_code, 16) if error_code.startswith("0x") else int(error_code)
    error_hex = f"0x{code:04X}"
    error_msg = ROBOT_ERROR_CODES.get(code, f"알 수 없는 에러 ({error_hex})")

    if error_msg is None:
        return {"status": "skip", "msg": "정상 코드 (0x0000)"}

    # 정보성(안내) 코드는 운영 경로(runtime.update_status)와 동일하게 error 알림 대상에서 제외
    if is_informational(code):
        return {"status": "skip", "msg": f"정보성 코드 ({error_hex}) — 알림 미발생", "message": error_msg}

    _last_logged_error_code = code
    category = get_error_category(code)
    # 운영 경로(runtime.update_status)와 동일한 [부위] 메시지 형식으로 기록
    log_event("error", "robot_error_code",
              f"[{category}] {error_msg}",
              error_json=json.dumps(
                  {"error_code": error_hex, "category": category, "test": True}, ensure_ascii=False),
              robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

    return {"status": "ok", "error_code": error_hex, "category": category, "message": error_msg}
