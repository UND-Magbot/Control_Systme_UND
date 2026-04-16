"""로봇 상태/위치/네비게이션 조회 + 초기 pose 설정"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

import app.robot_io.runtime as runtime
from app.database.database import SessionLocal, get_db
from app.database.models import MapInitPose

router = APIRouter()


def _get_init_pose_from_db():
    """현재 로봇의 맵에 맞는 초기 좌표를 DB에서 조회. 없으면 config 하드코딩 값 fallback."""
    from app.robot_io import ROBOT_IP, INIT_POSE
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    if rid is None:
        return INIT_POSE

    with runtime._lock:
        entry = runtime._runtime.get(rid)
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
def get_pos():
    from app.robot_io import ROBOT_IP
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    if rid is None:
        return {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}
    return runtime.get_position(rid)


@router.get("/robot/initpose")
def get_init_pose():
    pose = _get_init_pose_from_db()
    return {"x": pose["PosX"], "y": pose["PosY"], "yaw": pose["Yaw"]}


@router.post("/robot/initpose")
def init_pose():
    from app.robot_io import ROBOT_IP
    from app.robot_io.sender import send_to_robot
    pose = _get_init_pose_from_db()

    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    before = runtime.get_position(rid) if rid else {}

    # receiver.py에 INIT_POSE 전송 (items로 좌표 전달)
    import json, socket
    from app.robot_io.config import RECEIVER_IP, RECEIVER_PORT
    msg = {"action": "INIT_POSE", "items": pose}
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(5.0)
    try:
        sock.sendto(json.dumps(msg).encode("utf-8"), (RECEIVER_IP, RECEIVER_PORT))
        try:
            ack_data, _ = sock.recvfrom(4096)
            ack = json.loads(ack_data.decode("utf-8"))
            print(f"[INIT_POSE] receiver 응답: {ack}")
        except socket.timeout:
            print("[INIT_POSE] receiver 응답 타임아웃")
    finally:
        sock.close()

    import time
    time.sleep(2)
    after = runtime.get_position(rid) if rid else {}
    return {
        "status": "ok",
        "before": before,
        "after": after,
        "msg": f"초기 위치 설정 완료: {pose}"
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


@router.get("/robot/nav")
def get_nav():
    from app.navigation.send_move import (
        is_navigating, current_wp_index, waypoints_list, nav_loop_remaining,
    )
    return {
        "is_navigating": is_navigating,
        "current_wp": current_wp_index,
        "total_wp": len(waypoints_list),
        "loop_remaining": nav_loop_remaining,
    }
