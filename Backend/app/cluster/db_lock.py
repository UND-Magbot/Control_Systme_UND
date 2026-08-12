"""MariaDB 네임드 락 — 관제 백엔드 인스턴스 간 배타.

설계: 06_Planning/IMPL-Robot-Ownership-Across-Instances.md §3.1

`GET_LOCK` 은 **DB(스키마)가 아니라 서버 전역**이라, `.21`(control_system)과
`.14`(control_system_dev)가 같은 MariaDB 서버에 붙어 있으면 같은 이름을 두고 경합한다.
커넥션이 끊기면 DB 가 락을 자동 회수하므로 TTL 을 따로 정할 필요가 없다.

**전용 커넥션을 쓴다.** 풀에 반납되는 커넥션으로 잡으면 반납 시점에 락이 통째로 풀린다.
그래서 NullPool 짜리 별도 엔진을 만들어 그 raw 커넥션을 붙들고 있는다.
"""
from __future__ import annotations

import threading
import time

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.database.database import DATABASE_URL, engine as _main_engine

LOCK_PREFIX = "qcs_robot_"

KEEPALIVE_SEC = 5        # 자기확인 주기
# 이만큼 자기확인 실패가 이어져야 상실을 확정한다.
# 짧게 잡으면 안 된다 — 두 인스턴스 모두 무선으로 DB 에 붙고, 실측 48초 두절 기록이 있다
# (2026-07-27, kanje-pc-wifi-self-interference). control_lock.TTL_SEC(사람의 브라우저
# 무응답 15초)와는 성격이 다른 값이라 별도로 둔다.
LOST_AFTER_SEC = 60

STATE_OK = "ok"
STATE_UNCERTAIN = "uncertain"   # 자기확인 실패 중 — 새 획득만 금지, 진행 중은 유지
STATE_LOST = "lost"             # 상실 확정 — 보유분을 놓아야 한다
STATE_DB_DOWN = "db_down"       # DB 자체가 죽음 — 아무도 못 잡으므로 유지가 안전

_conn = None
_conn_lock = threading.RLock()
_held: set[str] = set()
_last_ok_at = 0.0
_state = STATE_OK
_keeper_started = False
_lock_engine = None


def lock_name(robot_id: int) -> str:
    return f"{LOCK_PREFIX}{robot_id}"


# ─── 전용 커넥션 ───

def _get_conn():
    """락 전용 raw 커넥션. 끊겼으면 새로 연다. 호출자는 _conn_lock 을 쥐고 있어야 한다."""
    global _conn, _lock_engine
    if _conn is not None:
        return _conn
    if _lock_engine is None:
        # NullPool: 커넥션 수명을 우리가 직접 관리한다(풀이 회수해 가면 락이 풀린다).
        _lock_engine = create_engine(DATABASE_URL, poolclass=NullPool)
    raw = _lock_engine.raw_connection()
    try:
        raw.autocommit(True)
    except Exception:  # noqa: BLE001 - 드라이버에 따라 없을 수 있다
        pass
    _conn = raw
    return _conn


def _drop_conn() -> None:
    """커넥션을 버린다. 이 시점에 DB 는 이 커넥션의 락을 전부 해제한다."""
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        except Exception:  # noqa: BLE001
            pass
        _conn = None


def _exec(sql: str, args: tuple = ()):
    """전용 커넥션에서 한 줄 조회. 실패하면 커넥션을 버리고 예외를 올린다."""
    with _conn_lock:
        try:
            cur = _get_conn().cursor()
            try:
                cur.execute(sql, args)
                row = cur.fetchone()
            finally:
                cur.close()
            return row
        except Exception:
            _drop_conn()
            raise


# ─── 상태 ───

def state() -> str:
    return _state


def held() -> set[str]:
    with _conn_lock:
        return set(_held)


def holds(robot_id: int) -> bool:
    return lock_name(robot_id) in held()


def _db_alive() -> bool:
    """DB 서버 자체가 살아 있는가. 락 커넥션이 아니라 **메인 풀**로 본다.

    DB 가 죽어 있으면 아무도 락을 못 잡으므로 우리가 물러날 이유가 없다.
    """
    try:
        with _main_engine.connect() as c:
            c.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


def _self_check() -> bool:
    """보유 중인 락이 정말 내 것인지 확인.

    `SELECT 1` 로는 부족하다 — 커넥션 생존과 락 보유는 다르다.
    IS_USED_LOCK 이 내 CONNECTION_ID 인지 봐야 둘을 한 번에 검증한다.
    """
    names = held()
    if not names:
        # 보유분이 없으면 커넥션 생존만 확인한다.
        try:
            _exec("SELECT 1")
            return True
        except Exception:  # noqa: BLE001
            return False
    try:
        for name in names:
            row = _exec("SELECT IS_USED_LOCK(%s) = CONNECTION_ID()", (name,))
            if not row or not row[0]:
                return False
        return True
    except Exception:  # noqa: BLE001
        return False


