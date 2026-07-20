"""제어권 API 통합 테스트 — 실제 라우터에 요청을 태워 409 방어를 확인한다.

프론트 비활성화는 UX 일 뿐이고 **서버가 판정**한다는 것이 이 테스트의 요지다.
실행: `cd Backend && python3 -m pytest tests/test_control_lock_api.py`
(httpx 필요: `pip install httpx`)
"""
import os

import pytest

os.environ.setdefault("DATABASE_URL", "mysql+pymysql://u:p@127.0.0.1:3306/db")
os.environ.setdefault("JWT_SECRET_KEY", "testsecret")

pytest.importorskip("httpx", reason="TestClient 에 httpx 가 필요합니다")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class _FakeUser:
    """require_permission 의 admin bypass 경로를 타는 가짜 사용자."""

    def __init__(self, uid: int, login_id: str, name: str):
        self.id = uid
        self.LoginId = login_id
        self.UserName = name
        self.Permission = 1  # 1 = admin


class _FakeSession:
    """감사 로그 기록용 no-op 세션."""

    def add(self, *_a, **_k):
        pass

    def commit(self):
        pass


@pytest.fixture
def ctx(monkeypatch):
    from app.auth import dependencies as auth_deps
    from app.database import database as db_mod
    from app.robot_control import control_lock as cl
    from app.robot_io import sender

    # 실제 UDP 송신을 막고, 어떤 로봇으로 나갔는지까지 기록한다
    sent: list[tuple[str, int | None]] = []

    def _capture(action, robot_id=None):
        sent.append((action, robot_id))

    monkeypatch.setattr(sender, "send_to_robot", _capture)
    import app.robot_control.mode as mode_mod
    import app.robot_control.pad as pad_mod

    monkeypatch.setattr(pad_mod, "send_to_robot", _capture)
    monkeypatch.setattr(mode_mod, "send_to_robot", _capture)

    # 레거시 경로가 폴백할 로봇
    import app.user_cache as uc

    monkeypatch.setitem(uc.cached_robot, "id", 1)

    cl._locks.clear()

    # 이 테스트가 검증하는 대상만 마운트한다. 집계 라우터(app.robot_control.router)를
    # 쓰면 무관한 패키지의 작업 중 코드까지 끌려와 테스트가 그쪽 상태에 좌우된다.
    from app.robot_control.control_lock_routes import router as lock_router
    from app.robot_control.mode import router as mode_router
    from app.robot_control.pad import router as pad_router

    app = FastAPI()
    app.include_router(pad_router)
    app.include_router(mode_router)
    app.include_router(lock_router)

    current = {"user": _FakeUser(1, "operator@qcs", "운영자")}
    app.dependency_overrides[auth_deps.get_current_user] = lambda: current["user"]
    app.dependency_overrides[db_mod.get_db] = lambda: _FakeSession()

    client = TestClient(app)
    yield client, current, sent, cl
    cl._locks.clear()


def test_제어권_없이는_이동_명령이_거부된다(ctx):
    client, _, sent, _ = ctx
    r = client.post("/robot/up")
    assert r.status_code == 409
    assert "제어" in r.json()["detail"]["message"]
    assert sent == []  # 로봇에 아무것도 안 나갔다


def test_제어_시작하면_이동할_수_있다(ctx):
    client, _, sent, _ = ctx
    acq = client.post("/robot/1/control/acquire")
    assert acq.status_code == 200
    token = acq.json()["token"]

    r = client.post("/robot/up", headers={"X-Control-Token": token})
    assert r.status_code == 200
    assert sent == [("UP", 1)]


def test_다른_사람이_쥐고_있으면_409와_소유자를_준다(ctx):
    client, current, _, _ = ctx
    client.post("/robot/1/control/acquire")

    current["user"] = _FakeUser(2, "manager@qcs", "관리자")
    r = client.post("/robot/1/control/acquire")
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["owner"]["ownerId"] == "operator@qcs"
    assert "운영자" in body["message"]


def test_남의_토큰으로는_조작할_수_없다(ctx):
    client, current, sent, _ = ctx
    client.post("/robot/1/control/acquire")

    current["user"] = _FakeUser(2, "manager@qcs", "관리자")
    # 헤더 값은 ASCII 만 담긴다 — 실제 토큰도 token_urlsafe 라 ASCII 다
    r = client.post("/robot/up", headers={"X-Control-Token": "forged-token"})
    assert r.status_code == 409
    assert sent == []


def test_정지는_제어권_없이도_통과한다(ctx):
    """정지는 제어권보다 위다 — 권한만 있으면 누구나 세울 수 있어야 한다."""
    client, _, sent, _ = ctx
    r = client.post("/robot/stop")
    assert r.status_code == 200
    assert sent == [("STOP", 1)]


