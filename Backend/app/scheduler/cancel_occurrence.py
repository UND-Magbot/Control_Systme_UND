"""작업 회차 취소 — "이 회차만 실행하지 않는다".

**삭제와 다르다.** 삭제는 일정 자체를 없애고, 취소는 **일정은 남기되 이번 회차만**
건너뛴다. 반복 작업이면 다음 회차는 그대로 실행된다.

| 상태 | 취소하면 |
|---|---|
| 대기 | 이 회차를 실행하지 않는다(아래 규칙) |
| 진행중 | 로봇을 세우고 중단한다 — 라우트에서 기존 정지 경로를 재사용 |
| 완료·취소 | 취소할 게 없다 → 409 |

**단일(once):** 원본 row 의 `TaskStatus` 를 '취소'로 바꾼다.

**반복(weekly/interval):** 원본은 '대기'로 두고 해당 날짜를 `SeriesExceptions` 에 추가한
뒤, 같은 `SeriesGroupId` 로 **그날 하루짜리 '취소' row** 를 만든다. 달력에 그날만
취소로 보이고 나머지 회차는 영향이 없다.

> 이 규칙은 `loop.cancel_active_schedule()` 과 같다. 그쪽은 **진행 중인 것**을
> 전역 상태에서 찾아 처리하고(`ScheduleRun` 마감까지 포함), 이 모듈은 **id·날짜를
> 지정해** 아직 시작하지 않은 회차를 처리한다. 대기 상태에는 마감할 `ScheduleRun` 이
> 아직 없다. 진입점이 달라 합치지 않았다 — 정지·복귀 경로를 건드려 회귀를 만들 위험이
> 이득보다 크다. **규칙을 바꿀 때는 두 곳을 함께 고쳐야 한다.**
"""
from __future__ import annotations

from datetime import date, datetime

from app.database.models import ScheduleInfo

CANCELLABLE = ("대기", "진행중")


class CancelError(Exception):
    """취소할 수 없는 상태 — 라우트에서 409 로 변환한다."""


def _mode_of(sched: ScheduleInfo) -> str:
    return getattr(sched, "ScheduleMode", None) or ("weekly" if sched.Repeat == "Y" else "once")


def cancel_occurrence(db, sched: ScheduleInfo, target_date: date | None = None) -> dict:
    """대기 중인 회차를 취소한다. 커밋은 호출자가 한다.

    Returns: {"mode", "scope", "date"} — 로그·응답용 요약
    """
    if sched.TaskStatus not in CANCELLABLE:
        raise CancelError(f"'{sched.TaskStatus}' 상태의 작업은 취소할 수 없습니다.")

    mode = _mode_of(sched)
    if mode == "once":
        sched.TaskStatus = "취소"
        return {"mode": mode, "scope": "single", "date": None}

    day = target_date or date.today()
    # 지난 회차는 취소할 게 없다. 예외로 넣어도 그날은 이미 지났고,
    # 달력에는 하루짜리 '취소' row 만 새로 생겨 이력을 어지럽힌다.
    if day < date.today():
        raise CancelError("이미 지난 회차는 취소할 수 없습니다.")

    day_str = day.strftime("%Y-%m-%d")

    existing = set()
    if sched.SeriesExceptions:
        existing = {d.strip() for d in sched.SeriesExceptions.split(",") if d.strip()}
    if day_str in existing:
        raise CancelError("이미 취소된 회차입니다.")
    existing.add(day_str)
    sched.SeriesExceptions = ",".join(sorted(existing))
    sched.TaskStatus = "대기"          # 원본은 계속 살아 있다(다음 회차는 실행된다)

    # 달력에 '그날만 취소'로 보이도록 하루짜리 row 를 만든다. 같은 SeriesGroupId 를
    # 공유해야 프론트가 같은 시리즈로 묶어 본다.
    start_dt = sched.StartDate
    hour = start_dt.hour if start_dt else 0
    minute = start_dt.minute if start_dt else 0
    day_dt = datetime.combine(day, datetime.min.time().replace(hour=hour, minute=minute))
    db.add(ScheduleInfo(
        UserId=sched.UserId,
        RobotName=sched.RobotName,
        WorkName=sched.WorkName,
        TaskType=sched.TaskType,
        WayName=sched.WayName,
        TaskStatus="취소",
        ScheduleMode=mode,
        StartDate=day_dt,
        EndDate=day_dt,
        Repeat=sched.Repeat,
        Repeat_Day=sched.Repeat_Day,
        Repeat_End=day_str,
        ExecutionTime=sched.ExecutionTime,
        IntervalMinutes=sched.IntervalMinutes,
        ActiveStartTime=sched.ActiveStartTime,
        ActiveEndTime=sched.ActiveEndTime,
        SeriesStartDate=day,
        SeriesEndDate=day,
        SeriesExceptions=None,
        SeriesGroupId=sched.SeriesGroupId,
        RunCount=1,
        MaxRunCount=None,
    ))
    return {"mode": mode, "scope": "occurrence", "date": day_str}
