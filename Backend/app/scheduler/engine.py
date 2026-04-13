"""
스케줄러 엔진
- 매 30초마다 DB에서 "대기" 상태 스케줄을 조회
- 3가지 모드 지원: once(단일), weekly(요일반복), interval(주기반복)
- 현재 시각이 실행 조건에 부합하면 pathmove 트리거
- 네비게이션 완료 시 상태 갱신 (콜백 방식)
"""

import threading
import time
import math
from datetime import datetime, date, timedelta

from sqlalchemy.orm import Session
from app.Database.database import SessionLocal
from app.Database.models import ScheduleInfo, WayInfo, LocationInfo, RobotInfo
from app.robot_sender import send_nav_to_robot
from app.logs.service import log_event
from app.current_user import get_robot_id, get_robot_name

# 요일 매핑: Repeat_Day는 "월,화,수" 형태
DAY_MAP = {0: "월", 1: "화", 2: "수", 3: "목", 4: "금", 5: "토", 6: "일"}

# 현재 스케줄러에 의해 실행 중인 스케줄 ID
_active_schedule_id: int | None = None
_lock = threading.Lock()


def get_active_schedule_id() -> int | None:
    return _active_schedule_id


def cancel_active_schedule(reason: str = "사용자 취소"):
    """진행 중인 스케줄을 취소/대기 상태로 변경한다.
    - once(단일): 취소
    - weekly/interval(반복): 대기 (다음 회차 실행 가능)
    """
    global _active_schedule_id

    with _lock:
        schedule_id = _active_schedule_id
        if schedule_id is None:
            return
        _active_schedule_id = None

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if sched:
            mode = getattr(sched, 'ScheduleMode', None) or (
                "weekly" if sched.Repeat == "Y" else "once"
            )
            if mode == "once":
                sched.TaskStatus = "취소"
            else:
                sched.TaskStatus = "대기"
            db.commit()
            print(f"[SCHEDULER] 스케줄 #{schedule_id} → {sched.TaskStatus} ({reason})")
    except Exception as e:
        print(f"[SCHEDULER ERR] 취소 처리 실패: {e}")
        db.rollback()
    finally:
        db.close()


# ─── 모드별 실행 조건 판단 ───

def _should_run_now(schedule: ScheduleInfo, now: datetime) -> bool:
    """스케줄이 지금 실행되어야 하는지 판단 (모드 디스패처)"""
    mode = getattr(schedule, 'ScheduleMode', None) or (
        "weekly" if schedule.Repeat == "Y" else "once"
    )

    if mode == "once":
        return _should_run_once(schedule, now)
    elif mode == "weekly":
        return _should_run_weekly(schedule, now)
    elif mode == "interval":
        return _should_run_interval(schedule, now)
    return False


def _should_run_once(schedule: ScheduleInfo, now: datetime) -> bool:
    """단일 실행: StartDate 전후 1분 이내에만 1회 실행"""
    start_dt = schedule.StartDate
    if start_dt is None:
        return False

    # 아직 시작 시각이 안 됐으면 스킵
    if now < start_dt:
        return False

    # StartDate로부터 1분 초과 경과 시 실행하지 않음 (놓친 스케줄 방지)
    if (now - start_dt).total_seconds() > 60:
        return False

    # 이미 실행했으면 스킵
    if (schedule.RunCount or 0) > 0:
        return False

    # 이미 오늘 실행했으면 스킵
    if schedule.LastRunDate and schedule.LastRunDate.date() == now.date():
        return False

    return True


