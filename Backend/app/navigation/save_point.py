import json

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
    from app.robot_io import ROBOT_IP

    # 위치 폴링 스레드·/robot/position 과 동일하게 IP로 로봇을 찾는다.
    # get_first_robot_id()는 DB의 첫 로봇을 반환하므로, 실제 위치를 수신하는
    # 로봇(IP 일치)과 다를 경우 timestamp=0(위치 없음)으로 오인된다.
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
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
    wait_seconds: list[int] | None = None  # 각 지점 도착 후 대기(초). None/all-zero면 미저장
    task_type: str = "task1"  # 작업 유형 (task1/task2/task3/test 등)


@point.post("/createpath")
def create_remote_path(req: CreatePathReq, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("place-list", "map-edit"))):
    """직접 경로 생성 완료: 좌표 → LocationInfo 저장 + WayInfo 생성.

    추가로 인접한 두 지점 사이를 양방향(bidirectional) RouteInfo 로 함께 저장해
    맵 화면에서도 구간이 표시되도록 한다. 활성 맵을 못 찾으면 RouteInfo 저장은 건너뛴다.
    """
    from app.database.models import RobotInfo, RobotMapInfo, WayInfo, RouteInfo

    if len(req.waypoints) < 2:
        return {"status": "error", "msg": "최소 2개 이상의 위치가 필요합니다."}

    import app.robot_io.runtime as runtime
    from app.robot_io import ROBOT_IP

    # /nav/savepoint 와 동일하게 IP로 로봇을 찾는다. get_first_robot_id()를 쓰면
    # 여러 대 등록 환경에서 엉뚱한 로봇의 층(FloorId)으로 경로가 저장될 수 있다.
    rid = runtime.get_robot_id_by_ip(ROBOT_IP)
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

    # WaitSeconds 정규화 (길이 맞춤, 음수/비정수 방지)
    wait_json: str | None = None
    if req.wait_seconds:
        normalized = []
        for i in range(len(place_names)):
            v = req.wait_seconds[i] if i < len(req.wait_seconds) else 0
            try:
                iv = int(v)
            except (TypeError, ValueError):
                iv = 0
            normalized.append(iv if iv > 0 else 0)
        if any(w > 0 for w in normalized):
            wait_json = json.dumps(normalized)

    # WayInfo 생성
    way_points_str = " - ".join(place_names)
    way = WayInfo(
        UserId=current_user.id,
        RobotName=robot_name,
        TaskType=(req.task_type or "task1").strip() or "task1",
        WayName=way_name,
        WayPoints=way_points_str,
        WaitSeconds=wait_json,
    )
    db.add(way)

    # 맵 표시용 양방향 구간(RouteInfo) 생성.
    # MapId 가 nullable=False 이므로 활성 맵을 못 찾은 경우엔 건너뛴다.
    if map_id:
        for i in range(len(place_names) - 1):
            db.add(RouteInfo(
                MapId=map_id,
                StartPlaceName=place_names[i],
                EndPlaceName=place_names[i + 1],
                Direction="bidirectional",
            ))

    db.commit()

    print(f"📍 경로 생성: {way_name} → {way_points_str}")
    return {
        "status": "ok",
        "way_name": way_name,
        "way_points": way_points_str,
        "place_names": place_names,
    }
