"""스케줄 실행 조건 판정 (순수 함수).

각 모드(once/weekly/interval)에 대해 "지금 이 스케줄을 실행해야 하는가?"를
결정한다. 외부 부수효과 없이 ScheduleInfo와 현재 시각만으로 판단.
"""

from datetime import datetime

from app.database.models import ScheduleInfo

# 요일 매핑: Repeat_Day는 "월,화,수" 형태
DAY_MAP = {0: "월", 1: "화", 2: "수", 3: "목", 4: "금", 5: "토", 6: "일"}


def _is_exception_date(schedule: ScheduleInfo, now: datetime) -> bool:
    """SeriesExceptions에 등록된 날짜면 True (this 범위 수정으로 이날은 스킵)."""
    exceptions = getattr(schedule, 'SeriesExceptions', None)
    if not exceptions:
        return False
    today_str = now.strftime("%Y-%m-%d")
    return today_str in {d.strip() for d in exceptions.split(",") if d.strip()}


def should_run_now(schedule: ScheduleInfo, now: datetime) -> bool:
    """스케줄이 지금 실행되어야 하는지 판단 (모드 디스패처)."""
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
    """단일 실행: StartDate 전후 1분 이내에만 1회 실행."""
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
    """요일 반복: 지정 요일 + 시:분 매칭."""

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

    # 예외 날짜 체크 (this 범위 수정으로 스킵된 날짜)
    if _is_exception_date(schedule, now):
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
    """주기 반복: 활동 시간대 내 N분마다."""

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

    # 예외 날짜 체크
    if _is_exception_date(schedule, now):
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
