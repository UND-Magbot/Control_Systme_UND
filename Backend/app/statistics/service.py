import logging
import time as _time
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy import func

from sqlalchemy import or_, and_

from app.database.models import RobotInfo, LogDataInfo, ScheduleInfo
from app.statistics.schemas import (
    StatisticsResponse, RobotTypeCount, TaskCounts,
    TimeMinutes, ErrorCounts, PerRobotStats,
)

logger = logging.getLogger(__name__)

# Python weekday() → 한국어 요일 (run_conditions.py 와 동일)
DAY_MAP = {0: "월", 1: "화", 2: "수", 3: "목", 4: "금", 5: "토", 6: "일"}

# ── 에러 Action → 카테고리 매핑 ──
ERROR_ACTION_MAP = {
    "network":    ["robot_connection_error", "rtsp_error"],
    "navigation": ["nav_error", "nav_poll_timeout"],
    "battery":    ["robot_battery_low"],
    "etc":        ["position_recv_error", "remote_send_error",
                   "db_operation_error", "robot_error_code"],
}
ALL_ERROR_ACTIONS = [a for actions in ERROR_ACTION_MAP.values() for a in actions]

# ── 스케줄 TaskStatus → 통계 필드 매핑 ──
TASK_STATUS_MAP = {
    "완료":     "completed",
    "오류":     "failed",
    "작업중(오류)": "failed",
    "취소":     "cancelled",
}


def _get_schedule_mode(schedule: ScheduleInfo) -> str:
    """스케줄 모드 반환 (legacy Repeat='Y' 호환)."""
    return getattr(schedule, 'ScheduleMode', None) or (
        "weekly" if schedule.Repeat == "Y" else "once"
    )


def _count_today_tasks(schedule: ScheduleInfo, target_date) -> int:
    """스케줄이 target_date에 해당하면 1, 아니면 0 (등록 작업 1건 = 1 카운트)."""
    mode = _get_schedule_mode(schedule)

    if mode == "once":
        # once 는 StartDate 날짜에만 해당
        if schedule.StartDate and schedule.StartDate.date() == target_date:
            return 1
        return 0

    if mode == "weekly":
        # 시리즈 범위 확인
        series_start = getattr(schedule, 'SeriesStartDate', None)
        series_end = getattr(schedule, 'SeriesEndDate', None)
        if series_start and target_date < series_start:
            return 0
        if series_end and target_date > series_end:
            return 0
        # 요일 확인
        repeat_day = getattr(schedule, 'Repeat_Day', None) or ""
        if repeat_day:
            today_name = DAY_MAP.get(target_date.weekday())
            allowed_days = [d.strip() for d in repeat_day.split(",") if d.strip()]
            if today_name not in allowed_days:
                return 0
        return 1

    if mode == "interval":
        # 시리즈 범위 확인
        series_start = getattr(schedule, 'SeriesStartDate', None)
        series_end = getattr(schedule, 'SeriesEndDate', None)
        if series_start and target_date < series_start:
            return 0
        if series_end and target_date > series_end:
            return 0
        # 요일 확인
        repeat_day = getattr(schedule, 'Repeat_Day', None) or ""
        if repeat_day:
            today_name = DAY_MAP.get(target_date.weekday())
            allowed_days = [d.strip() for d in repeat_day.split(",") if d.strip()]
            if today_name not in allowed_days:
                return 0
        return 1

    # 알 수 없는 모드
    return 1


def _count_completed_today(schedule: ScheduleInfo, target_date, now: datetime) -> int:
    """스케줄이 target_date에 완료 상태이면 1, 아니면 0."""
    if schedule.TaskStatus == "완료":
        return 1
    return 0


def _pair_events(
    logs,
    start_actions: str | set[str],
    end_actions: set[str],
    dt_end: datetime | None = None,
) -> dict[str, float]:
    """로봇별로 start/end 이벤트를 쌍으로 매칭하여 총 시간(분) 반환.
    미완료(open) 이벤트는 dt_end 또는 현재 시각까지로 계산 (24h 캡)."""
    if isinstance(start_actions, str):
        start_actions = {start_actions}
    pending: dict[str, datetime] = {}
    totals: dict[str, float] = {}

    for log in sorted(logs, key=lambda l: l.CreatedAt):
        if log.Action in start_actions:
            pending[log.RobotName] = log.CreatedAt
        elif log.Action in end_actions and log.RobotName in pending:
            start = pending.pop(log.RobotName)
            delta_min = (log.CreatedAt - start).total_seconds() / 60
            if delta_min > 0:
                totals[log.RobotName] = totals.get(log.RobotName, 0) + delta_min

    # 미완료 이벤트 처리 (현재 진행 중인 작업/충전)
    cap = dt_end if dt_end else datetime.now()
    for robot_name, start in pending.items():
        delta_min = (cap - start).total_seconds() / 60
        if 0 < delta_min <= 24 * 60:  # 24시간 초과 → end 이벤트 누락으로 판단, 스킵
            totals[robot_name] = totals.get(robot_name, 0) + delta_min

    return totals


