"""로봇 상태/위치/네비게이션 조회 + 초기 pose 설정"""

import json
import socket
import time

from fastapi import APIRouter, Depends, Request, Body, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import app.robot_io.runtime as runtime
from app.database.database import SessionLocal, get_db
from app.database.models import MapInitPose
from app.robot_io.config import (
    RECEIVER_IP,
    RECEIVER_PORT,
    RECEIVER_TCP_PORT,
    ROBOT_IP,
    ROBOT_PORT,
)

router = APIRouter()


class InitPoseBody(BaseModel):
    """위치 재조정 본문.

    - target="charge": 운영자가 '로봇이 충전소에 있음'을 알림 → 현재 맵/층 충전소 도킹 좌표(접지 진실)로 주입.
      (로봇이 충전소 인근에 있으나 측위가 틀어져 보고값을 신뢰할 수 없을 때 사용.)
    - {x, y}: 운영자 지정 좌표(yaw 미지정 시 last_status.PosYaw).
    - 본문 없음: 상황별(충전→dock_anchor / 비충전→현재 보고 위치).
    """
    x: float | None = None
    y: float | None = None
    yaw: float | None = None
    robot_id: int | None = None
    target: str | None = None  # "charge" 등


def _runtime_entry(robot_id: int | None) -> dict:
    if robot_id is None:
        return {}
    with runtime._lock:
        return dict(runtime._runtime.get(robot_id) or {})


def _select_robot_id(requested_robot_id: int | None = None) -> int | None:
    """요청 robot_id가 있으면 우선 사용하고, 없으면 기존 단일 로봇 환경(ROBOT_IP) 기준."""
    if requested_robot_id is not None:
        if not _runtime_entry(requested_robot_id):
            raise HTTPException(status_code=404, detail="선택한 로봇을 찾을 수 없습니다.")
        return requested_robot_id
    return runtime.get_robot_id_by_ip(ROBOT_IP)


def _last_status_yaw(rid: int) -> float:
    """robot_last_status 의 마지막 heading. 없으면 0.0."""
    from app.database.models import RobotLastStatus
    db = SessionLocal()
    try:
        r = db.query(RobotLastStatus).filter(RobotLastStatus.RobotId == rid).first()
        return float(r.PosYaw) if r and r.PosYaw is not None else 0.0
    finally:
        db.close()


def _get_init_pose_from_db(robot_id: int | None = None):
    """현재 로봇의 맵에 맞는 초기 좌표를 DB에서 조회. 없으면 config 하드코딩 값 fallback."""
    from app.robot_io import INIT_POSE
    rid = _select_robot_id(robot_id)
    if rid is None:
        return INIT_POSE

    entry = _runtime_entry(rid)
    map_id = (entry or {}).get("current_map_id")
    if not map_id:
        return INIT_POSE

    db = SessionLocal()
    try:
        pose = db.query(MapInitPose).filter(
            MapInitPose.RobotId == rid,
            MapInitPose.MapId == map_id,
        ).first()
        if pose:
            return {"PosX": pose.PosX, "PosY": pose.PosY, "PosZ": 0.0, "Yaw": pose.Yaw}
        return INIT_POSE
    finally:
        db.close()


@router.get("/robot/position")
def get_pos(robot_id: int | None = None):
    rid = _select_robot_id(robot_id)
    if rid is None:
        return {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}
    return runtime.get_position(rid)


@router.get("/robot/initpose")
def get_init_pose():
    pose = _get_init_pose_from_db()
    return {"x": pose["PosX"], "y": pose["PosY"], "yaw": pose["Yaw"]}


