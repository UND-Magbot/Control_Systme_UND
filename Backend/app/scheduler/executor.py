"""스케줄 실행기.

due_planned_times()로 선정된 회차를 실제로 실행한다:
- 경로/장소 벌크 조회
- 웨이포인트 계산
- navigation 모듈 전역 상태 세팅
- 자동 녹화 시작
- 첫 웨이포인트 전송
"""

from datetime import datetime

from app.database.database import SessionLocal
from app.database.models import ScheduleInfo, WayInfo, LocationInfo, RobotInfo
# 실패 후 작업 상태 규칙은 runs 가 단일 출처다 (순환 import 없음 — runs 는 executor 를 모른다)
from app.scheduler.runs import failure_status as _failure_status
from app.logs.service import log_event
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id


def precheck_ready() -> tuple[bool, str]:
    """지금 스케줄을 시작할 수 있는 상태인지 판정. 반환: (가능 여부, 불가 사유).

    여기서 걸리는 것들은 **회차를 소모하지 않는다** — 허용 지연(grace) 안이면
    다음 틱에 다시 시도된다. 회차를 시작하기 전에 판정해야 ScheduleRun 이
    실패로 남지 않는다(E1·E3).
    """
    import app.navigation.send_move as nav_mod
    import app.robot_io.runtime as runtime

    if nav_mod.is_navigating:
        return False, "다른 작업 진행 중"

    # 안전 가드: 위치 미초기화(자동 init_pose 수렴 실패) 동안 스케줄 실행 보류.
    if runtime.is_initpose_pending(get_robot_id()):
        return False, "로봇 위치 미초기화"

    return True, ""


def resolve_standby_place(db, schedule: ScheduleInfo) -> LocationInfo | None:
    """대기 장소. 지정이 없으면 충전소를 대기장소로 본다(PRD §3.5 ①)."""
    place_id = getattr(schedule, "ReturnPlaceId", None)
    if place_id:
        return db.query(LocationInfo).filter(LocationInfo.id == place_id).first()

    from app.robot_control.charge import _get_robot_floor_id, _find_charge_station
    return _find_charge_station(db, _get_robot_floor_id(db))


def execute_standby(schedule: ScheduleInfo) -> tuple[bool, str]:
    """상시 대기 진입: 대기 장소로 이동한다.

    도착하면 그 자리에서 호출을 기다린다 — 다른 모드와 달리 도착이 회차의 끝이
    아니라 시작이라, 도착 후 스케줄러가 회차를 닫지 않는다(loop 의 standby 분기).
    """
    from app.navigation.send_move import _signal_nav_reset, navigation_send_next
    import app.navigation.send_move as nav_mod
    from app.robot_control.charge import prepare_undock_waypoints
    from app.navigation.waypoints import build_waypoints_from_places

    ready, why = precheck_ready()
    if not ready:
        return False, why

    db = SessionLocal()
    try:
        place = resolve_standby_place(db, schedule)
        if not place:
            log_event("error", "nav_error",
                      "상시 대기 실행 실패: 대기 장소를 찾을 수 없습니다",
                      error_json=f'{{"scheduleId": {schedule.id}}}',
                      robot_id=get_robot_id(), robot_name=get_robot_name(),
                      business_id=get_robot_business_id())
            return False, "대기 장소 없음 (지정 장소·충전소 모두 확인 불가)"

        waypoints = build_waypoints_from_places([place], [0], [None])
        undock_preamble = prepare_undock_waypoints()
        if undock_preamble:
            waypoints = undock_preamble + waypoints

        nav_mod.waypoints_list = waypoints
        nav_mod.current_wp_index = 0
        nav_mod.is_navigating = True
        nav_mod.auto_return_to_charge = False   # 대기장소에 머문다 — 충전소로 돌아가면 응대할 수 없다
        _signal_nav_reset(full=True)

        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule.id).first()
        if sched:
            sched.TaskStatus = "진행중"
            sched.LastRunDate = datetime.now()
            db.commit()

        log_event("schedule", "standby_start",
                  f"상시 대기 시작: {schedule.WorkName} — 대기 장소 {place.LacationName}",
                  detail=f"운영 {schedule.ActiveStartTime}~{schedule.ActiveEndTime}, 호출 방식={getattr(schedule, 'StandbyTrigger', None) or 'button'}",
                  robot_id=get_robot_id(), robot_name=get_robot_name(),
                  business_id=get_robot_business_id())

        navigation_send_next()
        return True, ""

    except Exception as e:  # noqa: BLE001
        print(f"[SCHEDULER ERR] 상시 대기 #{schedule.id} 진입 실패: {e}")
        db.rollback()
        return False, f"상시 대기 진입 오류: {str(e)[:120]}"
    finally:
        db.close()