class StatisticsService:
    def __init__(self, db: Session):
        self.db = db

    def get_earliest_date(self) -> dict:
        """가장 이른 데이터 날짜 반환 (로그 + 스케줄 모두 고려)"""
        min_log = self.db.query(func.min(LogDataInfo.CreatedAt)).scalar()
        min_sched = self.db.query(func.min(ScheduleInfo.StartDate)).scalar()

        candidates = [d for d in (min_log, min_sched) if d is not None]
        min_dt = min(candidates) if candidates else None
        return {"earliest_date": min_dt.strftime("%Y-%m-%d") if min_dt else None}

    def get_all(
        self,
        start_date: str | None = None,
        end_date: str | None = None,
        robot_type: str | None = None,
        robot_name: str | None = None,
        biz_robot_names: list[str] | None = None,
    ) -> StatisticsResponse:
        t0 = _time.monotonic()

        try:
            return self._build_statistics(start_date, end_date, robot_type, robot_name, biz_robot_names)
        except SQLAlchemyError as e:
            logger.error("통계 조회 DB 오류: %s", e, exc_info=True)
            raise HTTPException(500, "통계 조회 실패")
        finally:
            elapsed = _time.monotonic() - t0
            logger.info("Statistics query completed in %.2fs", elapsed)

    def _build_statistics(
        self,
        start_date: str | None,
        end_date: str | None,
        robot_type: str | None,
        robot_name: str | None,
        biz_robot_names: list[str] | None = None,
    ) -> StatisticsResponse:

        # ── 날짜 파싱 (미지정 시 당일 기준) ──
        now = datetime.now()
        dt_start = (
            datetime.strptime(start_date, "%Y-%m-%d")
            if start_date
            else now.replace(hour=0, minute=0, second=0, microsecond=0)
        )
        dt_end = (
            datetime.strptime(end_date, "%Y-%m-%d") + timedelta(hours=23, minutes=59, seconds=59)
            if end_date
            else now
        )
        # 종료일이 미래(오늘 포함)인 경우 현재 시각으로 캡 (로그 조회용)
        if dt_end > now:
            dt_end = now

        # 스케줄 총 작업수 산출용: 오늘 끝까지 (미래 작업 포함)
        dt_end_scheds = (
            datetime.strptime(end_date, "%Y-%m-%d") + timedelta(hours=23, minutes=59, seconds=59)
            if end_date
            else now.replace(hour=23, minute=59, second=59, microsecond=999999)
        )

        # ── 1) 로봇 타입 분포 (날짜 무관) ──
        robot_query = self.db.query(RobotInfo).filter(RobotInfo.DeletedAt.is_(None))
        if biz_robot_names is not None:
            robot_query = robot_query.filter(RobotInfo.RobotName.in_(biz_robot_names))
        all_robots = robot_query.all()

        # 필터 적용된 로봇 목록
        filtered_robots = all_robots
        if robot_name:
            filtered_robots = [r for r in all_robots if r.RobotName == robot_name]
        elif robot_type:
            filtered_robots = [r for r in all_robots if r.RobotType == robot_type]

        filtered_robot_names = {r.RobotName for r in filtered_robots}

        # 로봇 타입 카운트 (필터 적용된 로봇 기준)
        type_counts: dict[str, int] = {}
        for r in filtered_robots:
            t = r.RobotType or "UNKNOWN"
            type_counts[t] = type_counts.get(t, 0) + 1

        robot_types = [RobotTypeCount(type=t, count=c) for t, c in type_counts.items()]

        # ── 2) 로그 조회 (날짜 + 로봇 필터) ──
        if not filtered_robots:
            all_logs = []
        else:
            log_query = self.db.query(LogDataInfo)
            log_query = log_query.filter(LogDataInfo.CreatedAt >= dt_start)
            log_query = log_query.filter(LogDataInfo.CreatedAt <= dt_end)
            if len(filtered_robot_names) < len(all_robots):
                log_query = log_query.filter(LogDataInfo.RobotName.in_(filtered_robot_names))
            all_logs = log_query.all()

        # ── 3) 작업 건수 ──
        nav_complete_logs = [l for l in all_logs if l.Action == "nav_complete"]

        # 기간 내 스케줄 조회 (작업 상태 집계 + 총 작업 수 산출)
        if not filtered_robots:
            schedules = []
        else:
            sched_query = self.db.query(ScheduleInfo).filter(
                or_(
                    # once: StartDate 가 조회 범위 내
                    and_(
                        or_(ScheduleInfo.ScheduleMode == "once",
                            ScheduleInfo.ScheduleMode.is_(None)),
                        ScheduleInfo.StartDate <= dt_end_scheds,
                        ScheduleInfo.EndDate >= dt_start,
                    ),
                    # weekly / interval: 시리즈 범위가 조회 범위와 겹침
                    and_(
                        ScheduleInfo.ScheduleMode.in_(["weekly", "interval"]),
                        or_(ScheduleInfo.SeriesStartDate.is_(None),
                            ScheduleInfo.SeriesStartDate <= dt_end_scheds.date()),
                        or_(ScheduleInfo.SeriesEndDate.is_(None),
                            ScheduleInfo.SeriesEndDate >= dt_start.date()),
                    ),
                )
            )
            if len(filtered_robot_names) < len(all_robots):
                sched_query = sched_query.filter(ScheduleInfo.RobotName.in_(filtered_robot_names))
            schedules = sched_query.all()

        # 스케줄을 로봇별로 그룹핑 + StartDate 역순 정렬 (성능 개선)
        sched_by_robot: dict[str, list] = defaultdict(list)
        for s in schedules:
            sched_by_robot[s.RobotName].append(s)
        for robot_scheds in sched_by_robot.values():
            robot_scheds.sort(key=lambda s: s.StartDate or datetime.min, reverse=True)

        task_counts = {"completed": 0, "failed": 0, "cancelled": 0}

        for sched in schedules:
            mapped = TASK_STATUS_MAP.get(sched.TaskStatus)
            if mapped:
                task_counts[mapped] += 1

        tasks = TaskCounts(**task_counts)

        # ── 4) 시간 통계 (온라인 시간 기준) ──
        time_actions = {"nav_start", "path_move_start", "place_move_start",
                        "nav_complete", "nav_error",
                        "robot_charging_start", "robot_charging_complete",
                        "robot_online", "robot_offline"}
        time_logs = [l for l in all_logs if l.Action in time_actions]

        operating_by_robot = _pair_events(
            time_logs,
            {"nav_start", "path_move_start", "place_move_start"},
            {"nav_complete", "nav_error"},
            dt_end,
        )
        charging_by_robot = _pair_events(time_logs, "robot_charging_start", {"robot_charging_complete"}, dt_end)
        online_by_robot = _pair_events(time_logs, "robot_online", {"robot_offline"}, dt_end)

        if not filtered_robots:
            total_operating = 0
            total_charging = 0
            total_standby = 0
        else:
            total_operating = int(sum(operating_by_robot.values()))
            total_charging = int(sum(charging_by_robot.values()))
            total_online = int(sum(online_by_robot.values()))
            # 대기 = 전체 온라인 시간 합계 - 운행 - 충전
            total_standby = max(0, total_online - total_operating - total_charging)

        time_minutes = TimeMinutes(
            operating=total_operating,
            charging=total_charging,
            standby=total_standby,
        )

        # ── 5) 에러 통계 ──
        error_logs = [l for l in all_logs if l.Action in ALL_ERROR_ACTIONS]
        error_action_counts: dict[str, int] = {}
        for l in error_logs:
            error_action_counts[l.Action] = error_action_counts.get(l.Action, 0) + 1

        errors = ErrorCounts(
            network=sum(error_action_counts.get(a, 0) for a in ERROR_ACTION_MAP["network"]),
            navigation=sum(error_action_counts.get(a, 0) for a in ERROR_ACTION_MAP["navigation"]),
            battery=sum(error_action_counts.get(a, 0) for a in ERROR_ACTION_MAP["battery"]),
            etc=sum(error_action_counts.get(a, 0) for a in ERROR_ACTION_MAP["etc"]),
        )

        # ── 6) 로봇별 개별 통계 (per_robot) ──
        per_robot: list[PerRobotStats] = []

        # 로봇별 에러 카운트
        error_by_robot: dict[str, int] = {}
        for l in error_logs:
            error_by_robot[l.RobotName] = error_by_robot.get(l.RobotName, 0) + 1

        # 로봇별 작업 완료/전체 (스케줄 모드별 실제 작업 건수 기준)
        target_date = dt_start.date()
        completed_by_robot: dict[str, int] = {}
        total_by_robot: dict[str, int] = {}
        for s in schedules:
            today_count = _count_today_tasks(s, target_date)
            if today_count <= 0:
                continue
            # 취소 포함 모든 상태를 total 에 반영
            total_by_robot[s.RobotName] = total_by_robot.get(s.RobotName, 0) + today_count
            # 완료 건수
            done_count = _count_completed_today(s, target_date, now)
            if done_count > 0:
                completed_by_robot[s.RobotName] = (
                    completed_by_robot.get(s.RobotName, 0) + done_count
                )

        for robot in filtered_robots:
            rname = robot.RobotName
            op_min = int(operating_by_robot.get(rname, 0))
            ch_min = int(charging_by_robot.get(rname, 0))
            online_min = int(online_by_robot.get(rname, 0))
            sb_min = max(0, online_min - op_min - ch_min)

            per_robot.append(PerRobotStats(
                robot_id=robot.id,
                robot_name=rname,
                robot_type=robot.RobotType or "UNKNOWN",
                tasks_completed=completed_by_robot.get(rname, 0),
                tasks_total=total_by_robot.get(rname, 0),
                errors_total=error_by_robot.get(rname, 0),
                operating_minutes=op_min,
                charging_minutes=ch_min,
                standby_minutes=sb_min,
            ))

        return StatisticsResponse(
            robot_types=robot_types,
            tasks=tasks,
            time_minutes=time_minutes,
            errors=errors,
            per_robot=per_robot,
        )

