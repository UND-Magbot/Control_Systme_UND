"""로봇 제어권(control lock) — 한 로봇은 동시에 한 세션만 조작한다.

설계 근거: 06_Planning/ARCH-Remote-Control-and-Device-Console.md §4
- 단위는 **로봇**이다. 서브시스템(이동/팔)별로 나눠 쥐지 않는다 —
  움직이는 베이스 위에서 남이 팔을 조작하는 상황을 구조적으로 막기 위해서다.
- 소유자는 사람만이 아니다. 자율(스케줄·엘리베이터 FSM)도 같은 lock을 잡는다.
  그래서 "자율↔수동 배타 잠금"이 특수 로직이 아니라 소유자 교체가 된다.
- 조작은 관찰을 막지 않는다. 상태·영상 열람은 제어권 없이 가능하다.
- 정지(일시정지·긴급정지)는 **제어권보다 위**다. 이 모듈은 정지를 막지 않는다.

소유자 상세(누가·언제·토큰)는 프로세스 메모리에 두고, **"이 로봇을 어느 백엔드가
쓰는가"만 DB 네임드 락**(`app.cluster.db_lock`)으로 올린다. 관제가 여러 대(demo/개발)
떠 있어도 로봇 하나는 한 대만 조종한다.
설계: 06_Planning/IMPL-Robot-Ownership-Across-Instances.md
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Literal

from app.cluster import db_lock

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
    """이미 다른 세션이 쥐고 있음. 라우터에서 409로 변환한다.

    `preemptible` 은 "사람이 확인 후 뺏을 수 있는가"다. 자율(system)이 쥐고 있고
    요청자가 사람이면 True — 프론트가 확인을 받아 force 로 재요청한다.
    다른 인스턴스가 쥐고 있으면 뺏을 수 없으므로 False 다.
    """

    def __init__(self, current: ControlLock, preemptible: bool = False):
        self.current = current
        self.preemptible = preemptible
        super().__init__(f"robot {current.robot_id} is controlled by {current.owner_id}")


class ControlLockDenied(Exception):
    """토큰이 없거나 만료됨. 라우터에서 409로 변환한다."""


_locks: dict[int, ControlLock] = {}
_lock = threading.RLock()

# 인스턴스 락 반납을 _lock 밖에서 처리하기 위한 대기열.
# DB I/O 를 _lock 안에서 하면 순단 시 조회 경로까지 통째로 막힌다.
_pending_release: list[int] = []

# 제어권이 풀릴 때 실행할 정리 훅. 팔이 뻗어 있으면 수납하는 등의 안전 동작을 붙인다.
# (robot_id, reason) -> None. 예외는 삼킨다 — 정리 실패가 해제 자체를 막으면 안 된다.
_release_hooks: list = []

# 사람이 자율을 선점했을 때의 훅. (robot_id, preempted_owner_id, by_owner_id) -> None
# 스케줄러가 진행 중 회차를 aborted 로 마감하는 데 쓴다.
_preempt_hooks: list = []

# DB 락 상실이 확정됐을 때의 훅. (robot_id) -> None
# 주행 정지·회차 마감처럼 "통신이 끊겨 물러난다"에 해당하는 처리만 붙인다.
_lost_hooks: list = []


def register_release_hook(fn) -> None:
    """제어권 해제 시 호출될 훅 등록. 팔 수납 등 안전 정리용."""
    _release_hooks.append(fn)


def register_preempt_hook(fn) -> None:
    """사람이 자율을 선점했을 때 호출될 훅 등록."""
    _preempt_hooks.append(fn)


def register_lost_hook(fn) -> None:
    """DB 락 상실 확정 시 호출될 훅 등록."""
    _lost_hooks.append(fn)


def _flush_releases() -> None:
    """대기열에 쌓인 인스턴스 락을 반납한다. 반드시 _lock 밖에서 부른다."""
    while True:
        with _lock:
            if not _pending_release:
                return
            rid = _pending_release.pop()
        db_lock.release(rid)


def _remote_conflict(robot_id: int) -> ControlLockConflict:
    """다른 인스턴스가 쥐고 있을 때의 충돌. 기존 소비자가 `e.current.to_public()` 을
    그대로 쓸 수 있도록 ControlLock 형태로 만들어 준다."""
    h = db_lock.holder(robot_id) or {}
    host = h.get("host") or "다른 관제"
    now = time.time()
    remote = ControlLock(
        robot_id=robot_id,
        owner_type="system",
        owner_id=f"instance:{host}",
        token="",
        acquired_at=now,
        last_seen=now,
        owner_label=f"다른 관제({host})",
        meta={"remote": True, "host": host},
    )
    return ControlLockConflict(remote, preemptible=False)


def _fire_release_hooks(robot_id: int, reason: str) -> None:
    for fn in _release_hooks:
        try:
            fn(robot_id, reason)
        except Exception:  # noqa: BLE001 - 정리 실패가 해제를 막지 않는다
            import logging

            logging.getLogger(__name__).exception("release hook 실패 robot=%s", robot_id)


def _purge_if_expired(robot_id: int) -> None:
    """만료된 lock 을 조용히 걷어낸다. 호출자는 _lock 을 쥐고 있어야 한다.

    인스턴스 락 반납은 대기열에 넣는다 — DB I/O 를 _lock 안에서 하지 않기 위해서다.
    """
    cur = _locks.get(robot_id)
    if cur and cur.expired:
        _locks.pop(robot_id, None)
        _pending_release.append(robot_id)
        _fire_release_hooks(robot_id, "expired")


def _new_token(robot_id: int, owner_id: str) -> str:
    import secrets

    return f"{robot_id}-{secrets.token_urlsafe(12)}"


def get(robot_id: int) -> ControlLock | None:
    """현재 소유 상태. 만료된 것은 없는 것으로 본다."""
    with _lock:
        _purge_if_expired(robot_id)
        cur = _locks.get(robot_id)
    _flush_releases()
    return cur


def get_all() -> list[ControlLock]:
    with _lock:
        for rid in list(_locks.keys()):
            _purge_if_expired(rid)
        out = list(_locks.values())
    _flush_releases()
    return out


def acquire(
    robot_id: int,
    owner_type: OwnerType,
    owner_id: str,
    owner_label: str | None = None,
    meta: dict | None = None,
    force: bool = False,
) -> ControlLock:
    """제어권 획득. 같은 소유자면 갱신, 다른 소유자가 쥐고 있으면 ControlLockConflict.

    **사람은 자율을 선점할 수 있다** — 로봇이 이상하게 움직일 때 사람이 잡아야 하기
    때문이다. 다만 조용히 뺏지는 않는다: force 없이 오면 preemptible=True 로 거절하고,
    프론트가 확인을 받아 force=True 로 재요청한다.
    자율이 사람을 밀어내는 방향은 여전히 허용하지 않는다.
    """
    _flush_releases()
    preempted: ControlLock | None = None
    try:
        with _lock:
            _purge_if_expired(robot_id)
            cur = _locks.get(robot_id)
            now = time.time()

            if cur is not None:
                if cur.owner_type == owner_type and cur.owner_id == owner_id:
                    # 같은 소유자의 재획득은 연장으로 취급한다 (새로고침·재접속)
                    cur.last_seen = now
                    return cur
                if owner_type == "user" and cur.owner_type == "system":
                    if not force:
                        raise ControlLockConflict(cur, preemptible=True)
                    preempted = _locks.pop(robot_id)
                else:
                    raise ControlLockConflict(cur)
            else:
                # 로컬이 비어 있다 = 이 인스턴스가 이 로봇을 안 쓰고 있다.
                # 다른 백엔드가 쓰고 있는지 DB 로 확인하고, 비어 있으면 잡는다.
                if not db_lock.acquire(robot_id):
                    raise _remote_conflict(robot_id)

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
    finally:
        _flush_releases()

    if preempted is not None:
        print(f"[CONTROL] 선점: {preempted.owner_id} → {owner_id} (robot {robot_id})")
        for fn in _preempt_hooks:
            try:
                fn(robot_id, preempted.owner_id, owner_id)
            except Exception:  # noqa: BLE001 - 정리 실패가 선점을 되돌리지 않는다
                import logging

                logging.getLogger(__name__).exception("preempt hook 실패 robot=%s", robot_id)
        _fire_release_hooks(robot_id, "preempted")
    return lock


def heartbeat(robot_id: int, token: str) -> ControlLock:
    """소유자가 살아있음을 알린다. 토큰이 다르거나 없으면 ControlLockDenied."""
    try:
        with _lock:
            _purge_if_expired(robot_id)
            cur = _locks.get(robot_id)
            if cur is None or cur.token != token:
                raise ControlLockDenied("제어권이 없습니다")
            cur.last_seen = time.time()
            return cur
    finally:
        _flush_releases()


def release(robot_id: int, token: str) -> bool:
    """정상 반환. 토큰이 맞을 때만 해제한다."""
    with _lock:
        cur = _locks.get(robot_id)
        if cur is None:
            return False
        if cur.token != token:
            raise ControlLockDenied("제어권이 없습니다")
        _locks.pop(robot_id, None)
        _pending_release.append(robot_id)
    _flush_releases()
    _fire_release_hooks(robot_id, "released")
    return True


def force_release(robot_id: int, reason: str = "forced") -> ControlLock | None:
    """관리자 강제 회수. 감사 로그는 호출자(라우터)가 남긴다."""
    with _lock:
        cur = _locks.pop(robot_id, None)
        if cur is not None:
            _pending_release.append(robot_id)
    _flush_releases()
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
    try:
        with _lock:
            _purge_if_expired(robot_id)
            cur = _locks.get(robot_id)
            if cur is None:
                raise ControlLockDenied("제어권이 없습니다")
            if cur.token != token:
                raise ControlLockConflict(cur)
            cur.last_seen = time.time()
            return cur
    finally:
        _flush_releases()


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
        _pending_release.append(robot_id)
    _flush_releases()
    _fire_release_hooks(robot_id, "released")
    return True


# ── 인스턴스 락 상실 처리 ──────────────────────────────────────────────────

def _on_db_lock_lost(robot_ids: set[int]) -> None:
    """DB 락 상실이 확정됐을 때. db_lock keeper 가 부른다.

    **release hook 을 발화하지 않는다.** 그건 "팔 수납" 같은 물리 동작이라
    통신 두절로 예고 없이 팔이 움직이면 위험하다. 대신 _lost_hooks 로
    "주행 정지·회차 마감" 처럼 물러남에 해당하는 처리만 한다.
    """
    for rid in robot_ids:
        with _lock:
            cur = _locks.pop(rid, None)
        if cur is not None:
            print(f"[CONTROL] 인스턴스 락 상실로 제어권 해제: robot {rid} ({cur.owner_id})")
        for fn in _lost_hooks:
            try:
                fn(rid)
            except Exception:  # noqa: BLE001
                import logging

                logging.getLogger(__name__).exception("lost hook 실패 robot=%s", rid)


def start() -> None:
    """소유권 감시 기동. main.py 기동 시 1회 호출한다."""
    db_lock.start_keeper(_on_db_lock_lost)