@router.get("/robot/initpose/compare")
def initpose_compare(robot_id: int | None = None):
    """위치 재조정 판단 보조 — 마지막 확정 위치(robot_last_status) vs 현재 보고 위치(live) 비교.

    비충전 시 운영자가 '현재 보고 위치'를 신뢰해 확정할지 정확히 판단하도록 두 좌표와 차이(delta_m)를 제공한다.
    (차이가 작으면 보고값이 마지막 확정과 일관 → 신뢰도↑ / 크면 이동·오측위 가능 → 주의.)
    충전 중이면 charging=true 로, 운영자는 '충전소 위치로 지정'을 우선 사용한다.
    """
    import math

    rid = _select_robot_id(robot_id)
    if rid is None:
        return {"robot_id": None, "charging": False, "last_status": None, "live": None, "delta_m": None}

    live = runtime.get_position(rid) or {}
    live_ts = live.get("timestamp", 0) or 0
    charging = bool(runtime.is_charging(rid))

    last_status = None
    db = SessionLocal()
    try:
        from app.database.models import RobotLastStatus
        row = db.query(RobotLastStatus).filter(RobotLastStatus.RobotId == rid).first()
        if row and row.PosX is not None and row.PosY is not None:
            last_status = {"x": row.PosX, "y": row.PosY, "yaw": row.PosYaw,
                           "floor": row.CurrentFloorId}
    finally:
        db.close()

    delta = None
    if last_status and live_ts:
        delta = round(math.hypot(live["x"] - last_status["x"], live["y"] - last_status["y"]), 2)

    return {
        "robot_id": rid,
        "charging": charging,
        "last_status": last_status,
        "live": ({"x": live.get("x"), "y": live.get("y"), "yaw": live.get("yaw"),
                  "timestamp": live_ts} if live_ts else None),
        "delta_m": delta,
    }