def execute_schedule(schedule: ScheduleInfo) -> tuple[bool, str]:
    """스케줄 실행: WayName으로 경로 찾아서 pathmove 트리거.

    반환: (성공 여부, 실패 사유). 실패는 전부 재시도해도 같은 결과인 것들이라
    호출부가 회차를 오류로 마감한다 — 재시도 가능한 상태는 precheck_ready()가 거른다.
    """
    from app.navigation.send_move import _signal_nav_reset, navigation_send_next
    import app.navigation.send_move as nav_mod
    from app.robot_control.charge import prepare_undock_waypoints

    ready, why = precheck_ready()
    if not ready:
        print(f"[SCHEDULER] {why} — 스케줄 #{schedule.id} 실행 보류")
        return False, why

    db = SessionLocal()
    try:
        # 스케줄 객체 1회 조회 후 재사용 (중복 조회 방지)
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule.id).first()
        if not sched:
            print(f"[SCHEDULER] 스케줄 #{schedule.id} DB에서 찾을 수 없음")
            return False, "스케줄이 삭제됨"

        # WayName으로 경로 조회
        path = db.query(WayInfo).filter(WayInfo.WayName == schedule.WayName).first()
        if not path:
            print(f"[SCHEDULER] 경로 '{schedule.WayName}'을 찾을 수 없음 — 스케줄 #{schedule.id}")
            log_event("error", "nav_error",
                      "스케줄 실행 실패: 경로를 찾을 수 없습니다",
                      error_json=f'{{"wayName": "{schedule.WayName}"}}',
                      robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
            sched.TaskStatus = _failure_status(sched)
            db.commit()
            return False, f"경로 '{schedule.WayName}' 없음"

        place_names = [name.strip() for name in path.WayPoints.split(" - ")]
        if len(place_names) < 2:
            print(f"[SCHEDULER] 경로에 장소 2개 미만 — 스케줄 #{schedule.id}")
            return False, f"경로 '{schedule.WayName}'에 장소가 2개 미만"

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
                          robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
                sched.TaskStatus = _failure_status(sched)
                db.commit()
                return False, f"장소 '{name}' 없음"
            places.append(place)

        # 웨이포인트 목록 생성 (send_move pathmove와 동일 로직)
        from app.navigation.waypoints import build_waypoints_from_places, parse_wait_seconds, parse_stop_actions
        wait_list = parse_wait_seconds(path.WaitSeconds, len(places))
        stop_actions = parse_stop_actions(path.StopActions, len(places))
        waypoints = build_waypoints_from_places(places, wait_list, stop_actions)

        # 충전 중이면 해제 후 도킹 포인트 경유 + 180° 회전 preamble 앞에 삽입
        undock_preamble = prepare_undock_waypoints()
        if undock_preamble:
            waypoints = undock_preamble + waypoints

        # 네비게이션 시작 (send_move 모듈의 전역 변수 직접 설정)
        nav_mod.waypoints_list = waypoints
        nav_mod.current_wp_index = 0
        nav_mod.is_navigating = True
        nav_mod.auto_return_to_charge = True  # 스케줄 작업 완료 후 충전소 자동 복귀
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
        return True, ""

    except Exception as e:
        print(f"[SCHEDULER ERR] 스케줄 #{schedule.id} 실행 실패: {e}")
        log_event("error", "nav_error", "스케줄 실행 중 오류 발생",
                  error_json=str(e),
                  robot_id=get_robot_id(), robot_name=get_robot_name())
        db.rollback()
        return False, f"실행 중 오류: {str(e)[:120]}"
    finally:
        db.close()
