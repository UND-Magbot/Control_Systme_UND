from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database.database import get_db
from app.database.models import LocationInfo, UserInfo
from app.auth.dependencies import require_any_permission

point = APIRouter(prefix="/nav")


def _next_cur_name(db: Session) -> str:
    """CUR-001, CUR-002, ... 빈 번호 찾기 (삭제된 번호 재사용)"""
    existing = (
        db.query(LocationInfo.LacationName)
        .filter(LocationInfo.LacationName.like("CUR-%"))
        .all()
    )
    used = set()
    for (name,) in existing:
        try:
            num = int(name.split("-")[1])
            used.add(num)
        except (IndexError, ValueError):
            pass

    n = 1
    while n in used:
        n += 1
    return f"CUR-{n:03d}"


@point.post("/savepoint")
def save_current_waypoint(current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit"))):
    """현재 로봇 좌표만 반환 (DB 저장 안 함). 프론트에서 경로 생성 완료 시 한번에 저장."""
    import app.robot_io.runtime as runtime

    rid = runtime.get_first_robot_id()
    current_pos = runtime.get_position(rid) if rid else {"x": 0.0, "y": 0.0, "yaw": 0.0, "timestamp": 0}

    if current_pos["timestamp"] == 0:
        return {"status": "error", "msg": "로봇 위치 응답 없음"}

    return {
        "status": "ok",
        "x": round(current_pos["x"], 3),
        "y": round(current_pos["y"], 3),
        "yaw": round(current_pos["yaw"], 3),
    }


class CreatePathReq(BaseModel):
    waypoints: list[dict]  # [{"x": 1.0, "y": 2.0, "yaw": 0.5}, ...]
    way_name: str | None = None  # 지정하지 않으면 자동 생성


@point.post("/createpath")
def create_remote_path(req: CreatePathReq, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit"))):
    """직접 경로 생성 완료: 좌표 → LocationInfo 저장 + WayInfo 생성."""
    from app.database.models import RobotInfo, RobotMapInfo, WayInfo

    if len(req.waypoints) < 2:
        return {"status": "error", "msg": "최소 2개 이상의 위치가 필요합니다."}

    import app.robot_io.runtime as runtime
    rid = runtime.get_first_robot_id()
    robot = db.query(RobotInfo).filter(RobotInfo.id == rid).first() if rid else None
    floor_id = robot.CurrentFloorId if robot else None
    robot_name = robot.RobotName if robot else ""

    map_id = None
    if floor_id:
        active_map = db.query(RobotMapInfo).filter(RobotMapInfo.FloorId == floor_id).order_by(RobotMapInfo.id.desc()).first()
        map_id = active_map.id if active_map else None

    # 경로 이름: 지정된 이름 또는 자동 생성
    if req.way_name and req.way_name.strip():
        way_name = req.way_name.strip()
        # 중복 확인
        if db.query(WayInfo).filter(WayInfo.WayName == way_name).first():
            return {"status": "error", "msg": f"경로 이름 '{way_name}'이(가) 이미 존재합니다."}
    else:
        import re
        existing_names = db.query(WayInfo.WayName).filter(WayInfo.WayName.like("경로-%")).all()
        nums = set()
        for (name,) in existing_names:
            m = re.match(r"^경로-(\d+)$", name)
            if m:
                nums.add(int(m.group(1)))
        next_num = max(nums) + 1 if nums else 1
        way_name = f"경로-{next_num:03d}"

    # LocationInfo에 CUR-XXX로 저장
    place_names = []
    for wp in req.waypoints:
        cur_name = _next_cur_name(db)
        place = LocationInfo(
            UserId=current_user.id,
            RobotName=robot_name,
            LacationName=cur_name,
            FloorId=floor_id,
            MapId=map_id,
            LocationX=wp["x"],
            LocationY=wp["y"],
            Yaw=wp.get("yaw", 0.0),
            Category="remote",
        )
        db.add(place)
        db.flush()  # id 확보 + 다음 _next_cur_name에서 감지
        place_names.append(cur_name)

    # WayInfo 생성
    way_points_str = " - ".join(place_names)
    way = WayInfo(
        UserId=current_user.id,
        RobotName=robot_name,
        TaskType="task1",
        WayName=way_name,
        WayPoints=way_points_str,
    )
    db.add(way)
    db.commit()

    print(f"📍 경로 생성: {way_name} → {way_points_str}")
    return {
        "status": "ok",
        "way_name": way_name,
        "way_points": way_points_str,
        "place_names": place_names,
    }
