"""스케줄 실행기.

_should_run_now()로 선정된 스케줄을 실제로 실행한다:
- 경로/장소 벌크 조회
- 웨이포인트 계산
- navigation 모듈 전역 상태 세팅
- 자동 녹화 시작
- 첫 웨이포인트 전송
"""

from datetime import datetime

from app.database.database import SessionLocal
from app.database.models import ScheduleInfo, WayInfo, LocationInfo, RobotInfo
from app.logs.service import log_event
from app.user_cache import get_robot_id, get_robot_name


def execute_schedule(schedule: ScheduleInfo) -> bool:
    """스케줄 실행: WayName으로 경로 찾아서 pathmove 트리거. 성공 시 True."""
    from app.navigation.send_move import _signal_nav_reset, navigation_send_next
    import app.navigation.send_move as nav_mod

    # 이미 네비게이션 중이면 스킵
    if nav_mod.is_navigating:
        print(f"[SCHEDULER] 네비게이션 진행 중 — 스케줄 #{schedule.id} 실행 대기")
        return False

    db = SessionLocal()
    try:
        # 스케줄 객체 1회 조회 후 재사용 (중복 조회 방지)
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule.id).first()
        if not sched:
            print(f"[SCHEDULER] 스케줄 #{schedule.id} DB에서 찾을 수 없음")
            return False

        # WayName으로 경로 조회
        path = db.query(WayInfo).filter(WayInfo.WayName == schedule.WayName).first()
        if not path:
            print(f"[SCHEDULER] 경로 '{schedule.WayName}'을 찾을 수 없음 — 스케줄 #{schedule.id}")
            log_event("error", "nav_error",
                      "스케줄 실행 실패: 경로를 찾을 수 없습니다",
                      error_json=f'{{"wayName": "{schedule.WayName}"}}',
                      robot_id=get_robot_id(), robot_name=get_robot_name())
            sched.TaskStatus = "오류"
            db.commit()
            return False

        place_names = [name.strip() for name in path.WayPoints.split(" - ")]
        if len(place_names) < 2:
            print(f"[SCHEDULER] 경로에 장소 2개 미만 — 스케줄 #{schedule.id}")
            return False

        # 장소명으로 좌표 벌크 조회 (N+1 방지)
        place_rows = (
            db.query(LocationInfo)
            .filter(LocationInfo.LacationName.in_(place_names))
            .all()
        )
        place_map = {p.LacationName: p for p in place_rows}

        # 순서 유지하며 매핑 + 누락 장소 검증
        places = []
        for name in place_names:
            place = place_map.get(name)
            if not place:
                print(f"[SCHEDULER] 장소 '{name}' 없음 — 스케줄 #{schedule.id}")
                log_event("error", "nav_error",
                          "스케줄 실행 실패: 등록되지 않은 장소입니다",
                          error_json=f'{{"placeName": "{name}"}}',
                          robot_id=get_robot_id(), robot_name=get_robot_name())
                sched.TaskStatus = "오류"
                db.commit()
                return False
            places.append(place)

        # 웨이포인트 목록 생성 (send_move pathmove와 동일 로직)
        from app.navigation.waypoints import build_waypoints_from_places
        waypoints = build_waypoints_from_places(places)

        # 네비게이션 시작 (send_move 모듈의 전역 변수 직접 설정)
        nav_mod.waypoints_list = waypoints
        nav_mod.current_wp_index = 0
        nav_mod.is_navigating = True
        _signal_nav_reset(full=True)

        route_names = " → ".join(place_names)
        print(f"[SCHEDULER] 스케줄 #{schedule.id} 실행: {schedule.WayName} ({len(waypoints)}개 포인트)")
        log_event("schedule", "path_move_start",
                  f"스케줄 실행: {schedule.WorkName} — 경로 {schedule.WayName} ({len(waypoints)}개 포인트)",
                  detail=f"경로: {route_names}",
                  robot_id=get_robot_id(), robot_name=get_robot_name())

        # 스케줄 상태 업데이트 + 실행 시작 시점에 LastRunDate 선점 기록 (중복 트리거 방지)
        sched.TaskStatus = "진행중"
        sched.LastRunDate = datetime.now()
        db.commit()

        # 자동 녹화 시작 (스케줄의 RobotName으로 로봇 ID 조회)
        try:
            from app.recording.manager import start_auto_recording
            sched_robot = db.query(RobotInfo).filter(RobotInfo.RobotName == schedule.RobotName).first()
            rec_robot_id = sched_robot.id if sched_robot else get_robot_id()
            if rec_robot_id:
                start_auto_recording(rec_robot_id)
            else:
                print(f"[SCHEDULER] 자동 녹화 건너뜀: 로봇 ID를 확인할 수 없음 (RobotName={schedule.RobotName})")
        except Exception as e:
            print(f"[SCHEDULER] 자동 녹화 시작 실패: {e}")

        # 첫 웨이포인트 전송
        navigation_send_next()
        return True

    except Exception as e:
        print(f"[SCHEDULER ERR] 스케줄 #{schedule.id} 실행 실패: {e}")
        log_event("error", "nav_error", "스케줄 실행 중 오류 발생",
                  error_json=str(e),
                  robot_id=get_robot_id(), robot_name=get_robot_name())
        db.rollback()
        return False
    finally:
        db.close()
