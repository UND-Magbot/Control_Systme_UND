"""runtime 인메모리 상태를 robot_last_status 테이블에 주기적으로 저장.

서버 재시작 시 마지막 상태 복구용 백업. 실시간 표시는 인메모리 경로가 담당.
"""

import threading
import time
from datetime import datetime

from sqlalchemy import text

import app.robot_io.runtime as runtime
from app.database.database import SessionLocal

PERSIST_INTERVAL = 30  # 초


def _snapshot_runtime() -> list[dict]:
    """runtime 인메모리 상태를 스냅샷으로 복사. lock 구간 최소화."""
    rows = []
    with runtime._lock:
        for entry in runtime._runtime.values():
            if entry["last_heartbeat"] == 0:
                continue
            bat = entry.get("battery") or {}
            pos = entry.get("position") or {}
            robot_type = entry.get("robot_type", "")

            if runtime._is_dual_battery(robot_type):
                bl1 = bat.get("BatteryLevelLeft")
                bl2 = bat.get("BatteryLevelRight")
                v1 = bat.get("VoltageLeft")
                v2 = bat.get("VoltageRight")
                bt1 = bat.get("battery_temperatureLeft")
                bt2 = bat.get("battery_temperatureRight")
                ch1 = 1 if bat.get("chargeLeft") else 0
                ch2 = 1 if bat.get("chargeRight") else 0
            else:
                bl1 = bat.get("SOC")
                bl2 = None
                v1 = bat.get("Voltage")
                v2 = None
                bt1 = bat.get("BatteryTemp")
                bt2 = None
                ch1 = 1 if bat.get("Charging") else 0
                ch2 = None

            rows.append({
                "RobotId": entry["robot_id"],
                "BatteryLevel1": bl1,
                "BatteryLevel2": bl2,
                "Voltage1": v1,
                "Voltage2": v2,
                "BatteryTemp1": bt1,
                "BatteryTemp2": bt2,
                "IsCharging1": ch1,
                "IsCharging2": ch2,
                "PosX": pos.get("x"),
                "PosY": pos.get("y"),
                "PosYaw": pos.get("yaw"),
                "CurrentFloorId": entry.get("current_floor_id"),
                "LastHeartbeat": datetime.fromtimestamp(entry["last_heartbeat"]),
            })
    return rows


_UPSERT_SQL = text("""
    INSERT INTO robot_last_status
        (RobotId, BatteryLevel1, BatteryLevel2,
         Voltage1, Voltage2, BatteryTemp1, BatteryTemp2,
         IsCharging1, IsCharging2,
         PosX, PosY, PosYaw, CurrentFloorId, LastHeartbeat)
    VALUES
        (:RobotId, :BatteryLevel1, :BatteryLevel2,
         :Voltage1, :Voltage2, :BatteryTemp1, :BatteryTemp2,
         :IsCharging1, :IsCharging2,
         :PosX, :PosY, :PosYaw, :CurrentFloorId, :LastHeartbeat)
    ON DUPLICATE KEY UPDATE
        BatteryLevel1  = VALUES(BatteryLevel1),
        BatteryLevel2  = VALUES(BatteryLevel2),
        Voltage1       = VALUES(Voltage1),
        Voltage2       = VALUES(Voltage2),
        BatteryTemp1   = VALUES(BatteryTemp1),
        BatteryTemp2   = VALUES(BatteryTemp2),
        IsCharging1    = VALUES(IsCharging1),
        IsCharging2    = VALUES(IsCharging2),
        PosX           = VALUES(PosX),
        PosY           = VALUES(PosY),
        PosYaw         = VALUES(PosYaw),
        CurrentFloorId = VALUES(CurrentFloorId),
        LastHeartbeat  = VALUES(LastHeartbeat),
        UpdatedAt      = NOW()
""")


def flush_all() -> None:
    """현재 runtime 상태를 즉시 DB에 batch upsert."""
    rows = _snapshot_runtime()
    if not rows:
        return

    db = SessionLocal()
    try:
        db.execute(_UPSERT_SQL, rows)
        db.commit()
        print(f"[PERSISTENCE] flush 완료: {len(rows)}대")
    except Exception as e:
        db.rollback()
        print(f"[PERSISTENCE] flush 오류: {e}")
    finally:
        db.close()


def _persistence_thread():
    """30초 간격 주기적 저�� 스레드."""
    while True:
        time.sleep(PERSIST_INTERVAL)
        try:
            flush_all()
        except Exception as e:
            print(f"[PERSISTENCE] 스레드 오류: {e}")


def start_persistence_thread():
    """persistence 스레드 시작."""
    t = threading.Thread(target=_persistence_thread, daemon=True, name="persistence")
    t.start()
    print("[PERSISTENCE] 주기적 저장 스레드 시작 (30초 간격)")