def _should_run_weekly(schedule: ScheduleInfo, now: datetime) -> bool:
    """요일 반복: 지정 요일 + 시:분 매칭"""

    # 시리즈 날짜 범위 체크
    series_start = getattr(schedule, 'SeriesStartDate', None)
    if series_start and now.date() < series_start:
        return False

    series_end = getattr(schedule, 'SeriesEndDate', None)
    if not series_end and schedule.Repeat_End:
        try:
            series_end = datetime.strptime(str(schedule.Repeat_End).strip(), "%Y-%m-%d").date()
        except ValueError:
            pass
    if series_end and now.date() > series_end:
        return False

    # MaxRunCount 체크
    if schedule.MaxRunCount and (schedule.RunCount or 0) >= schedule.MaxRunCount:
        return False

    # 요일 체크
    if schedule.Repeat_Day:
        today_name = DAY_MAP.get(now.weekday())
        allowed_days = [d.strip() for d in schedule.Repeat_Day.split(",")]
        if today_name not in allowed_days:
            return False

    # 시:분 매칭 (다중 시각 지원: "09:00,13:00,18:00")
    exec_time = getattr(schedule, 'ExecutionTime', None)
    if exec_time:
        time_list = [t.strip() for t in exec_time.split(",")]
        matched_time = None
        for t in time_list:
            try:
                h, m = t.split(":")
                if now.hour == int(h) and now.minute == int(m):
                    matched_time = t
                    break
            except ValueError:
                continue
        if not matched_time:
            return False

        # 이 시각에 이미 실행했으면 스킵 (같은 시:분에 중복 실행 방지)
        if schedule.LastRunDate and schedule.LastRunDate.date() == now.date():
            last_hm = f"{schedule.LastRunDate.hour:02d}:{schedule.LastRunDate.minute:02d}"
            if last_hm == matched_time:
                return False
    else:
        # 레거시 폴백: StartDate의 시:분 비교
        start_dt = schedule.StartDate
        if start_dt:
            if now.hour != start_dt.hour or now.minute != start_dt.minute:
                return False
        if schedule.LastRunDate and schedule.LastRunDate.date() == now.date():
            return False

    return True


def _should_run_interval(schedule: ScheduleInfo, now: datetime) -> bool:
    """주기 반복: 활동 시간대 내 N분마다"""

    interval_min = getattr(schedule, 'IntervalMinutes', None)
    if not interval_min or interval_min <= 0:
        return False

    # 시리즈 날짜 범위 체크
    series_start = getattr(schedule, 'SeriesStartDate', None)
    if series_start and now.date() < series_start:
        return False

    series_end = getattr(schedule, 'SeriesEndDate', None)
    if not series_end and schedule.Repeat_End:
        try:
            series_end = datetime.strptime(str(schedule.Repeat_End).strip(), "%Y-%m-%d").date()
        except ValueError:
            pass
    if series_end and now.date() > series_end:
        return False

    # MaxRunCount 체크
    if schedule.MaxRunCount and (schedule.RunCount or 0) >= schedule.MaxRunCount:
        return False

    # 요일 체크 (설정된 경우)
    if schedule.Repeat_Day:
        today_name = DAY_MAP.get(now.weekday())
        allowed_days = [d.strip() for d in schedule.Repeat_Day.split(",")]
        if today_name not in allowed_days:
            return False

    # 활동 시간대 체크
    active_start_str = getattr(schedule, 'ActiveStartTime', None) or "00:00"
    active_end_str = getattr(schedule, 'ActiveEndTime', None) or "23:59"
    try:
        as_h, as_m = active_start_str.split(":")
        ae_h, ae_m = active_end_str.split(":")
        active_start_min = int(as_h) * 60 + int(as_m)
        active_end_min = int(ae_h) * 60 + int(ae_m)
        now_min = now.hour * 60 + now.minute

        if active_start_min <= active_end_min:
            # 일반: 09:00~18:00
            if now_min < active_start_min or now_min > active_end_min:
                return False
        else:
            # 자정 넘김: 22:00~06:00
            if now_min < active_start_min and now_min > active_end_min:
                return False
    except ValueError:
        pass

    # 간격 경과 체크
    if schedule.LastRunDate and schedule.LastRunDate.date() == now.date():
        elapsed = (now - schedule.LastRunDate).total_seconds()
        if elapsed < interval_min * 60:
            return False
    elif schedule.LastRunDate and schedule.LastRunDate.date() != now.date():
        # 새로운 날: ActiveStartTime 이후면 실행 가능
        pass
    # LastRunDate가 None이면 첫 실행 → 조건 충족

    return True


# ─── 스케줄 실행 ───

def _execute_schedule(schedule: ScheduleInfo) -> bool:
    """스케줄 실행: WayName으로 경로 찾아서 pathmove 트리거. 성공 시 True."""
    from app.navigation.send_move import (
        is_navigating, waypoints_list, current_wp_index,
        _signal_nav_reset, navigation_send_next
    )
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

        # 웨이포인트 목록 생성 (pathmove와 동일한 로직)
        waypoints = []
        for i, place in enumerate(places):
            x = place.LocationX
            y = place.LocationY
            if i < len(places) - 1:
                nx = places[i + 1].LocationX
                ny = places[i + 1].LocationY
                yaw = math.atan2(ny - y, nx - x)
            else:
                yaw = place.Yaw or 0.0
            waypoints.append({"x": x, "y": y, "yaw": round(yaw, 3), "name": place.LacationName})

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


