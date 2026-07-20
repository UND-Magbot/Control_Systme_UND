"""로봇 제어권(control lock) — 한 로봇은 동시에 한 세션만 조작한다.

설계 근거: 06_Planning/ARCH-Remote-Control-and-Device-Console.md §4
- 단위는 **로봇**이다. 서브시스템(이동/팔)별로 나눠 쥐지 않는다 —
  움직이는 베이스 위에서 남이 팔을 조작하는 상황을 구조적으로 막기 위해서다.
- 소유자는 사람만이 아니다. 자율(스케줄·엘리베이터 FSM)도 같은 lock을 잡는다.
  그래서 "자율↔수동 배타 잠금"이 특수 로직이 아니라 소유자 교체가 된다.
- 조작은 관찰을 막지 않는다. 상태·영상 열람은 제어권 없이 가능하다.
- 정지(일시정지·긴급정지)는 **제어권보다 위**다. 이 모듈은 정지를 막지 않는다.

프로세스 메모리에 보관한다. 관제 백엔드가 단일 프로세스로 뜨는 현재 구조에서는
충분하고, 다중 워커로 가면 이 모듈만 외부 저장소(Redis 등)로 교체하면 된다.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Literal

OwnerType = Literal["user", "system"]

# 소유자가 살아있음을 알리는 주기와, 그보다 넉넉히 잡은 만료 시간.
# 짧으면 네트워크 순단에 제어권을 잃고, 길면 브라우저를 그냥 닫은 세션이 로봇을 오래 점유한다.
HEARTBEAT_SEC = 5
TTL_SEC = 15


@dataclass
class ControlLock:
    robot_id: int
    owner_type: OwnerType
    owner_id: str            # "operator@qcs" | "schedule:1204" | "elevator-fsm"
    token: str
    acquired_at: float
    last_seen: float
    owner_label: str | None = None   # 화면에 보여줄 이름 (없으면 owner_id)
    meta: dict = field(default_factory=dict)

    @property
    def expired(self) -> bool:
        return (time.time() - self.last_seen) > TTL_SEC

    @property
    def expires_in(self) -> float:
        return max(0.0, TTL_SEC - (time.time() - self.last_seen))

    def to_public(self) -> dict:
        """화면에 내보내는 형태. token 은 소유자에게만 반환하므로 여기 포함하지 않는다."""
        return {
            "robotId": self.robot_id,
            "ownerType": self.owner_type,
            "ownerId": self.owner_id,
            "ownerLabel": self.owner_label or self.owner_id,
            "acquiredAt": self.acquired_at,
            "expiresIn": round(self.expires_in, 1),
        }


class ControlLockConflict(Exception):
    """이미 다른 세션이 쥐고 있음. 라우터에서 409로 변환한다."""

    def __init__(self, current: ControlLock):
        self.current = current
        super().__init__(f"robot {current.robot_id} is controlled by {current.owner_id}")


class ControlLockDenied(Exception):
    """토큰이 없거나 만료됨. 라우터에서 409로 변환한다."""


_locks: dict[int, ControlLock] = {}
_lock = threading.RLock()

# 제어권이 풀릴 때 실행할 정리 훅. 팔이 뻗어 있으면 수납하는 등의 안전 동작을 붙인다.
# (robot_id, reason) -> None. 예외는 삼킨다 — 정리 실패가 해제 자체를 막으면 안 된다.
_release_hooks: list = []


def register_release_hook(fn) -> None:
    """제어권 해제 시 호출될 훅 등록. 팔 수납 등 안전 정리용."""
    _release_hooks.append(fn)


def _fire_release_hooks(robot_id: int, reason: str) -> None:
    for fn in _release_hooks:
        try:
            fn(robot_id, reason)
        except Exception:  # noqa: BLE001 - 정리 실패가 해제를 막지 않는다
            import logging

            logging.getLogger(__name__).exception("release hook 실패 robot=%s", robot_id)


def _purge_if_expired(robot_id: int) -> None:
    """만료된 lock 을 조용히 걷어낸다. 호출자는 _lock 을 쥐고 있어야 한다."""
    cur = _locks.get(robot_id)
    if cur and cur.expired:
        _locks.pop(robot_id, None)
        _fire_release_hooks(robot_id, "expired")


def _new_token(robot_id: int, owner_id: str) -> str:
    import secrets

    return f"{robot_id}-{secrets.token_urlsafe(12)}"


def get(robot_id: int) -> ControlLock | None:
    """현재 소유 상태. 만료된 것은 없는 것으로 본다."""
    with _lock:
        _purge_if_expired(robot_id)
        return _locks.get(robot_id)


def get_all() -> list[ControlLock]:
    with _lock:
        for rid in list(_locks.keys()):
            _purge_if_expired(rid)
        return list(_locks.values())


def acquire(
    robot_id: int,
    owner_type: OwnerType,
    owner_id: str,
    owner_label: str | None = None,
    meta: dict | None = None,
) -> ControlLock:
    """제어권 획득. 같은 소유자면 갱신, 다른 소유자가 쥐고 있으면 ControlLockConflict."""
    with _lock:
        _purge_if_expired(robot_id)
        cur = _locks.get(robot_id)
        now = time.time()

        if cur is not None:
            if cur.owner_type == owner_type and cur.owner_id == owner_id:
                # 같은 소유자의 재획득은 연장으로 취급한다 (새로고침·재접속)
                cur.last_seen = now
                return cur
            raise ControlLockConflict(cur)

        lock = ControlLock(
            robot_id=robot_id,
            owner_type=owner_type,
            owner_id=owner_id,
            token=_new_token(robot_id, owner_id),
            acquired_at=now,
            last_seen=now,
            owner_label=owner_label,
            meta=meta or {},
        )
        _locks[robot_id] = lock
        return lock


def heartbeat(robot_id: int, token: str) -> ControlLock:
    """소유자가 살아있음을 알린다. 토큰이 다르거나 없으면 ControlLockDenied."""
    with _lock:
        _purge_if_expired(robot_id)
        cur = _locks.get(robot_id)
        if cur is None or cur.token != token:
            raise ControlLockDenied("제어권이 없습니다")
        cur.last_seen = time.time()
        return cur


def release(robot_id: int, token: str) -> bool:
    """정상 반환. 토큰이 맞을 때만 해제한다."""
    with _lock:
        cur = _locks.get(robot_id)
        if cur is None:
            return False
        if cur.token != token:
            raise ControlLockDenied("제어권이 없습니다")
        _locks.pop(robot_id, None)
    _fire_release_hooks(robot_id, "released")
    return True


def force_release(robot_id: int, reason: str = "forced") -> ControlLock | None:
    """관리자 강제 회수. 감사 로그는 호출자(라우터)가 남긴다."""
    with _lock:
        cur = _locks.pop(robot_id, None)
    if cur is not None:
        _fire_release_hooks(robot_id, reason)
    return cur


def verify(robot_id: int, token: str | None) -> ControlLock:
    """조작 명령 진입점에서 쓰는 검사. 통과하면 last_seen 을 갱신한다.

    명령 자체가 heartbeat 역할을 하므로, 활발히 조작하는 동안에는 별도 heartbeat 가
    끊겨도 제어권이 살아있다.
    """
    if not token:
        raise ControlLockDenied("제어권이 필요합니다")
    with _lock:
        _purge_if_expired(robot_id)
        cur = _locks.get(robot_id)
        if cur is None:
            raise ControlLockDenied("제어권이 없습니다")
        if cur.token != token:
            raise ControlLockConflict(cur)
        cur.last_seen = time.time()
        return cur


# ── 시스템(자율) 소유자를 위한 헬퍼 ────────────────────────────────────────
# 스케줄 실행·엘리베이터 FSM 이 팔·이동을 잡을 때 쓴다. 사람 세션과 같은 문을 쓴다.

def acquire_system(robot_id: int, owner_id: str, label: str | None = None) -> ControlLock | None:
    """자율 쪽 획득. 사람이 쥐고 있으면 빼앗지 않고 None 을 돌려준다.

    자율이 사람을 밀어내지 않는다 — 사람이 수동 조작 중이면 자율은 그 지점의
    장치 동작을 포기하고 나머지를 진행하거나 정책에 따라 중단한다.
    """
    try:
        return acquire(robot_id, "system", owner_id, owner_label=label)
    except ControlLockConflict:
        return None


def release_system(robot_id: int, owner_id: str) -> bool:
    """자율 쪽 반환. 소유자가 바뀌었으면 아무것도 하지 않는다."""
    with _lock:
        cur = _locks.get(robot_id)
        if cur is None or cur.owner_type != "system" or cur.owner_id != owner_id:
            return False
        _locks.pop(robot_id, None)
    _fire_release_hooks(robot_id, "released")
    return True