@router.post("/robot/initpose")
def init_pose(body: InitPoseBody | None = Body(default=None)):
    """초기 위치 주입.

    - 본문에 {x, y} 가 오면 = 운영자 맵 클릭 위치 지정. yaw 미지정 시 last_status.PosYaw 사용.
    - 본문 없으면(기존 '위치 재조정' 버튼) = map_init_pose/config 좌표 사용.
    수렴 성공 시 미초기화(자율주행 보류) 플래그를 해제한다.
    """
    # ── 수동 위치 초기화: 현재는 '충전소 위치로 지정'(target=charge)만 지원 ──
    # 비충전 위치(현재위치/운영자 좌표)의 자동·수동 초기화는 2차 개발 예정이라 막는다.
    # 자동 init_pose(auto_init_pose.py)는 별도 경로(_send_init_pose_via_receiver)라 무관.
    if body is None or body.target != "charge":
        return {
            "status": "disabled",
            "converged": False,
            "msg": "충전소 위치가 아닐 경우 관리자에게 문의하세요. (비충전 위치 초기화는 추후 지원 예정)",
        }

    rid = _select_robot_id(body.robot_id if body is not None else None)
    target_entry = _runtime_entry(rid)
    target_robot_ip = target_entry.get("robot_ip") or ROBOT_IP
    target_robot_port = int(target_entry.get("robot_port") or ROBOT_PORT)

    if body is not None and body.target == "charge":
        # 운영자가 '로봇이 충전소에 있음'을 알림 → 현재 맵/층 충전소 도킹 좌표(접지 진실)로 주입.
        # 로봇이 충전소 인근에 있으나 측위가 틀어져(보고값 신뢰 불가) 자가/현재값으로는 못 고칠 때 사용.
        from app.robot_control.auto_init_pose import _resolve_dock_pose
        cur_floor = (target_entry or {}).get("current_floor_id")
        cur_map = (target_entry or {}).get("current_map_id")
        db = SessionLocal()
        try:
            pose = _resolve_dock_pose(db, cur_floor, cur_map)
        finally:
            db.close()
        if not pose:
            return {"status": "error", "converged": False,
                    "msg": "현재 맵/층에 등록된 충전소가 없습니다. 충전소를 먼저 등록하세요."}
        print(f"[INIT_POSE] '충전소 위치로 지정' → 도킹 좌표 주입: {pose}")
    elif body is not None and body.x is not None and body.y is not None:
        # (선택) 운영자가 맵 좌표를 직접 지정한 경우. yaw 미지정 시 last_status.PosYaw.
        yaw = body.yaw if body.yaw is not None else (_last_status_yaw(rid) if rid else 0.0)
        pose = {"PosX": float(body.x), "PosY": float(body.y), "PosZ": 0.0, "Yaw": float(yaw)}
        print(f"[INIT_POSE] 운영자 지정 좌표 주입: {pose}")
    elif rid is not None:
        # 본문 없음('위치 재조정' 버튼) — 상황별:
        #   충전 중 → 충전소(dock_anchor) 접지 진실.
        #   비충전 → 로봇이 지금 보고하는 '현재 실시간 position' 으로 확정(운영자가 표시 위치 확인 후 클릭).
        if runtime.is_charging(rid):
            from app.robot_control.auto_init_pose import resolve_init_pose
            pose, _src = resolve_init_pose(rid)
            print(f"[INIT_POSE] '위치 재조정'(충전) source={_src}: {pose}")
        else:
            cur = runtime.get_position(rid) or {}
            if cur.get("timestamp", 0):
                pose = {"PosX": float(cur.get("x", 0.0)), "PosY": float(cur.get("y", 0.0)),
                        "PosZ": 0.0, "Yaw": float(cur.get("yaw", 0.0))}
                print(f"[INIT_POSE] '위치 재조정'(비충전) 현재 실시간 위치로 확정: {pose}")
            else:
                # 라이브 위치 없음(수신 전) → 폴백
                from app.robot_control.auto_init_pose import resolve_init_pose
                pose, _src = resolve_init_pose(rid)
                print(f"[INIT_POSE] '위치 재조정'(비충전, 라이브 없음) source={_src}: {pose}")
    else:
        pose = _get_init_pose_from_db()

    before = runtime.get_position(rid) if rid else {}

    # receiver.py에 INIT_POSE 전송 (items로 좌표 전달)
    import json, socket
    from app.robot_io.config import RECEIVER_IP, RECEIVER_PORT
    msg = {
        "action": "INIT_POSE",
        "items": pose,
        "robot_ip": target_robot_ip,
        "robot_port": target_robot_port,
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(5.0)
    try:
        sock.sendto(json.dumps(msg).encode("utf-8"), (RECEIVER_IP, RECEIVER_PORT))
        ack = None
        try:
            ack_data, _ = sock.recvfrom(4096)
            ack = json.loads(ack_data.decode("utf-8"))
            print(f"[INIT_POSE] receiver 응답: {ack}")
        except socket.timeout:
            print("[INIT_POSE] receiver 응답 타임아웃")
    finally:
        sock.close()

    # 수렴 검증 후, 성공 시 미초기화(자율주행 보류) 플래그 해제 + 복구 로그.
    # 로봇이 INIT_POSE 를 수락(status:ok)했을 때만 검증 의미가 있다.
    converged, reason = False, "미수락"
    if rid is not None and (ack or {}).get("status") == "ok":
        from app.robot_control.auto_init_pose import verify_and_clear
        converged, reason = verify_and_clear(rid, pose)
    else:
        import time
        time.sleep(2)

    after = runtime.get_position(rid) if rid else {}
    return {
        "status": "ok",
        "converged": converged,
        "before": before,
        "after": after,
        "msg": f"초기 위치 설정 완료: {pose}" if converged
               else f"초기 위치 명령 전송됨(수렴 미확인: {reason}): {pose}",
    }


@router.post("/robot/initpose/auto-test")
def auto_test_initpose():
    """[디버그] 전원 사이클 없이 '자동 init_pose' 파이프라인을 즉시 실행한다.

    전원 on 상승에지를 기다리지 않고 in-process 로 `_inject_worker` 를 돌리므로
    resolve_init_pose(dock_anchor 우선) → 준비대기 재시도 → 수렴검증 → escalation
    전체를 실제와 동일하게 탄다. 로그는 `[AUTO-INITPOSE]` 로 확인.

    ⚠️ 실제 로봇 localization 을 시드 좌표로 재설정한다(수동 '위치 재조정'과 동일한 물리 효과).
    """
    from app.robot_io import ROBOT_IP
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    if rid is None:
        return {"status": "error", "msg": "로봇을 찾을 수 없습니다."}

    import threading
    from app.robot_control.auto_init_pose import _inject_worker, resolve_init_pose

    pose, source = resolve_init_pose(rid)  # 어떤 소스가 선택될지 응답에 미리 노출
    threading.Thread(
        target=_inject_worker, args=(rid,), daemon=True, name="auto_initpose_test"
    ).start()
    return {
        "status": "ok",
        "msg": f"robot {rid} 자동 init_pose 파이프라인 실행 — 로그([AUTO-INITPOSE])로 진행 확인",
        "resolved_source": source,
        "resolved_pose": pose,
    }


@router.post("/robot/_debug/sim-poweron")
def sim_poweron():
    """[디버그] 전원 사이클 없이 '전원 on 상승에지'를 시뮬레이션한다.

    auto-test(=주입만 즉시 실행)와 달리, 이건 ①전원 on 감지(트리거)까지 실제 경로로 탄다:
    상태를 리셋해 두면 로봇이 online 인 동안 다음 status heartbeat(약 1초 내)의
    check_and_init_pose 가 상승에지로 인식 → 자동으로 _inject_worker 가 발화한다.

    ⚠️ 로봇/리시버가 응답 중(STATUS heartbeat 수신)이어야 트리거가 발화한다.
       로봇 localization 이 시드 좌표로 실제 재설정된다(실로봇 영향 있음).
    """
    from app.robot_io import ROBOT_IP
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    if rid is None:
        return {"status": "error", "msg": "로봇을 찾을 수 없습니다."}

    from app.robot_control.auto_init_pose import force_power_on_edge
    force_power_on_edge(rid)
    return {
        "status": "ok",
        "msg": f"robot {rid} 전원 on 상승에지 시뮬레이션 — 다음 heartbeat(~1s)에 자동 주입 발화. "
               f"로그([AUTO-INITPOSE])로 확인하세요.",
        "note": "로봇/리시버가 online 응답 중이어야 트리거가 발화합니다.",
    }


@router.get("/robot/status")
def get_status(request: Request, db: Session = Depends(get_db)):
    from app.auth.dependencies import get_current_user, is_admin, get_business_robot_ids
    current_user = get_current_user(request, db)
    all_statuses = runtime.get_all_statuses()
    if is_admin(current_user) or not current_user.BusinessId:
        return all_statuses
    biz_robot_ids = get_business_robot_ids(db, current_user.BusinessId)
    return [s for s in all_statuses if s["robot_id"] in biz_robot_ids]


def _probe_receiver(timeout: float = 1.5) -> dict:
    """receiver.py UDP 응답 확인.

    새 receiver는 PING에 즉시 응답한다. 아직 갱신되지 않은 receiver와도 호환되도록
    STATUS 요청을 한 번 더 시도한다.
    """
    started = time.monotonic()
    last_error = None
    for action in ("PING", "STATUS"):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        try:
            sock.sendto(json.dumps({"action": action}).encode("utf-8"), (RECEIVER_IP, RECEIVER_PORT))
            data, _ = sock.recvfrom(8192)
            elapsed_ms = round((time.monotonic() - started) * 1000, 1)
            payload = json.loads(data.decode("utf-8"))
            return {
                "reachable": True,
                "action": action,
                "latency_ms": elapsed_ms,
                "response": payload,
            }
        except Exception as exc:
            last_error = str(exc)
        finally:
            sock.close()
    return {
        "reachable": False,
        "action": None,
        "latency_ms": None,
        "error": last_error or "receiver did not respond",
    }


@router.get("/robot/connection")
def get_robot_connection():
    """Docker 관제 서버 ↔ receiver/NOS ↔ 로봇 연결 진단.

    공유기/로봇망에 관제 PC가 붙은 뒤 이 API로 컨테이너가 실제 어느 IP/port를
    바라보는지와 receiver 응답 여부를 바로 확인한다.
    """
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    position = runtime.get_position(rid) if rid is not None else None
    statuses = runtime.get_all_statuses()
    status = next((item for item in statuses if item.get("robot_id") == rid), None)

    return {
        "configured": {
            "robot": {"ip": ROBOT_IP, "udp_port": ROBOT_PORT},
            "receiver": {
                "ip": RECEIVER_IP,
                "udp_port": RECEIVER_PORT,
                "tcp_port": RECEIVER_TCP_PORT,
            },
        },
        "receiver_udp": _probe_receiver(),
        "runtime": {
            "robot_id": rid,
            "position": position,
            "status": status,
        },
    }


@router.get("/robot/nav")
def get_nav():
    from app.navigation.send_move import (
        is_navigating, current_wp_index, waypoints_list, nav_loop_remaining, nav_loop_total,
        nav_loop_count, nav_loop_infinite,
    )
    return {
        "is_navigating": is_navigating,
        "current_wp": current_wp_index,
        "total_wp": len(waypoints_list),
        "loop_remaining": nav_loop_remaining,
        "loop_total": nav_loop_total,
        "loop_count": nav_loop_count,
        "loop_infinite": nav_loop_infinite,
    }