def test_자세_명령도_제어권을_요구한다(ctx):
    client, _, sent, _ = ctx
    assert client.post("/robot/sit").status_code == 409
    token = client.post("/robot/1/control/acquire").json()["token"]
    assert client.post("/robot/sit", headers={"X-Control-Token": token}).status_code == 200
    assert sent == [("SIT", 1)]


def test_상태_조회는_제어권_없이_가능하다(ctx):
    client, current, _, _ = ctx
    client.post("/robot/1/control/acquire")

    current["user"] = _FakeUser(2, "manager@qcs", "관리자")
    r = client.get("/robot/1/control")
    assert r.status_code == 200
    body = r.json()
    assert body["controlled"] is True and body["mine"] is False
    assert body["owner"]["ownerLabel"] == "운영자"


def test_종료하면_다른_사람이_잡을_수_있다(ctx):
    client, current, _, _ = ctx
    token = client.post("/robot/1/control/acquire").json()["token"]
    assert client.post("/robot/1/control/release", json={"token": token}).json()["released"] is True

    current["user"] = _FakeUser(2, "manager@qcs", "관리자")
    assert client.post("/robot/1/control/acquire").status_code == 200


def test_관리자_강제회수(ctx):
    client, current, _, _ = ctx
    client.post("/robot/1/control/acquire")

    current["user"] = _FakeUser(2, "admin@qcs", "관리자")
    r = client.post("/robot/1/control/force-release")
    assert r.status_code == 200
    assert r.json()["previousOwner"]["ownerId"] == "operator@qcs"
    assert client.get("/robot/1/control").json()["controlled"] is False


def test_heartbeat_가_제어권을_유지한다(ctx):
    client, _, _, cl = ctx
    token = client.post("/robot/1/control/acquire").json()["token"]
    import time

    cl.get(1).last_seen = time.time() - (cl.TTL_SEC - 1)
    r = client.post("/robot/1/control/heartbeat", json={"token": token})
    assert r.status_code == 200
    assert r.json()["expiresIn"] > cl.TTL_SEC - 1


def test_회수된_뒤_heartbeat_는_409를_받는다(ctx):
    """제어자가 회수를 알아채는 경로."""
    client, _, _, cl = ctx
    token = client.post("/robot/1/control/acquire").json()["token"]
    cl.force_release(1)
    r = client.post("/robot/1/control/heartbeat", json={"token": token})
    assert r.status_code == 409


# ── M1: 명령이 대상 로봇으로 나가는가 ──────────────────────────────────────

def test_로봇별_경로는_그_로봇으로_나간다(ctx):
    client, _, sent, _ = ctx
    token = client.post("/robot/7/control/acquire").json()["token"]

    r = client.post("/robot/7/up", headers={"X-Control-Token": token})
    assert r.status_code == 200
    assert r.json()["robotId"] == 7
    assert sent == [("UP", 7)]  # 캐시된 1번이 아니라 7번으로 나갔다


def test_레거시_경로는_캐시_로봇으로_폴백한다(ctx):
    client, _, sent, _ = ctx
    token = client.post("/robot/1/control/acquire").json()["token"]

    client.post("/robot/up", headers={"X-Control-Token": token})
    assert sent == [("UP", 1)]


def test_제어권은_로봇마다_따로다(ctx):
    """1번을 쥐었다고 2번을 조작할 수 있으면 안 된다."""
    client, _, sent, _ = ctx
    token1 = client.post("/robot/1/control/acquire").json()["token"]

    r = client.post("/robot/2/up", headers={"X-Control-Token": token1})
    assert r.status_code == 409
    assert sent == []

    token2 = client.post("/robot/2/control/acquire").json()["token"]
    assert client.post("/robot/2/up", headers={"X-Control-Token": token2}).status_code == 200
    assert sent == [("UP", 2)]


def test_서로_다른_로봇은_동시에_제어할_수_있다(ctx):
    """배타는 로봇 단위다 — 대수가 늘어도 서로를 막지 않는다."""
    client, _, sent, _ = ctx
    t1 = client.post("/robot/1/control/acquire").json()["token"]
    t2 = client.post("/robot/2/control/acquire").json()["token"]

    assert client.post("/robot/1/up", headers={"X-Control-Token": t1}).status_code == 200
    assert client.post("/robot/2/down", headers={"X-Control-Token": t2}).status_code == 200
    assert sent == [("UP", 1), ("DOWN", 2)]


def test_로봇별_자세_명령(ctx):
    client, _, sent, _ = ctx
    token = client.post("/robot/5/control/acquire").json()["token"]
    r = client.post("/robot/5/sit", headers={"X-Control-Token": token})
    assert r.status_code == 200
    assert sent == [("SIT", 5)]


def test_로봇별_정지는_제어권_없이_통과한다(ctx):
    client, _, sent, _ = ctx
    r = client.post("/robot/9/stop")
    assert r.status_code == 200
    assert sent == [("STOP", 9)]
