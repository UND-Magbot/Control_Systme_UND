"""RM 6축 팔 제어 모듈 (Phase 1 · additive).

기존 `robot_control` 라우터군에 **추가로 붙는** 팔 제어 엔드포인트(`/robot/arm/*`).
기존 파일은 수정하지 않으며, `robot_control/__init__.py` 에 include 1줄만 추가한다.

구성:
  - `rm_arm/`   : 睿尔曼 RM_API 를 감싼 안전가드 제어기(vendored, 06_Backend/rm_arm 이식).
  - `presets.py`: 검증된 프리셋 자세(home) + 미검증 추정치(stow/observe).
  - `routes.py` : FastAPI 라우터(관측·안전정지·프리셋). 권한/제어권은 기존 deps 재사용.
"""
from .routes import router

__all__ = ["router"]