# ─── 네비게이션 콜백 ───

def on_navigation_complete():
    """네비게이션 완료 시 호출되는 콜백 — 스케줄 상태 갱신"""
    global _active_schedule_id

    with _lock:
        schedule_id = _active_schedule_id
        if schedule_id is None:
            return
        _active_schedule_id = None

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if not sched:
            return

        now = datetime.now()
        sched.LastRunDate = now
        sched.RunCount = (sched.RunCount or 0) + 1

        mode = getattr(sched, 'ScheduleMode', None) or (
            "weekly" if sched.Repeat == "Y" else "once"
        )

        if mode == "once":
            sched.TaskStatus = "완료"
        elif mode in ("weekly", "interval"):
            should_continue = True

            # 시리즈 종료일 체크
            series_end = getattr(sched, 'SeriesEndDate', None)
            if not series_end and sched.Repeat_End:
                try:
                    series_end = datetime.strptime(str(sched.Repeat_End).strip(), "%Y-%m-%d").date()
                except ValueError:
                    pass
            if series_end and now.date() >= series_end:
                should_continue = False

            # MaxRunCount 체크
            if sched.MaxRunCount and sched.RunCount >= sched.MaxRunCount:
                should_continue = False

            sched.TaskStatus = "대기" if should_continue else "완료"

        db.commit()
        print(f"[SCHEDULER] 스케줄 #{schedule_id} 완료 → 상태: {sched.TaskStatus} (실행 {sched.RunCount}회)")
        import app.navigation.send_move as nav_mod
        route_summary = " → ".join(
            wp.get("name", f"WP{i+1}") for i, wp in enumerate(nav_mod.waypoints_list)
        ) if nav_mod.waypoints_list else ""
        log_event("schedule", "nav_complete",
                  f"스케줄 완료: {sched.WorkName} (실행 {sched.RunCount}회)",
                  detail=f"경로: {route_summary}" if route_summary else None,
                  robot_id=get_robot_id(), robot_name=get_robot_name())

    except Exception as e:
        print(f"[SCHEDULER ERR] 완료 처리 실패: {e}")
        db.rollback()
    finally:
        db.close()


def on_navigation_error(error_msg: str = ""):
    """네비게이션 오류 시 호출되는 콜백"""
    global _active_schedule_id

    with _lock:
        schedule_id = _active_schedule_id
        if schedule_id is None:
            return
        _active_schedule_id = None

    db = SessionLocal()
    try:
        sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
        if sched:
            sched.TaskStatus = "오류"
            sched.LastRunDate = datetime.now()
            db.commit()
            print(f"[SCHEDULER] 스케줄 #{schedule_id} 오류: {error_msg}")
    except Exception as e:
        print(f"[SCHEDULER ERR] 오류 처리 실패: {e}")
        db.rollback()
    finally:
        db.close()


# ─── 메인 루프 ───

def scheduler_thread():
    """메인 스케줄러 루프 — 30초마다 실행 조건 체크"""
    global _active_schedule_id

    print("[SCHEDULER] 스케줄러 엔진 시작")

    # 서버 시작 후 초기 대기 (DB 연결 안정화)
    time.sleep(5)

    while True:
        try:
            now = datetime.now()
            db = SessionLocal()

            try:
                # "대기" 상태 스케줄 조회
                schedules = (
                    db.query(ScheduleInfo)
                    .filter(ScheduleInfo.TaskStatus == "대기")
                    .order_by(ScheduleInfo.StartDate.asc())
                    .all()
                )

                for sched in schedules:
                    if _active_schedule_id is not None:
                        break  # 이미 실행 중인 스케줄이 있으면 스킵

                    if _should_run_now(sched, now):
                        with _lock:
                            _active_schedule_id = sched.id
                        if not _execute_schedule(sched):
                            with _lock:
                                _active_schedule_id = None

            finally:
                db.close()

        except Exception as e:
            print(f"[SCHEDULER ERR] 루프 오류: {e}")

        time.sleep(30)
