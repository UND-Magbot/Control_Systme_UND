"""전원 on 직후 로봇이 보고하는 위치 값을 JSON 파일로 캡처(조사용).

목적: 로봇이 부팅 시 `GET /robot/position`(= receiver POSITION 응답)으로 어떤 좌표를
     보고하는지 실측한다. last_status 와 비교해 '부팅 보고 위치를 자동 주입(밀어넣기)'
     가능 여부를 판단하기 위한 데이터 수집.

출력: /backend_logs/poweron_position.jsonl (호스트 마운트). 1줄 = 1 스냅샷(JSON).
  - kind="trigger": 전원 on 감지 순간 1회(보고 위치 + last_status + delta).
  - kind="poll":    미확정(initpose_pending) 동안 보고 위치 추이(약 1초 간격 스로틀).
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from datetime import datetime

_CAPTURE_PATH = os.environ.get("POWERON_CAPTURE_PATH", "/backend_logs/poweron_position.jsonl")
_write_lock = threading.Lock()
_throttle_lock = threading.Lock()
_last_poll_ts: dict[int, float] = {}
_POLL_INTERVAL = 1.0  # poll 캡처 최소 간격(초)


def capture(robot_id: int, kind: str, reported: dict | None = None,
            last_status: dict | None = None, extra: dict | None = None) -> None:
    """스냅샷 1줄을 캡처 파일에 append."""
    rec: dict = {
        "captured_at": datetime.now().isoformat(timespec="seconds"),
        "robot_id": robot_id,
        "kind": kind,
        "reported": reported,        # {x, y, yaw, timestamp}
        "last_status": last_status,  # {PosX, PosY, PosYaw, CurrentFloorId, UpdatedAt}
    }
    if (reported and last_status
            and reported.get("x") is not None and last_status.get("PosX") is not None):
        rec["delta_m"] = round(
            math.hypot(reported["x"] - last_status["PosX"],
                       reported["y"] - last_status["PosY"]), 3)
    if extra:
        rec["extra"] = extra
    try:
        line = json.dumps(rec, ensure_ascii=False, default=str)
        with _write_lock:
            with open(_CAPTURE_PATH, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as e:
        print(f"[POWERON-CAPTURE] write 실패: {e}")


def capture_poll_if_pending(robot_id: int, reported: dict) -> None:
    """미확정 동안 보고 위치 추이를 스로틀 캡처(position_thread 에서 호출)."""
    now = time.time()
    with _throttle_lock:
        if now - _last_poll_ts.get(robot_id, 0.0) < _POLL_INTERVAL:
            return
        _last_poll_ts[robot_id] = now
    capture(robot_id, "poll", reported=reported)
