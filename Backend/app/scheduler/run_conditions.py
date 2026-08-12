"""스케줄 실행 조건 판정 (순수 함수).

각 모드(once/weekly/interval)에 대해 "지금 이 스케줄을 실행해야 하는가?"를
결정한다. 외부 부수효과 없이 ScheduleInfo와 현재 시각만으로 판단.
"""

from datetime import datetime, timedelta

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


def has_remaining_today(schedule: ScheduleInfo, now: datetime) -> bool:
    """오늘 안에 아직 실행되지 않은 회차가 남아 있는지 판정.

    on_navigation_complete에서 '오늘이 series_end 당일'인 경우 상태를
    "완료"로 전환할지 "대기"로 유지할지 결정하는 데 사용한다.

    - weekly: ExecutionTime 리스트에 현재 시:분 이후의 시각이 있는지
    - interval: now + IntervalMinutes 가 ActiveEndTime 내에 있는지
    - 자정 넘김(ActiveStart > ActiveEnd) interval: 보수적으로 True 반환
      (정확 판정이 복잡하므로 상태 전환을 미루는 쪽으로 안전)
    """
    mode = getattr(schedule, 'ScheduleMode', None) or (
        "weekly" if schedule.Repeat == "Y" else "once"
    )

    if mode == "weekly":
        exec_time = getattr(schedule, 'ExecutionTime', None)
        if not exec_time:
            # 레거시 폴백: StartDate 단일 시각만 존재 → 이미 실행됐으면 남은 회차 없음
            return False
        now_min = now.hour * 60 + now.minute
        for t in exec_time.split(","):
            try:
                h, m = t.strip().split(":")
                if int(h) * 60 + int(m) > now_min:
                    return True
            except ValueError:
                continue
        return False

    if mode == "interval":
        interval_min = getattr(schedule, 'IntervalMinutes', None)
        if not interval_min or interval_min <= 0:
            return False
        active_start_str = getattr(schedule, 'ActiveStartTime', None) or "00:00"
        active_end_str = getattr(schedule, 'ActiveEndTime', None) or "23:59"
        try:
            as_h, as_m = active_start_str.split(":")
            ae_h, ae_m = active_end_str.split(":")
            active_start_min = int(as_h) * 60 + int(as_m)
            active_end_min = int(ae_h) * 60 + int(ae_m)
        except ValueError:
            return False

        # 자정 넘김은 보수적으로 True (상태 잔존 허용, 실행 안전)
        if active_start_min > active_end_min:
            return True

        next_run_min = now.hour * 60 + now.minute + interval_min
        return next_run_min <= active_end_min

    # once는 이 함수 호출 대상 아님
    return False


def should_run_now(schedule: ScheduleInfo, now: datetime) -> bool:
    """스케줄이 지금 실행되어야 하는지 판단 (모드 디스패처).

    회차 단위 판정(due_planned_times)이 도입된 뒤로 스케줄러 루프는 이 함수를
    쓰지 않는다 — grace 를 모르는 '분 단위 정확 매칭'이라 놓친 회차를 복구할 수
    없기 때문(PRD §2.1 G1). 판정 결과를 단일 bool 로 알아야 하는 곳을 위해 남긴다.
    """
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


# ─── 회차(슬롯) 단위 판정 — PRD-Schedule-Execution §2.1 G1 ───

def _mode_of(schedule: ScheduleInfo) -> str:
    return getattr(schedule, 'ScheduleMode', None) or (
        "weekly" if schedule.Repeat == "Y" else "once"
    )


def _parse_hm(value: str | None, fallback: str) -> int | None:
    """'HH:MM' → 분. 파싱 실패 시 fallback 으로 재시도, 그것도 실패면 None."""
    for v in (value, fallback):
        if not v:
            continue
        try:
            h, m = v.split(":")
            return int(h) * 60 + int(m)
        except (ValueError, AttributeError):
            continue
    return None


def _series_gates_ok(schedule: ScheduleInfo, day) -> bool:
    """반복 시리즈 공통 게이트 — 날짜 범위 · 예외일 · 요일 · 실행 상한."""
    series_start = getattr(schedule, 'SeriesStartDate', None)
    if series_start and day < series_start:
        return False

    series_end = getattr(schedule, 'SeriesEndDate', None)
    if not series_end and schedule.Repeat_End:
        try:
            series_end = datetime.strptime(str(schedule.Repeat_End).strip(), "%Y-%m-%d").date()
        except ValueError:
            pass
    if series_end and day > series_end:
        return False

    exceptions = getattr(schedule, 'SeriesExceptions', None)
    if exceptions:
        if day.strftime("%Y-%m-%d") in {d.strip() for d in exceptions.split(",") if d.strip()}:
            return False

    if schedule.MaxRunCount and (schedule.RunCount or 0) >= schedule.MaxRunCount:
        return False

    if schedule.Repeat_Day:
        allowed = [d.strip() for d in schedule.Repeat_Day.split(",")]
        if DAY_MAP.get(day.weekday()) not in allowed:
            return False

    return True


