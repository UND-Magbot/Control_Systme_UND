"""로봇 상태/위치/네비게이션 조회 + 초기 pose 설정"""

from fastapi import APIRouter

import app.robot_io.runtime as runtime

router = APIRouter()


@router.get("/robot/position")
def get_pos():
    from app.robot_io import ROBOT_IP
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    if rid is None:
        return {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}
    return runtime.get_position(rid)


@router.post("/robot/initpose")
def init_pose():
    from app.robot_io import ROBOT_IP, send_init_pose, INIT_POSE
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
    before = runtime.get_position(rid) if rid else {}
    send_init_pose()
    after = runtime.get_position(rid) if rid else {}
    return {
        "status": "ok",
        "before": before,
        "after": after,
        "msg": f"초기 위치 설정 완료: {INIT_POSE}"
    }


@router.get("/robot/status")
def get_status():
    return runtime.get_all_statuses()


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
