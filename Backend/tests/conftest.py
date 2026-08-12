"""elevator_fsm 를 top-level 로 import 하도록 navigation 경로 보강.

`Backend/app/navigation/elevator_fsm.py` 는 top-level 프로젝트 import 가 없으므로
(모든 실코드 연동은 lazy), app 전체를 켜지 않고 단독 import 로 테스트할 수 있다.
실행: `cd Backend && python3 -m pytest tests/test_elevator_fsm.py`
"""
import os
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NAV = os.path.join(_BACKEND, "app", "navigation")
if _NAV not in sys.path:
    sys.path.insert(0, _NAV)