def planned_times(schedule: ScheduleInfo, now: datetime) -> list[datetime]:
    """이 스케줄이 '지금 시점에 관심 있는' 예정 시각 목록(오름차순).

    반환값은 실행 여부가 아니라 **회차 후보**다. 실제 실행/미실행 판정은
    ScheduleRun 기록과 grace 를 함께 보는 호출부(loop)가 한다.
    """
    mode = _mode_of(schedule)
    today = now.date()

    # 상시 대기는 '예정 시각에 출발'이 아니라 '시간대 안에 대기'라 회차 후보가 없다.
    # 진입/종료는 standby_window() 로 판정하며, 여기서 슬롯을 내보내면 매일 미실행으로 잡힌다.
    if mode == "standby":
        return []

    if mode == "once":
        start_dt = schedule.StartDate
        if not start_dt:
            return []
        if (schedule.RunCount or 0) > 0:
            return []   # 레거시 방어: ScheduleRun 도입 전에 이미 실행된 단일 작업
        return [start_dt]

    if not _series_gates_ok(schedule, today):
        return []

    last_run = schedule.LastRunDate
    slots: list[datetime] = []

    if mode == "weekly":
        exec_time = getattr(schedule, 'ExecutionTime', None)
        if exec_time:
            raw = [t.strip() for t in exec_time.split(",") if t.strip()]
        elif schedule.StartDate:
            raw = [f"{schedule.StartDate.hour:02d}:{schedule.StartDate.minute:02d}"]
        else:
            raw = []
        for t in raw:
            minutes = _parse_hm(t, "")
            if minutes is None:
                continue
            slots.append(datetime.combine(today, datetime.min.time()) + timedelta(minutes=minutes))

    elif mode == "interval":
        interval_min = getattr(schedule, 'IntervalMinutes', None)
        if not interval_min or interval_min <= 0:
            return []
        start_min = _parse_hm(getattr(schedule, 'ActiveStartTime', None), "00:00")
        end_min = _parse_hm(getattr(schedule, 'ActiveEndTime', None), "23:59")
        if start_min is None or end_min is None:
            return []

        # 활동 시간대 시작을 기준점으로 한 고정 그리드.
        # LastRunDate 체이닝과 달리 예정 시각이 결정적이라 (ScheduleId, PlannedAt)
        # 유니크 키로 중복 실행을 막을 수 있다.
        base_day = today
        span = end_min - start_min
        if span < 0:
            # 자정 넘김(22:00~06:00): 지금이 종료 시각 이전이면 어제 시작한 창이다
            span += 24 * 60
            if now.hour * 60 + now.minute <= end_min:
                base_day = today - timedelta(days=1)
                if not _series_gates_ok(schedule, base_day):
                    return []
        anchor = datetime.combine(base_day, datetime.min.time()) + timedelta(minutes=start_min)
        offset = 0
        while offset <= span:
            slots.append(anchor + timedelta(minutes=offset))
            offset += interval_min

    # 레거시 브리지: ScheduleRun 이 없던 시절 이미 돈 회차를 다시 실행하지 않는다
    if last_run:
        slots = [s for s in slots if s > last_run]

    return sorted(slots)


def standby_window(schedule: ScheduleInfo, now: datetime) -> tuple[datetime, datetime] | None:
    """상시 대기 운영 시간대 — now 가 포함된 창을 (시작, 종료)로 돌려준다.

    반환값이 있으면 "지금 대기 근무 중이어야 한다"는 뜻이다. 요일·유효기간·예외일
    게이트를 통과하지 못하거나 시간대 밖이면 None.
    """
    if _mode_of(schedule) != "standby":
        return None

    start_min = _parse_hm(getattr(schedule, 'ActiveStartTime', None), "00:00")
    end_min = _parse_hm(getattr(schedule, 'ActiveEndTime', None), "23:59")
    if start_min is None or end_min is None:
        return None

    now_min = now.hour * 60 + now.minute
    base_day = now.date()

    if start_min <= end_min:
        if not (start_min <= now_min < end_min):
            return None
    else:
        # 자정 넘김(22:00~06:00): 종료 시각 이전이면 어제 시작한 창이다
        if now_min < start_min and now_min >= end_min:
            return None
        if now_min < end_min:
            base_day = base_day - timedelta(days=1)

    # 요일·기간 게이트는 '창이 시작된 날' 기준으로 본다
    if not _series_gates_ok(schedule, base_day):
        return None

    begin = datetime.combine(base_day, datetime.min.time()) + timedelta(minutes=start_min)
    end = datetime.combine(base_day, datetime.min.time()) + timedelta(minutes=end_min)
    if end <= begin:
        end += timedelta(days=1)
    return begin, end


def due_planned_times(schedule: ScheduleInfo, now: datetime, grace_min: int) -> list[datetime]:
    """지금 실행해야 하는 회차 — 예정시각 ≤ now < 예정시각 + grace."""
    limit = timedelta(minutes=grace_min)
    return [p for p in planned_times(schedule, now) if p <= now < p + limit]


def expired_planned_times(schedule: ScheduleInfo, now: datetime, grace_min: int,
                          since: datetime | None = None) -> list[datetime]:
    """grace 를 넘겨 실행 기회를 잃은 회차 — 미실행(missed)으로 기록할 대상.

    since 는 스케줄러가 관측을 시작한 시각. 그 이전 회차는 애초에 볼 수 없었으므로
    미실행으로 단정하지 않는다(서버 재시작 직후 과거 회차가 무더기로 잡히는 것 방지).
    """
    limit = timedelta(minutes=grace_min)
    out = []
    for p in planned_times(schedule, now):
        if now >= p + limit and (since is None or p >= since):
            out.append(p)
    return out


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
