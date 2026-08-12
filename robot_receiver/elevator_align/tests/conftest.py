"""테스트가 `elevator_align` 를 top-level 패키지로 import 하도록 경로 보강.

robot_receiver 에 __init__.py 를 두지 않기 위해(스크립트 디렉토리 유지),
패키지 부모(robot_receiver)를 sys.path 에 넣어준다.
실행: `cd robot_receiver && python -m pytest elevator_align`
"""
import os
import sys

_PKG_PARENT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PKG_PARENT not in sys.path:
    sys.path.insert(0, _PKG_PARENT)
