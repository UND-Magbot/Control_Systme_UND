"""control_lock 단위 테스트.

`app.robot_control.control_lock` 는 프로젝트 import 가 없는 순수 모듈이라
app 전체를 켜지 않고 단독으로 검증할 수 있다.
실행: `cd Backend && python3 -m pytest tests/test_control_lock.py`
"""
import os
import sys
import time

import pytest

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_RC = os.path.join(_BACKEND, "app", "robot_control")
if _RC not in sys.path:
    sys.path.insert(0, _RC)

import control_lock as cl  # noqa: E402


@pytest.fixture(autouse=True)
def _clean():
    cl._locks.clear()
    cl._release_hooks.clear()
    yield
    cl._locks.clear()
    cl._release_hooks.clear()


def test_획득하면_소유자가_된다():
    lock = cl.acquire(1, "user", "operator@qcs", owner_label="운영자")
    assert lock.robot_id == 1
    assert lock.token
    cur = cl.get(1)
    assert cur is not None and cur.owner_id == "operator@qcs"
    assert cur.to_public()["ownerLabel"] == "운영자"


def test_다른_사람이_쥐고_있으면_충돌():
    cl.acquire(1, "user", "a@qcs")
    with pytest.raises(cl.ControlLockConflict) as e:
        cl.acquire(1, "user", "b@qcs")
    assert e.value.current.owner_id == "a@qcs"


def test_같은_소유자의_재획득은_연장이다():
    first = cl.acquire(1, "user", "a@qcs")
    again = cl.acquire(1, "user", "a@qcs")
    assert again.token == first.token  # 토큰이 갈리면 기존 세션이 죽는다


def test_로봇이_다르면_서로_간섭하지_않는다():
    cl.acquire(1, "user", "a@qcs")
    cl.acquire(2, "user", "b@qcs")
    assert cl.get(1).owner_id == "a@qcs"
    assert cl.get(2).owner_id == "b@qcs"


def test_토큰이_틀리면_조작이_거부된다():
    cl.acquire(1, "user", "a@qcs")
    with pytest.raises(cl.ControlLockConflict):
        cl.verify(1, "엉뚱한-토큰")
    with pytest.raises(cl.ControlLockDenied):
        cl.verify(1, None)


def test_아무도_안_쥐었으면_조작이_거부된다():
    with pytest.raises(cl.ControlLockDenied):
        cl.verify(1, "아무-토큰")


def test_조작이_heartbeat_역할을_한다():
    lock = cl.acquire(1, "user", "a@qcs")
    lock.last_seen = time.time() - (cl.TTL_SEC - 1)
    cl.verify(1, lock.token)
    assert lock.expires_in > cl.TTL_SEC - 1


def test_TTL_경과하면_자동_해제된다():
    lock = cl.acquire(1, "user", "a@qcs")
    lock.last_seen = time.time() - (cl.TTL_SEC + 1)
    assert cl.get(1) is None
    # 유령 점유가 사라졌으므로 다른 사람이 잡을 수 있다
    assert cl.acquire(1, "user", "b@qcs").owner_id == "b@qcs"


def test_해제되면_정리_훅이_돈다():
    fired = []
    cl.register_release_hook(lambda rid, reason: fired.append((rid, reason)))
    lock = cl.acquire(1, "user", "a@qcs")
    cl.release(1, lock.token)
    assert fired == [(1, "released")]


def test_훅이_실패해도_해제는_된다():
    def boom(rid, reason):
        raise RuntimeError("수납 실패")

    cl.register_release_hook(boom)
    lock = cl.acquire(1, "user", "a@qcs")
    assert cl.release(1, lock.token) is True
    assert cl.get(1) is None


def test_남의_토큰으로는_해제할_수_없다():
    cl.acquire(1, "user", "a@qcs")
    with pytest.raises(cl.ControlLockDenied):
        cl.release(1, "남의-토큰")
    assert cl.get(1) is not None


def test_관리자_강제회수():
    cl.acquire(1, "user", "a@qcs")
    prev = cl.force_release(1, reason="admin_forced")
    assert prev.owner_id == "a@qcs"
    assert cl.get(1) is None


def test_자율은_사람을_밀어내지_않는다():
    cl.acquire(1, "user", "operator@qcs")
    assert cl.acquire_system(1, "schedule:1204") is None  # 포기한다


def test_자율이_잡고_있으면_사람은_충돌을_본다():
    cl.acquire_system(1, "schedule:1204", label="약품배송_3층")
    with pytest.raises(cl.ControlLockConflict) as e:
        cl.acquire(1, "user", "operator@qcs")
    assert e.value.current.owner_type == "system"


def test_자율_반환은_소유자가_바뀌었으면_아무것도_안_한다():
    cl.acquire_system(1, "schedule:1204")
    cl.force_release(1)
    cl.acquire(1, "user", "operator@qcs")
    assert cl.release_system(1, "schedule:1204") is False
    assert cl.get(1).owner_type == "user"  # 사람 제어권을 건드리지 않는다