# ─── 획득 · 반납 ───

def acquire(robot_id: int) -> bool:
    """락 획득 시도(대기 없음). 이미 내가 갖고 있으면 True."""
    name = lock_name(robot_id)
    with _conn_lock:
        if name in _held:
            return True
        # 상태가 불확실하면 새로 잡지 않는다 — 내가 진짜 쥐고 있는지도 모르는 상태다.
        if _state in (STATE_UNCERTAIN, STATE_LOST):
            return False
        try:
            row = _exec("SELECT GET_LOCK(%s, 0)", (name,))
        except Exception as e:  # noqa: BLE001
            print(f"[CLUSTER] 락 획득 실패 {name}: {str(e)[:80]}")
            return False
        if row and row[0] == 1:
            _held.add(name)
            _mark_ok()
            return True
        return False


def release(robot_id: int) -> bool:
    name = lock_name(robot_id)
    with _conn_lock:
        if name not in _held:
            return False
        _held.discard(name)
        try:
            _exec("SELECT RELEASE_LOCK(%s)", (name,))
        except Exception as e:  # noqa: BLE001 - 커넥션이 죽었으면 DB 가 이미 풀었다
            print(f"[CLUSTER] 락 반납 실패(무시) {name}: {str(e)[:80]}")
        return True


def holder(robot_id: int) -> dict | None:
    """현재 보유자. 없으면 None. {host, isSelf}

    조회는 메인 풀로 한다 — 락 전용 커넥션을 다른 용도로 붙잡지 않는다.
    """
    name = lock_name(robot_id)
    if name in held():
        return {"host": "self", "isSelf": True}
    try:
        with _main_engine.connect() as c:
            row = c.execute(
                text("SELECT HOST FROM information_schema.PROCESSLIST "
                     "WHERE ID = IS_USED_LOCK(:n)"),
                {"n": name},
            ).fetchone()
    except Exception as e:  # noqa: BLE001
        print(f"[CLUSTER] 보유자 조회 실패 {name}: {str(e)[:80]}")
        return None
    if not row or not row[0]:
        return None
    return {"host": str(row[0]).split(":")[0], "isSelf": False}


# ─── 감시 스레드 ───

def _mark_ok() -> None:
    global _last_ok_at, _state
    _last_ok_at = time.time()
    if _state != STATE_OK:
        print("[CLUSTER] 락 상태 회복 — ok")
    _state = STATE_OK


def _keeper(on_lost) -> None:
    """자기확인 루프. 상실이 확정되면 on_lost(robot_ids) 를 부른다."""
    global _state
    while True:
        time.sleep(KEEPALIVE_SEC)
        try:
            if _self_check():
                _mark_ok()
                continue

            # 자기확인 실패. DB 자체가 죽었으면 아무도 못 잡으므로 물러나지 않는다.
            if not _db_alive():
                if _state != STATE_DB_DOWN:
                    print("[CLUSTER] DB 도달 불가 — 락 유지(아무도 획득 불가)")
                _state = STATE_DB_DOWN
                continue

            elapsed = time.time() - _last_ok_at
            if elapsed < LOST_AFTER_SEC:
                if _state != STATE_UNCERTAIN:
                    print(f"[CLUSTER] 락 자기확인 실패 — 불확실 상태 "
                          f"({LOST_AFTER_SEC}초까지 진행 중 작업은 유지)")
                _state = STATE_UNCERTAIN
                continue

            # 상실 확정
            with _conn_lock:
                lost = set(_held)
                _held.clear()
            _state = STATE_LOST
            if lost:
                ids = {int(n[len(LOCK_PREFIX):]) for n in lost if n[len(LOCK_PREFIX):].isdigit()}
                print(f"[CLUSTER] 락 상실 확정({int(elapsed)}초) — 로봇 {sorted(ids)} 반납")
                try:
                    on_lost(ids)
                except Exception as e:  # noqa: BLE001
                    print(f"[CLUSTER] on_lost 처리 실패: {str(e)[:120]}")
            else:
                # 보유분이 없으면 상실이라 할 것도 없다. 다음 획득에서 다시 잡는다.
                _state = STATE_UNCERTAIN
        except Exception as e:  # noqa: BLE001 - 감시 스레드는 죽으면 안 된다
            print(f"[CLUSTER] keeper 오류(계속): {str(e)[:120]}")


def start_keeper(on_lost) -> None:
    """감시 스레드 기동. 중복 호출은 무시한다."""
    global _keeper_started, _last_ok_at
    if _keeper_started:
        return
    _keeper_started = True
    _last_ok_at = time.time()
    threading.Thread(target=_keeper, args=(on_lost,), daemon=True,
                     name="cluster-lock-keeper").start()
    print("[CLUSTER] 로봇 소유권 감시 시작")
