import re

from fastapi import Body, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator, model_validator
from datetime import datetime, date, time, timedelta


_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _validate_hhmm(value: str | None, field_name: str) -> str | None:
    """'HH:MM' 24시간 형식 검증. None/빈 문자열은 None으로 정규화."""
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    if not _TIME_RE.match(v):
        raise ValueError(f"{field_name}은 'HH:MM' 24시간 형식이어야 합니다: {value!r}")
    return v


_KOR_DAY_TO_INT = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}


def _first_execution_date(sched) -> date | None:
    """시리즈(또는 단일) 스케줄의 첫 실제 실행일 계산.

    - once: StartDate의 날짜
    - weekly: SeriesStartDate 이후 Repeat_Day 에 매칭되는 첫 날짜
    - interval: Repeat_Day 있으면 weekly와 동일, 없으면 SeriesStartDate (매일 실행)

    반환값이 None이면 계산 불가 (필드 불완전). target_date 비교에서 "더 크다" 판정에 쓰임.
    """
    mode = getattr(sched, "ScheduleMode", None) or (
        "weekly" if sched.Repeat == "Y" else "once"
    )

    if mode == "once":
        return sched.StartDate.date() if sched.StartDate else None

    start = sched.SeriesStartDate
    if not start:
        return None

    repeat_day_str = sched.Repeat_Day
    if not repeat_day_str:
        # interval without Repeat_Day → 매일 실행
        return start

    allowed: set[int] = set()
    for d in repeat_day_str.split(","):
        idx = _KOR_DAY_TO_INT.get(d.strip())
        if idx is not None:
            allowed.add(idx)
    if not allowed:
        return None

    for i in range(7):
        candidate = start + timedelta(days=i)
        if candidate.weekday() in allowed:
            return candidate
    return None


def _validate_interval_range(
    active_start: str | None,
    active_end: str | None,
    interval_min: int | None,
) -> None:
    """interval 모드의 활동 시간대와 간격이 모순되지 않는지 검증. 400 발생 가능."""
    if not interval_min or interval_min <= 0 or not active_start or not active_end:
        return
    try:
        as_h, as_m = active_start.split(":")
        ae_h, ae_m = active_end.split(":")
        start_min = int(as_h) * 60 + int(as_m)
        end_min = int(ae_h) * 60 + int(ae_m)
    except ValueError:
        return  # Pydantic validator가 이미 걸러냈어야 함
    # 자정 넘김(wrap)은 24시간 기준으로 계산
    span_min = (end_min - start_min) if end_min >= start_min else (1440 - start_min + end_min)
    if span_min < interval_min:
        raise HTTPException(
            status_code=400,
            detail=(
                f"활동 시간대({active_start}~{active_end})가 반복 간격({interval_min}분)보다 "
                f"짧습니다. 시간대를 {interval_min}분 이상으로 설정하거나 간격을 줄여주세요."
            ),
        )


def _validate_exec_time(value: str | None) -> str | None:
    """ExecutionTime: 콤마 구분 시각 목록. 각 항목 검증 + 중복 제거 + 정렬."""
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    times: set[str] = set()
    for part in v.split(","):
        t = part.strip()
        if not t:
            continue
        if not _TIME_RE.match(t):
            raise ValueError(f"ExecutionTime에 잘못된 시각이 포함됨: {t!r}")
        times.add(t)
    if not times:
        return None
    if len(times) > 24:
        raise ValueError(f"ExecutionTime 시각은 최대 24개까지 허용됩니다 (현재 {len(times)}개)")
    return ",".join(sorted(times))

from app.database.models import (
    ScheduleInfo, UserInfo, RobotInfo, RobotModule, ModuleVoiceInfo, VoiceSlotValue,
)
from app.auth.dependencies import require_permission, is_admin, get_business_robot_names
from app.auth.audit import write_audit, get_client_ip

from app.database.routes import database, get_db


class ScheduleInsertReq(BaseModel):
    RobotName: str
    TaskName: str
    TaskType: str
    WayName: str | None = None              # standby 는 경로가 아니라 대기 장소로 움직인다
    WorkStatus: str

    ScheduleMode: str = "once"              # "once" | "weekly" | "interval" | "standby"

    # once 모드
    StartTime: datetime | None = None       # 실행 일시

    # weekly 모드
    ExecutionTime: str | None = None        # "HH:MM" 또는 "HH:MM,HH:MM,..."
    RepeatDays: str | None = None           # "월,수,금"

    # interval 모드
    ActiveStartTime: str | None = None      # "HH:MM"
    ActiveEndTime: str | None = None        # "HH:MM"
    IntervalMinutes: int | None = None      # 반복 간격(분)

    # weekly + interval 공통
    SeriesStartDate: str | None = None      # "YYYY-MM-DD"
    SeriesEndDate: str | None = None        # "YYYY-MM-DD" or null

    # standby 모드 — 운영 시간대·요일·유효기간은 interval 필드를 그대로 쓴다
    ReturnPlaceId: int | None = None            # 대기 장소 (미지정 시 충전소)
    StandbyTrigger: str | None = None           # "mic" | "button"
    StandbyDestinations: str | None = None      # 허용 목적지 id 콤마 목록 (null=전체)
    StandbyMaxSessionMin: int | None = None
    StandbyRetryCount: int | None = None
    StandbyRetryWindowSec: int | None = None

    @field_validator("ExecutionTime")
    @classmethod
    def _v_execution_time(cls, v):
        return _validate_exec_time(v)

    @field_validator("ActiveStartTime")
    @classmethod
    def _v_active_start(cls, v):
        return _validate_hhmm(v, "ActiveStartTime")

    @field_validator("ActiveEndTime")
    @classmethod
    def _v_active_end(cls, v):
        return _validate_hhmm(v, "ActiveEndTime")

    @model_validator(mode="after")
    def _v_mode_required_fields(self):
        """모드별 필수 필드 검증.
        - once: StartTime
        - weekly: ExecutionTime, RepeatDays, SeriesStartDate (SeriesEndDate는 선택)
        - interval: ActiveStartTime, ActiveEndTime, IntervalMinutes, SeriesStartDate (RepeatDays는 선택=매일)
        """
        mode = self.ScheduleMode or "once"

        def _nonempty(v):
            return v is not None and (not isinstance(v, str) or v.strip())

        if mode == "once":
            if not _nonempty(self.StartTime):
                raise ValueError("once 모드는 StartTime이 필수입니다.")
        elif mode == "weekly":
            missing = []
            if not _nonempty(self.ExecutionTime):
                missing.append("ExecutionTime")
            if not _nonempty(self.RepeatDays):
                missing.append("RepeatDays")
            if not _nonempty(self.SeriesStartDate):
                missing.append("SeriesStartDate")
            if missing:
                raise ValueError(f"weekly 모드는 다음 필드가 필수입니다: {', '.join(missing)}")
        elif mode == "interval":
            missing = []
            if not _nonempty(self.ActiveStartTime):
                missing.append("ActiveStartTime")
            if not _nonempty(self.ActiveEndTime):
                missing.append("ActiveEndTime")
            if self.IntervalMinutes is None or self.IntervalMinutes <= 0:
                missing.append("IntervalMinutes(>0)")
            if not _nonempty(self.SeriesStartDate):
                missing.append("SeriesStartDate")
            if missing:
                raise ValueError(f"interval 모드는 다음 필드가 필수입니다: {', '.join(missing)}")
        elif mode == "standby":
            missing = []
            if not _nonempty(self.ActiveStartTime):
                missing.append("ActiveStartTime")
            if not _nonempty(self.ActiveEndTime):
                missing.append("ActiveEndTime")
            if not _nonempty(self.SeriesStartDate):
                missing.append("SeriesStartDate")
            if missing:
                raise ValueError(f"상시 대기 모드는 다음 필드가 필수입니다: {', '.join(missing)}")
            if self.StandbyTrigger not in ("mic", "button"):
                # 호출 방식을 명시 필드로 못박아야 "마이크로 등록했는데 실제로는 버튼"이
                # 구조적으로 불가능해진다 (PRD §3.6).
                raise ValueError("상시 대기 모드는 StandbyTrigger('mic' 또는 'button')가 필수입니다.")
        else:
            raise ValueError(f"지원하지 않는 ScheduleMode: {mode}")

        # standby 를 제외한 모드는 경로가 있어야 실행할 수 있다
        if mode != "standby" and not _nonempty(self.WayName):
            raise ValueError(f"{mode} 모드는 WayName이 필수입니다.")

        return self


def _check_schedule_conflict(
    db: Session,
    robot_name: str,
    mode: str,
    req,
    exclude_id: int | None = None,
    exclude_ids: set[int] | None = None,
):
    """
    같은 로봇에 시간이 겹치는 스케줄이 있는지 검사. 충돌 시 HTTPException 발생.

    차단 대상 (interval 활성 시간대 충돌만):
    - interval 시간대 안에 once/weekly 시각이 포함되는 경우
    - interval 시간대끼리 겹치는 경우
    once↔once, once↔weekly, weekly↔weekly 는 스케줄러가 런타임에 직렬 처리하므로 차단하지 않음.
    """

    def _parse_hm(s: str) -> int:
        h, m = s.strip().split(":")
        return int(h) * 60 + int(m)

    def _point_in_range(point: int, rng: tuple[int, int]) -> bool:
        return rng[0] <= point < rng[1]

    def _ranges_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
        return a[0] < b[1] and b[0] < a[1]

    q = db.query(ScheduleInfo).filter(
        ScheduleInfo.RobotName == robot_name,
        ScheduleInfo.TaskStatus.in_(["대기", "진행중"]),
    )
    ids_to_exclude: set[int] = set(exclude_ids) if exclude_ids else set()
    if exclude_id is not None:
        ids_to_exclude.add(exclude_id)
    if ids_to_exclude:
        q = q.filter(~ScheduleInfo.id.in_(ids_to_exclude))
    existing_all = q.all()

    # 이미 실행 불가(과거)인 스케줄은 충돌 대상에서 제외
    now = datetime.now()
    today = now.date()
    existing: list = []
    for ex in existing_all:
        ex_mode_tmp = ex.ScheduleMode or ("weekly" if ex.Repeat == "Y" else "once")
        if ex_mode_tmp == "once":
            # once는 StartDate가 과거면 실행 안 됨 (스케줄러 _should_run_once와 동일 규칙)
            if ex.StartDate and ex.StartDate < now - timedelta(minutes=1):
                continue
        else:
            # weekly/interval: SeriesEndDate가 있고 오늘보다 과거면 만료
            if ex.SeriesEndDate and ex.SeriesEndDate < today:
                continue
        existing.append(ex)

    if not existing:
        return

    DAY_MAP = {0: "월", 1: "화", 2: "수", 3: "목", 4: "금", 5: "토", 6: "일"}

    new_days: set[str] | None = None
    new_date: str | None = None

    if mode == "once":
        st = getattr(req, 'StartTime', None)
        if st:
            if isinstance(st, str):
                st = datetime.strptime(st, "%Y-%m-%d %H:%M:%S")
            new_date = st.strftime("%Y-%m-%d")
    elif mode in ("weekly", "interval"):
        days_str = getattr(req, 'RepeatDays', '') or ''
        new_days = set(d.strip() for d in days_str.split(",") if d.strip())

    for ex in existing:
        ex_mode = ex.ScheduleMode or ("weekly" if ex.Repeat == "Y" else "once")

        if mode != "interval" and ex_mode != "interval":
            continue

        ex_days: set[str] | None = None
        if ex.Repeat_Day:
            ex_days = set(d.strip() for d in ex.Repeat_Day.split(","))

        if new_days and ex_days:
            if not new_days & ex_days:
                continue

        if mode == "once" and ex_mode == "interval" and new_date:
            once_dt = datetime.strptime(new_date, "%Y-%m-%d")
            once_day = DAY_MAP[once_dt.weekday()]
            if ex_days and once_day not in ex_days:
                continue
        if mode == "interval" and ex_mode == "once":
            if ex.StartDate and new_days:
                ex_day = DAY_MAP[ex.StartDate.weekday()]
                if ex_day not in new_days:
                    continue

        if mode == "interval":
            new_start = _parse_hm(getattr(req, 'ActiveStartTime', None) or "00:00")
            new_end = _parse_hm(getattr(req, 'ActiveEndTime', None) or "23:59")
            new_interval_range = (new_start, new_end)
        if ex_mode == "interval":
            ex_start = _parse_hm(ex.ActiveStartTime or "00:00")
            ex_end = _parse_hm(ex.ActiveEndTime or "23:59")
            ex_interval_range = (ex_start, ex_end)

        conflict_name = ex.WorkName

        # Case 1: 새 interval vs 기존 interval → 시간대 겹침
        if mode == "interval" and ex_mode == "interval":
            if _ranges_overlap(new_interval_range, ex_interval_range):
                raise HTTPException(
                    status_code=409,
                    detail=f"같은 로봇({robot_name})의 주기반복 시간대가 겹칩니다: {conflict_name}"
                )

        # Case 2: 새 once/weekly → 기존 interval 시간대 안에 포함되는지
        if mode != "interval" and ex_mode == "interval":
            points: list[int] = []
            if mode == "once":
                st = getattr(req, 'StartTime', None)
                if st:
                    if isinstance(st, str):
                        st = datetime.strptime(st, "%Y-%m-%d %H:%M:%S")
                    points.append(st.hour * 60 + st.minute)
            elif mode == "weekly":
                exec_time = getattr(req, 'ExecutionTime', None)
                if exec_time:
                    points = [_parse_hm(t) for t in exec_time.split(",")]
            for p in points:
                if _point_in_range(p, ex_interval_range):
                    raise HTTPException(
                        status_code=409,
                        detail=f"같은 로봇({robot_name})의 주기반복({ex.ActiveStartTime}~{ex.ActiveEndTime}) 시간대와 겹칩니다: {conflict_name}"
                    )

        # Case 3: 새 interval → 기존 once/weekly 시각이 시간대 안에 포함되는지
        if mode == "interval" and ex_mode != "interval":
            points: list[int] = []
            if ex_mode == "once" and ex.StartDate:
                points.append(ex.StartDate.hour * 60 + ex.StartDate.minute)
            elif ex_mode == "weekly" and ex.ExecutionTime:
                points = [_parse_hm(t) for t in ex.ExecutionTime.split(",")]
            for p in points:
                if _point_in_range(p, new_interval_range):
                    raise HTTPException(
                        status_code=409,
                        detail=f"주기반복 시간대({getattr(req, 'ActiveStartTime', '')}~{getattr(req, 'ActiveEndTime', '')}) 안에 기존 작업이 있습니다: {conflict_name}"
                    )


def standby_capability(db: Session, robot_name: str) -> dict:
    """상시 대기 등록 가능 여부. 화면 게이팅과 저장 검증이 같은 판정을 쓴다 (PRD §3.6).

    "기능이 없으니 막는다"가 아니라 **대체 트리거가 있느냐**로 가른다 —
    마이크만 없으면 호출 방식이 버튼으로 고정될 뿐 나머지는 그대로 성립한다.
    """
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.RobotName == robot_name, RobotInfo.DeletedAt.is_(None))
        .first()
    )
    if not robot:
        return {"allowed": False, "reason": "로봇을 찾을 수 없습니다.",
                "hasVoice": False, "hasMic": False, "hasSpeaker": False, "destinationCount": 0}

    mod = (
        db.query(RobotModule)
        .filter(RobotModule.RobotId == robot.id, RobotModule.ModuleType == "voice")
        .first()
    )
    info = (
        db.query(ModuleVoiceInfo).filter(ModuleVoiceInfo.ModuleId == mod.id).first()
        if mod else None
    )
    has_voice = bool(mod and mod.IsActive)
    has_mic = bool(info and info.HasMic)
    has_speaker = bool(info.HasSpeaker) if info else True

    # 목적지 사전 — 장소가 연결된 항목만 실제로 안내할 수 있다
    dest_count = (
        db.query(VoiceSlotValue)
        .filter(VoiceSlotValue.RobotId == robot.id,
                VoiceSlotValue.SlotName == "목적지",
                VoiceSlotValue.LocationId.isnot(None))
        .count()
    )

    reason = None
    if not has_voice:
        reason = "이 로봇은 음성 모듈이 없습니다. 상시 대기 응대를 등록할 수 없습니다."
    elif not has_speaker:
        reason = "이 로봇은 스피커가 없어 응답 발화를 할 수 없습니다."
    elif dest_count == 0:
        reason = "음성 관리 › 목적지 사전에 목적지를 먼저 등록하세요."

    return {
        "allowed": reason is None,
        "reason": reason,
        "hasVoice": has_voice,
        "hasMic": has_mic,
        "hasSpeaker": has_speaker,
        "destinationCount": dest_count,
        # 마이크가 없으면 호출 방식은 버튼으로 고정된다
        "allowedTriggers": ["mic", "button"] if has_mic else ["button"],
    }


def _standby_overlap_warnings(db: Session, robot_name: str, req, exclude_id: int | None = None) -> list[str]:
    """상시 대기 시간대와 겹치는 예약 작업 안내.

    막지 않는다 — 겹쳐도 예약 작업이 우선이고 상시 대기는 양보한다(S8).
    저장을 차단하면 "예약이 하나라도 있으면 상시 대기를 못 만든다"가 되어 과하다.
    """
    try:
        start = int(req.ActiveStartTime.split(":")[0]) * 60 + int(req.ActiveStartTime.split(":")[1])
        end = int(req.ActiveEndTime.split(":")[0]) * 60 + int(req.ActiveEndTime.split(":")[1])
    except (AttributeError, ValueError):
        return []

    days = {d.strip() for d in (getattr(req, "RepeatDays", "") or "").split(",") if d.strip()}
    q = db.query(ScheduleInfo).filter(
        ScheduleInfo.RobotName == robot_name,
        ScheduleInfo.TaskStatus.in_(["대기", "진행중"]),
        ScheduleInfo.ScheduleMode != "standby",
    )
    if exclude_id is not None:
        q = q.filter(ScheduleInfo.id != exclude_id)

    warnings: list[str] = []
    for ex in q.all():
        ex_days = {d.strip() for d in (ex.Repeat_Day or "").split(",") if d.strip()}
        if days and ex_days and not (days & ex_days):
            continue
        points: list[int] = []
        ex_mode = ex.ScheduleMode or ("weekly" if ex.Repeat == "Y" else "once")
        if ex_mode == "once" and ex.StartDate:
            points = [ex.StartDate.hour * 60 + ex.StartDate.minute]
        elif ex_mode == "weekly" and ex.ExecutionTime:
            for t in ex.ExecutionTime.split(","):
                try:
                    h, m = t.strip().split(":")
                    points.append(int(h) * 60 + int(m))
                except ValueError:
                    continue
        elif ex_mode == "interval" and ex.ActiveStartTime:
            try:
                h, m = ex.ActiveStartTime.split(":")
                points = [int(h) * 60 + int(m)]
            except ValueError:
                points = []
        if any(start <= p < end for p in points):
            warnings.append(f"'{ex.WorkName}'이(가) 같은 시간대에 있습니다 — 예약 작업이 우선하며 상시 대기는 양보합니다.")
    return warnings


@database.get("/schedule-standby-capability")
def get_standby_capability(
    robot: str,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """등록 화면 게이팅용 — 이 로봇이 상시 대기를 등록할 수 있는지."""
    return standby_capability(db, robot)


@database.post("/schedule")
def insert_schedule(
    req: ScheduleInsertReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    from datetime import date as date_type
    import uuid as _uuid

    if req.ScheduleMode == "once" and req.StartTime is not None:
        # 서버 시계 기준 과거(60초 grace)는 거부 — 프론트 시계 오차 우회 방지
        if req.StartTime < datetime.now() - timedelta(seconds=60):
            raise HTTPException(
                status_code=400,
                detail=f"실행 일시({req.StartTime})가 현재 시각보다 과거입니다.",
            )

    if req.ScheduleMode == "interval":
        _validate_interval_range(req.ActiveStartTime, req.ActiveEndTime, req.IntervalMinutes)

    warnings: list[str] = []
    if req.ScheduleMode == "standby":
        cap = standby_capability(db, req.RobotName)
        if not cap["allowed"]:
            raise HTTPException(status_code=400, detail=cap["reason"])
        if req.StandbyTrigger not in cap["allowedTriggers"]:
            raise HTTPException(
                status_code=400,
                detail="이 로봇에는 마이크가 등록되어 있지 않습니다. 호출 방식을 '버튼'으로 선택하세요.",
            )
        # 겹침은 차단이 아니라 경고다 — 예약이 우선하고 상시 대기가 양보한다(S8)
        warnings = _standby_overlap_warnings(db, req.RobotName, req)
    else:
        _check_schedule_conflict(db, req.RobotName, req.ScheduleMode, req)

    schedule = ScheduleInfo(
        UserId=current_user.id,
        RobotName=req.RobotName,
        WorkName=req.TaskName,
        TaskType=req.TaskType,
        WayName=req.WayName,
        TaskStatus=req.WorkStatus,
        ScheduleMode=req.ScheduleMode,
        SeriesGroupId=str(_uuid.uuid4()),
    )

    if req.ScheduleMode == "once":
        schedule.StartDate = req.StartTime
        schedule.EndDate = req.StartTime
        schedule.Repeat = "N"

    elif req.ScheduleMode == "weekly":
        series_start = datetime.strptime(req.SeriesStartDate, "%Y-%m-%d").date() if req.SeriesStartDate else date_type.today()
        first_time = (req.ExecutionTime or "00:00").split(",")[0].strip()
        exec_h, exec_m = first_time.split(":")
        schedule.StartDate = datetime.combine(series_start, datetime.min.time().replace(hour=int(exec_h), minute=int(exec_m)))
        schedule.EndDate = schedule.StartDate
        schedule.Repeat = "Y"
        schedule.Repeat_Day = req.RepeatDays
        schedule.ExecutionTime = req.ExecutionTime
        schedule.SeriesStartDate = series_start
        if req.SeriesEndDate:
            schedule.SeriesEndDate = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
            schedule.Repeat_End = req.SeriesEndDate

    elif req.ScheduleMode == "interval":
        series_start = datetime.strptime(req.SeriesStartDate, "%Y-%m-%d").date() if req.SeriesStartDate else date_type.today()
        start_h, start_m = (req.ActiveStartTime or "00:00").split(":")
        schedule.StartDate = datetime.combine(series_start, datetime.min.time().replace(hour=int(start_h), minute=int(start_m)))
        schedule.EndDate = schedule.StartDate
        schedule.Repeat = "Y"
        schedule.Repeat_Day = req.RepeatDays
        schedule.IntervalMinutes = req.IntervalMinutes
        schedule.ActiveStartTime = req.ActiveStartTime
        schedule.ActiveEndTime = req.ActiveEndTime
        schedule.SeriesStartDate = series_start
        if req.SeriesEndDate:
            schedule.SeriesEndDate = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
            schedule.Repeat_End = req.SeriesEndDate

    elif req.ScheduleMode == "standby":
        series_start = datetime.strptime(req.SeriesStartDate, "%Y-%m-%d").date() if req.SeriesStartDate else date_type.today()
        start_h, start_m = (req.ActiveStartTime or "09:00").split(":")
        schedule.StartDate = datetime.combine(series_start, datetime.min.time().replace(hour=int(start_h), minute=int(start_m)))
        schedule.EndDate = schedule.StartDate
        schedule.Repeat = "Y"
        schedule.Repeat_Day = req.RepeatDays
        schedule.ActiveStartTime = req.ActiveStartTime
        schedule.ActiveEndTime = req.ActiveEndTime
        schedule.SeriesStartDate = series_start
        if req.SeriesEndDate:
            schedule.SeriesEndDate = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
            schedule.Repeat_End = req.SeriesEndDate
        schedule.ReturnPolicy = "place" if req.ReturnPlaceId else "charge"
        schedule.ReturnPlaceId = req.ReturnPlaceId
        schedule.StandbyTrigger = req.StandbyTrigger
        schedule.StandbyDestinations = req.StandbyDestinations
        schedule.StandbyMaxSessionMin = req.StandbyMaxSessionMin or 20
        schedule.StandbyRetryCount = req.StandbyRetryCount if req.StandbyRetryCount is not None else 2
        schedule.StandbyRetryWindowSec = req.StandbyRetryWindowSec or 10

    db.add(schedule)
    db.commit()
    db.refresh(schedule)

    write_audit(db, current_user.id, "schedule_created", "schedule", schedule.id,
                detail=f"작업명: {req.TaskName}, 로봇: {req.RobotName}, 유형: {req.TaskType}, 경로: {req.WayName}, 모드: {req.ScheduleMode}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "id": schedule.id, "warnings": warnings}


@database.get("/schedule")
def get_schedules(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("schedule-list"))):
    q = db.query(ScheduleInfo)
    if not is_admin(current_user) and current_user.BusinessId:
        biz_names = get_business_robot_names(db, current_user.BusinessId)
        q = q.filter(ScheduleInfo.RobotName.in_(biz_names))
    schedules = q.order_by(ScheduleInfo.StartDate.asc()).all()
    return [
        {
            "id": s.id,
            "RobotName": s.RobotName,
            "WorkName": s.WorkName,
            "TaskType": s.TaskType,
            "TaskStatus": s.TaskStatus,
            "StartDate": s.StartDate.isoformat() if s.StartDate else None,
            "EndDate": s.EndDate.isoformat() if s.EndDate else None,
            "WayName": s.WayName,
            "Repeat": s.Repeat,
            "Repeat_Day": s.Repeat_Day,
            "Repeat_End": s.Repeat_End,
            "ScheduleMode": s.ScheduleMode or "once",
            "ExecutionTime": s.ExecutionTime,
            "IntervalMinutes": s.IntervalMinutes,
            "ActiveStartTime": s.ActiveStartTime,
            "ActiveEndTime": s.ActiveEndTime,
            "SeriesStartDate": s.SeriesStartDate.isoformat() if s.SeriesStartDate else None,
            "SeriesEndDate": s.SeriesEndDate.isoformat() if s.SeriesEndDate else None,
            "SeriesExceptions": s.SeriesExceptions,
            "RunCount": s.RunCount or 0,
            "MaxRunCount": s.MaxRunCount,
            "LastRunDate": s.LastRunDate.isoformat() if s.LastRunDate else None,
        }
        for s in schedules
    ]


@database.get("/schedule/active")
def get_active_schedule():
    """현재 스케줄러에 의해 실행 중인 스케줄 ID 반환"""
    from app.scheduler.loop import get_active_schedule_id
    active_id = get_active_schedule_id()
    return {"active_schedule_id": active_id}


@database.get("/schedule/{schedule_id}")
def get_schedule_detail(schedule_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("schedule-list"))):
    schedule = (
        db.query(ScheduleInfo)
        .filter(ScheduleInfo.id == schedule_id)
        .first()
    )

    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # 같은 시리즈 그룹의 다른 row 개수 (this/thisAndFuture 분할 이력)
    # 프론트가 '전체 수정(all)' 시 병합·삭제되는 회차가 있음을 사용자에게 경고하는 데 사용.
    sibling_count = 0
    if schedule.SeriesGroupId:
        sibling_count = (
            db.query(ScheduleInfo)
            .filter(
                ScheduleInfo.SeriesGroupId == schedule.SeriesGroupId,
                ScheduleInfo.id != schedule.id,
            )
            .count()
        )

    return {
        "id": schedule.id,
        "RobotName": schedule.RobotName,
        "TaskName": schedule.WorkName,
        "TaskType": schedule.TaskType,
        "TaskStatus": schedule.TaskStatus,

        "StartDate": schedule.StartDate.isoformat() if schedule.StartDate else None,
        "EndDate": schedule.EndDate.isoformat() if schedule.EndDate else None,

        "Repeat": schedule.Repeat,
        "Repeat_Day": schedule.Repeat_Day,
        "Repeat_End": schedule.Repeat_End,

        "WayName": schedule.WayName,

        "ScheduleMode": schedule.ScheduleMode or "once",
        "ExecutionTime": schedule.ExecutionTime,
        "IntervalMinutes": schedule.IntervalMinutes,
        "ActiveStartTime": schedule.ActiveStartTime,
        "ActiveEndTime": schedule.ActiveEndTime,
        "SeriesStartDate": schedule.SeriesStartDate.isoformat() if schedule.SeriesStartDate else None,
        "SeriesEndDate": schedule.SeriesEndDate.isoformat() if schedule.SeriesEndDate else None,
        "SeriesExceptions": schedule.SeriesExceptions,
        "SiblingCount": sibling_count,

        "LastRunDate": schedule.LastRunDate.isoformat() if schedule.LastRunDate else None,
        "RunCount": schedule.RunCount or 0,
        "MaxRunCount": schedule.MaxRunCount,
    }


class ScheduleUpdateReq(BaseModel):
    WorkName: str | None = None
    TaskType: str | None = None
    TaskStatus: str | None = None
    ScheduleMode: str | None = None
    StartTime: datetime | None = None
    PathName: str | None = None

    # weekly
    ExecutionTime: str | None = None
    RepeatDays: str | None = None

    # interval
    ActiveStartTime: str | None = None
    ActiveEndTime: str | None = None
    IntervalMinutes: int | None = None

    # 공통
    SeriesStartDate: str | None = None
    SeriesEndDate: str | None = None

    # 반복 시리즈 편집 범위
    # "all" (기본) | "thisAndFuture" | "this"
    RepeatScope: str | None = None
    # "this"/"thisAndFuture" 기준 날짜 (YYYY-MM-DD, 생략 시 오늘)
    TargetDate: str | None = None

    @field_validator("ExecutionTime")
    @classmethod
    def _v_execution_time(cls, v):
        return _validate_exec_time(v)

    @field_validator("ActiveStartTime")
    @classmethod
    def _v_active_start(cls, v):
        return _validate_hhmm(v, "ActiveStartTime")

    @field_validator("ActiveEndTime")
    @classmethod
    def _v_active_end(cls, v):
        return _validate_hhmm(v, "ActiveEndTime")


def _apply_edit_fields(sched: ScheduleInfo, req: ScheduleUpdateReq) -> None:
    """req의 값들을 sched에 반영. 공통 로직.

    SeriesStartDate/SeriesEndDate는 `null 명시`를 "무기한/초기화"로 해석해야 하므로
    model_fields_set으로 "필드 미전송"과 "null로 명시 설정"을 구분한다.
    """
    fields_set = req.model_fields_set

    if req.WorkName is not None:
        sched.WorkName = req.WorkName
    if req.TaskType is not None:
        sched.TaskType = req.TaskType
    if req.TaskStatus is not None:
        sched.TaskStatus = req.TaskStatus
    if req.PathName is not None:
        sched.WayName = req.PathName

    if req.ScheduleMode is not None:
        sched.ScheduleMode = req.ScheduleMode
        if req.ScheduleMode == "once":
            sched.Repeat = "N"
            sched.Repeat_Day = None
            sched.Repeat_End = None
            sched.ExecutionTime = None
            sched.IntervalMinutes = None
            sched.ActiveStartTime = None
            sched.ActiveEndTime = None
            sched.SeriesStartDate = None
            sched.SeriesEndDate = None
        elif req.ScheduleMode == "weekly":
            sched.Repeat = "Y"
            sched.IntervalMinutes = None
            sched.ActiveStartTime = None
            sched.ActiveEndTime = None
        elif req.ScheduleMode == "interval":
            sched.Repeat = "Y"
            sched.ExecutionTime = None
        elif req.ScheduleMode == "standby":
            # 운영 시간대(ActiveStart/End)로 사는 모드 — 실행 시각·반복 간격은 쓰지 않는다.
            # 호출 방식·대기 장소 등 Standby* 설정은 수정 모달이 다루지 않으므로 건드리지 않는다.
            sched.Repeat = "Y"
            sched.ExecutionTime = None
            sched.IntervalMinutes = None

    if req.StartTime is not None:
        sched.StartDate = req.StartTime
        sched.EndDate = req.StartTime
    if req.ExecutionTime is not None:
        sched.ExecutionTime = req.ExecutionTime
    if req.RepeatDays is not None:
        sched.Repeat_Day = req.RepeatDays
    if req.ActiveStartTime is not None:
        sched.ActiveStartTime = req.ActiveStartTime
    if req.ActiveEndTime is not None:
        sched.ActiveEndTime = req.ActiveEndTime
    if req.IntervalMinutes is not None:
        sched.IntervalMinutes = req.IntervalMinutes

    # SeriesStartDate — null은 "초기화"
    if "SeriesStartDate" in fields_set:
        if req.SeriesStartDate is None:
            sched.SeriesStartDate = None
        else:
            sched.SeriesStartDate = datetime.strptime(req.SeriesStartDate, "%Y-%m-%d").date()
            if sched.ScheduleMode in ("weekly", "interval"):
                exec_time = sched.ExecutionTime or sched.ActiveStartTime or "00:00"
                first_time = exec_time.split(",")[0].strip()
                h, m = first_time.split(":")
                sched.StartDate = datetime.combine(sched.SeriesStartDate, datetime.min.time().replace(hour=int(h), minute=int(m)))
                sched.EndDate = sched.StartDate

    # SeriesEndDate — null은 "무기한"
    if "SeriesEndDate" in fields_set:
        if req.SeriesEndDate is None:
            sched.SeriesEndDate = None
            sched.Repeat_End = None
        else:
            sched.SeriesEndDate = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
            sched.Repeat_End = req.SeriesEndDate


# 편집을 막는 상태. "지나간 것과 지금 도는 것은 못 고친다"가 원칙이다.
# 오늘 이미 실행됐어도 지금 '대기'면 허용한다 — 오늘 회차는 어차피 지나갔고,
# 내일 이후 회차를 위한 수정까지 막으면 반복 작업이 그날 내내 잠긴다.
UNEDITABLE_STATUSES = ("진행중", "진행", "완료", "취소")


def _edit_block_reason(
    sched: ScheduleInfo,
    scope: str | None = None,
    target_date: date | None = None,
) -> str | None:
    """수정을 막아야 하면 사유, 고칠 수 있으면 None.

    '진행중' 차단은 **지금 도는 그 회차를 건드릴 때만** 건다.
    앞으로의 회차만 고치는 것까지 막으면 반복 작업이 그날 내내 잠긴다 —
    특히 상시 대기는 운영 시간(예: 09:00~18:00) 내내 '진행중'이라
    그 아홉 시간 동안 아무것도 못 고치게 된다.
    """
    status = sched.TaskStatus
    if status not in UNEDITABLE_STATUSES:
        return None
    if status not in ("진행중", "진행"):
        return f"'{status}' 상태의 작업은 수정할 수 없습니다. 새로 등록해 주세요."

    # 범위가 '전체'거나 대상 날짜가 오늘 이전이면 지금 도는 회차를 건드린다.
    touches_running = (
        scope in (None, "all")
        or target_date is None
        or target_date <= date.today()
    )
    if touches_running:
        return "진행 중인 작업은 수정할 수 없습니다. 이 회차 이후만 고치려면 수정 범위를 '이후 모든 회차'로 선택해 주세요."
    return None


def _clone_schedule_for_split(source: ScheduleInfo) -> ScheduleInfo:
    """시리즈 분할 시 새 ScheduleInfo를 source 기준으로 복제한다.
    대기 상태로 초기화하고 RunCount/LastRunDate/SeriesExceptions는 리셋.
    SeriesGroupId는 부모와 동일 (split 된 row들은 하나의 시리즈 그룹)."""
    return ScheduleInfo(
        UserId=source.UserId,
        RobotName=source.RobotName,
        WorkName=source.WorkName,
        TaskType=source.TaskType,
        WayName=source.WayName,
        TaskStatus="대기",
        StartDate=source.StartDate,
        EndDate=source.EndDate,
        Repeat=source.Repeat,
        Repeat_Day=source.Repeat_Day,
        Repeat_End=source.Repeat_End,
        ScheduleMode=source.ScheduleMode,
        ExecutionTime=source.ExecutionTime,
        IntervalMinutes=source.IntervalMinutes,
        ActiveStartTime=source.ActiveStartTime,
        ActiveEndTime=source.ActiveEndTime,
        SeriesStartDate=source.SeriesStartDate,
        SeriesEndDate=source.SeriesEndDate,
        SeriesExceptions=None,
        SeriesGroupId=source.SeriesGroupId,
        RunCount=0,
        MaxRunCount=source.MaxRunCount,
        # 상시 대기 전용 설정. 빠뜨리면 분할된 회차가 호출 방식·대기 장소·목적지
        # 화이트리스트를 잃고 기본값(button/충전소/전체허용)으로 조용히 바뀐다.
        ReturnPolicy=source.ReturnPolicy,
        ReturnPlaceId=source.ReturnPlaceId,
        StandbyTrigger=source.StandbyTrigger,
        StandbyDestinations=source.StandbyDestinations,
        StandbyMaxSessionMin=source.StandbyMaxSessionMin,
        StandbyRetryCount=source.StandbyRetryCount,
        StandbyRetryWindowSec=source.StandbyRetryWindowSec,
        StandbyIdleSitSec=source.StandbyIdleSitSec,
    )


@database.put("/schedule/{schedule_id}")
def update_schedule(
    schedule_id: int,
    req: ScheduleUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # sched가 thisAndFuture 경로에서 dead row로 판정되어 삭제될 수 있음
    # → 삭제 후 sched.WorkName / sched.id / db.refresh(sched) 접근 불가 → 미리 캡처
    sched_work_name = sched.WorkName

    # ─── 반복 시리즈 편집 범위 결정 ───
    scope = (req.RepeatScope or "all").strip()
    is_series = (sched.ScheduleMode in ("weekly", "interval", "standby")) or (sched.Repeat == "Y")
    # 시리즈가 아닌 once 스케줄엔 범위 의미 없음 → all로 강제
    if not is_series:
        scope = "all"

    if req.TargetDate:
        try:
            target_date = datetime.strptime(req.TargetDate, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"잘못된 TargetDate: {req.TargetDate}")
    else:
        target_date = date.today()

    # 완료·취소는 기록이라 손대지 않는다. 진행 중은 **지금 도는 회차를 건드릴 때만** 막는다 —
    # 범위·대상 날짜를 알아야 판정할 수 있어 여기서 검사한다.
    block = _edit_block_reason(sched, scope, target_date)
    if block:
        raise HTTPException(status_code=409, detail=block)

    # interval 활동 시간대 / 간격 일관성 검증 (merged 값 기준)
    effective_mode = req.ScheduleMode or sched.ScheduleMode or ("weekly" if sched.Repeat == "Y" else "once")
    if effective_mode == "interval":
        _validate_interval_range(
            req.ActiveStartTime if req.ActiveStartTime is not None else sched.ActiveStartTime,
            req.ActiveEndTime if req.ActiveEndTime is not None else sched.ActiveEndTime,
            req.IntervalMinutes if req.IntervalMinutes is not None else sched.IntervalMinutes,
        )

    # 충돌 체크 — all 범위에서만 기존 로직 적용(분할 시엔 신규 row로 별도 체크)
    if scope == "all" and any(getattr(req, f, None) is not None for f in (
        'ScheduleMode', 'StartTime', 'ExecutionTime', 'ActiveStartTime',
        'ActiveEndTime', 'RepeatDays',
    )):
        check_mode = effective_mode
        class _MergedReq:
            pass
        merged = _MergedReq()
        merged.StartTime = req.StartTime or sched.StartDate
        merged.ExecutionTime = req.ExecutionTime if req.ExecutionTime is not None else sched.ExecutionTime
        merged.RepeatDays = req.RepeatDays if req.RepeatDays is not None else sched.Repeat_Day
        merged.ActiveStartTime = req.ActiveStartTime if req.ActiveStartTime is not None else sched.ActiveStartTime
        merged.ActiveEndTime = req.ActiveEndTime if req.ActiveEndTime is not None else sched.ActiveEndTime
        # 같은 SeriesGroup의 형제 row는 곧 purge되므로 충돌 체크에서 제외
        sibling_ids: set[int] = {schedule_id}
        if sched.SeriesGroupId:
            rows = db.query(ScheduleInfo.id).filter(
                ScheduleInfo.SeriesGroupId == sched.SeriesGroupId
            ).all()
            sibling_ids.update(r.id for r in rows)
        _check_schedule_conflict(db, sched.RobotName, check_mode, merged, exclude_ids=sibling_ids)

    created_id = None
    sched_was_deleted = False  # thisAndFuture 에서 dead row로 판정되면 True

    if scope == "all":
        # 같은 시리즈 그룹의 다른 row(이전 split 산물)는 전체 수정 의미상 제거
        purged_ids: list[int] = []
        group_min_start = sched.SeriesStartDate
        group_any_null_end = sched.SeriesEndDate is None
        group_max_end = sched.SeriesEndDate
        if sched.SeriesGroupId:
            siblings = (
                db.query(ScheduleInfo)
                .filter(
                    ScheduleInfo.SeriesGroupId == sched.SeriesGroupId,
                    ScheduleInfo.id != sched.id,
                )
                .all()
            )
            for s in siblings:
                # 그룹 전체 범위 집계 (과거까지 포괄하려면 최소 Start / 최대 End)
                if s.SeriesStartDate and (group_min_start is None or s.SeriesStartDate < group_min_start):
                    group_min_start = s.SeriesStartDate
                if s.SeriesEndDate is None:
                    group_any_null_end = True
                elif group_max_end is None or s.SeriesEndDate > group_max_end:
                    if not group_any_null_end:
                        group_max_end = s.SeriesEndDate
                purged_ids.append(s.id)
                db.delete(s)
        _apply_edit_fields(sched, req)
        # 그룹이 통합되었으므로 기존 예외 날짜 초기화
        sched.SeriesExceptions = None
        # 전체 범위 의미: 과거·미래 포괄하도록 그룹의 최광역 범위로 보정
        if group_min_start is not None and (sched.SeriesStartDate is None or sched.SeriesStartDate > group_min_start):
            sched.SeriesStartDate = group_min_start
            if sched.ScheduleMode in ("weekly", "interval"):
                exec_time = sched.ExecutionTime or sched.ActiveStartTime or "00:00"
                first_time = exec_time.split(",")[0].strip()
                try:
                    h, m = first_time.split(":")
                    sched.StartDate = datetime.combine(group_min_start, time(int(h), int(m)))
                    sched.EndDate = sched.StartDate
                except ValueError:
                    pass
        if group_any_null_end:
            sched.SeriesEndDate = None
            sched.Repeat_End = None
        elif group_max_end is not None and sched.SeriesEndDate is not None and sched.SeriesEndDate < group_max_end:
            sched.SeriesEndDate = group_max_end
            sched.Repeat_End = group_max_end.strftime("%Y-%m-%d")
        audit_detail = (
            f"스케줄 수정(전체): {sched.WorkName}"
            + (f" / 병합 삭제 id={purged_ids}" if purged_ids else "")
        )

    elif scope == "thisAndFuture":
        # 새 시리즈의 유효기간 종료일이 target_date보다 과거면 빈 범위가 되어 무의미
        if "SeriesEndDate" in req.model_fields_set and req.SeriesEndDate is not None:
            try:
                new_end = datetime.strptime(req.SeriesEndDate, "%Y-%m-%d").date()
                if new_end < target_date:
                    raise HTTPException(
                        status_code=400,
                        detail=f"유효기간 종료일({req.SeriesEndDate})이 수정 기준일({target_date}) 이전입니다. 종료일을 기준일 이후로 지정하거나 무기한으로 설정해 주세요.",
                    )
            except ValueError:
                pass

        # 같은 SeriesGroup에서 target_date 이후에 시작하는 형제 row들 조회
        # - SeriesStartDate == target_date 인 row는 재사용 (중복 row 생성 방지)
        # - 그 외(target_date보다 뒤에 시작하는 개별 this 편집이나 과거 thisAndFuture 분할)는 삭제
        #   → "오늘 및 이후 수정"의 사용자 기대: 미래의 개별 편집도 새 설정으로 덮어쓴다
        existing_future = None
        purged_future_ids: list[int] = []
        if sched.SeriesGroupId:
            future_siblings = (
                db.query(ScheduleInfo)
                .filter(
                    ScheduleInfo.SeriesGroupId == sched.SeriesGroupId,
                    ScheduleInfo.id != sched.id,
                    ScheduleInfo.SeriesStartDate != None,  # noqa: E711
                    ScheduleInfo.SeriesStartDate >= target_date,
                )
                .all()
            )
            for s in future_siblings:
                if existing_future is None and s.SeriesStartDate == target_date:
                    existing_future = s
                    continue
                purged_future_ids.append(s.id)
                db.delete(s)

        if existing_future is not None:
            # 기존 future row 재사용
            _apply_edit_fields(existing_future, req)
            existing_future.SeriesStartDate = target_date
            exec_time = existing_future.ExecutionTime or existing_future.ActiveStartTime or "00:00"
            first_time = exec_time.split(",")[0].strip()
            try:
                h, m = first_time.split(":")
                existing_future.StartDate = datetime.combine(target_date, time(int(h), int(m)))
                existing_future.EndDate = existing_future.StartDate
            except ValueError:
                pass
            target_row = existing_future
            reuse = True
        else:
            # 새 future row 생성 (첫 분할)
            new_sched = _clone_schedule_for_split(sched)
            _apply_edit_fields(new_sched, req)
            new_sched.SeriesStartDate = target_date
            exec_time = new_sched.ExecutionTime or new_sched.ActiveStartTime or "00:00"
            first_time = exec_time.split(",")[0].strip()
            try:
                h, m = first_time.split(":")
                new_sched.StartDate = datetime.combine(target_date, time(int(h), int(m)))
                new_sched.EndDate = new_sched.StartDate
            except ValueError:
                pass
            db.add(new_sched)
            target_row = new_sched
            reuse = False

        # 원본 종료일 = target_date - 1 (단, sched 자신이 target_row인 경우는 제외).
        # 절단 후 실행 가능 회차가 하나도 없으면 (dead row) 통째로 삭제.
        if sched.id != getattr(target_row, 'id', None):
            first_exec_sched = _first_execution_date(sched)
            if first_exec_sched is not None and first_exec_sched >= target_date:
                db.delete(sched)
                purged_future_ids.append(sched.id)
                sched_was_deleted = True
            else:
                sched.SeriesEndDate = target_date - timedelta(days=1)
                sched.Repeat_End = sched.SeriesEndDate.strftime("%Y-%m-%d") if sched.SeriesEndDate else sched.Repeat_End

        db.flush()
        created_id = target_row.id
        audit_detail = (
            f"스케줄 수정(현재+이후): {sched_work_name} → "
            + (f"기존 future #{created_id} 재사용" if reuse else f"새 시리즈 #{created_id}")
            + (f" / 미래 형제 삭제 id={purged_future_ids}" if purged_future_ids else "")
        )

    elif scope == "this":
        target_str = target_date.strftime("%Y-%m-%d")

        # 같은 SeriesGroup에 이미 target_date 단일일 row가 있으면 재사용 (중복 생성 방지)
        existing_single = None
        if sched.SeriesGroupId:
            existing_single = (
                db.query(ScheduleInfo)
                .filter(
                    ScheduleInfo.SeriesGroupId == sched.SeriesGroupId,
                    ScheduleInfo.SeriesStartDate == target_date,
                    ScheduleInfo.SeriesEndDate == target_date,
                    ScheduleInfo.id != sched.id,
                )
                .first()
            )

        # 원본 시리즈의 target_date를 예외로 등록 — 단, sched 자체가 target_date 단일일 row면
        # 자기 자신을 예외 처리하지 않음 (inert row 발생 방지)
        sched_is_target_single = (
            sched.SeriesStartDate == target_date and sched.SeriesEndDate == target_date
        )
        if not sched_is_target_single:
            existing_exc = set()
            if sched.SeriesExceptions:
                existing_exc = {d.strip() for d in sched.SeriesExceptions.split(",") if d.strip()}
            existing_exc.add(target_str)
            sched.SeriesExceptions = ",".join(sorted(existing_exc))

        if existing_single is not None:
            # 기존 단일일 row 재사용
            _apply_edit_fields(existing_single, req)
            existing_single.SeriesStartDate = target_date
            existing_single.SeriesEndDate = target_date
            existing_single.Repeat_End = target_str
            existing_single.SeriesExceptions = None
            exec_time = existing_single.ExecutionTime or existing_single.ActiveStartTime or "00:00"
            first_time = exec_time.split(",")[0].strip()
            try:
                h, m = first_time.split(":")
                existing_single.StartDate = datetime.combine(target_date, time(int(h), int(m)))
                existing_single.EndDate = existing_single.StartDate
            except ValueError:
                pass
            target_row = existing_single
            reuse = True
        else:
            # 새 단일일 row 생성
            new_sched = _clone_schedule_for_split(sched)
            _apply_edit_fields(new_sched, req)
            new_sched.SeriesStartDate = target_date
            new_sched.SeriesEndDate = target_date
            new_sched.Repeat_End = target_str
            new_sched.SeriesExceptions = None
            exec_time = new_sched.ExecutionTime or new_sched.ActiveStartTime or "00:00"
            first_time = exec_time.split(",")[0].strip()
            try:
                h, m = first_time.split(":")
                new_sched.StartDate = datetime.combine(target_date, time(int(h), int(m)))
                new_sched.EndDate = new_sched.StartDate
            except ValueError:
                pass
            db.add(new_sched)
            target_row = new_sched
            reuse = False

        db.flush()
        created_id = target_row.id
        audit_detail = (
            f"스케줄 수정(현재만): {sched.WorkName} → "
            + (f"기존 단일일 #{created_id} 재사용" if reuse else f"weekly #{created_id}")
            + f" ({target_date})"
        )

    else:
        raise HTTPException(status_code=400, detail=f"알 수 없는 RepeatScope: {scope}")

    db.commit()
    # thisAndFuture 경로에서 sched가 dead row로 삭제된 경우 refresh 불가
    if not sched_was_deleted:
        db.refresh(sched)

    write_audit(db, current_user.id, "schedule_updated", "schedule", schedule_id,
                detail=audit_detail,
                ip_address=get_client_ip(request))

    return {
        "status": "ok",
        "id": schedule_id,
        "scope": scope,
        "created_id": created_id,
        "original_deleted": sched_was_deleted,
    }


class ScheduleCancelReq(BaseModel):
    # 반복 작업에서 취소할 회차의 날짜 (YYYY-MM-DD, 생략 시 오늘)
    TargetDate: str | None = None
    Reason: str | None = None


@database.post("/schedule/{schedule_id}/cancel")
def cancel_schedule(
    schedule_id: int,
    request: Request,
    req: ScheduleCancelReq | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """작업 회차를 취소한다 — **삭제가 아니다.**

    - 대기   : 이 회차만 실행하지 않는다(반복이면 다음 회차는 그대로)
    - 진행중 : 로봇을 세우고 중단한다. 기존 정지 경로를 재사용한다 —
               로봇 정지·ScheduleRun 마감·녹화 정지까지 함께 해야 하기 때문이다
    - 그 외  : 409
    """
    from app.scheduler.cancel_occurrence import CancelError, cancel_occurrence

    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # 남의 사업장 작업을 취소하지 못하게 한다(조회 권한과 같은 기준).
    if not is_admin(current_user) and current_user.BusinessId:
        allowed = get_business_robot_names(db, current_user.BusinessId)
        if sched.RobotName not in allowed:
            raise HTTPException(status_code=403, detail="해당 작업을 취소할 권한이 없습니다.")

    reason = (req.Reason if req else None) or "사용자 취소"
    target_date = None
    if req and req.TargetDate:
        try:
            target_date = datetime.strptime(req.TargetDate.strip(), "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="TargetDate 는 YYYY-MM-DD 형식이어야 합니다.")

    # 진행 중인 그 작업이면 로봇부터 세운다. DB 만 '취소'로 바꾸면 로봇은 계속 간다.
    try:
        from app.scheduler.loop import get_active_schedule_id
        is_active = get_active_schedule_id() == schedule_id
    except Exception:  # noqa: BLE001 — 스케줄러가 없어도 대기 작업 취소는 되어야 한다
        is_active = False

    if is_active:
        from app.navigation.send_move import stop_navigation_internal
        stop_navigation_internal(reason)   # 로봇 정지 + 회차 마감 + 스케줄 취소
        summary = {"mode": _cancel_mode_label(sched), "scope": "active", "date": None}
    else:
        try:
            summary = cancel_occurrence(db, sched, target_date)
        except CancelError as e:
            raise HTTPException(status_code=409, detail=str(e))
        db.commit()

    write_audit(db, current_user.id, "schedule_cancelled", "schedule", schedule_id,
                detail=f"작업명: {sched.WorkName}, 로봇: {sched.RobotName}, "
                       f"범위: {summary['scope']}, 날짜: {summary['date'] or '-'}, 사유: {reason}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "id": schedule_id, **summary}


def _cancel_mode_label(sched) -> str:
    return getattr(sched, "ScheduleMode", None) or ("weekly" if sched.Repeat == "Y" else "once")


@database.post("/schedule/{schedule_id}/resume")
def resume_schedule(
    schedule_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    """'오류'로 멈춘 작업을 다시 자동 실행 대상으로 되돌린다.

    서버가 재기동되면 진행 중이던 작업은 '오류'로 남고 스케줄러가 집어가지 않는다
    (메인 루프는 '대기'만 조회). 물리 상태를 모르는 채 자동 재개하면 로봇이
    복도 한가운데서 갑자기 움직일 수 있어, 재개는 사람이 누른다.

    상시 대기는 회차 하나가 하루 근무 전체라, 운영 시간대가 남아 있으면
    그 회차를 되살려 이어간다. 그렇지 않으면 (ScheduleId, PlannedAt) 유니크에
    막혀 그날은 영영 다시 시작되지 않는다.
    """
    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if not is_admin(current_user) and current_user.BusinessId:
        allowed = get_business_robot_names(db, current_user.BusinessId)
        if sched.RobotName not in allowed:
            raise HTTPException(status_code=403, detail="해당 작업을 재개할 권한이 없습니다.")

    if sched.TaskStatus != "오류":
        raise HTTPException(
            status_code=409,
            detail=f"'{sched.TaskStatus}' 상태의 작업은 재개할 수 없습니다. 오류로 멈춘 작업만 재개합니다.",
        )

    from app.database.models import ScheduleRun
    from app.logs.service import log_event

    now = datetime.now()
    mode = _cancel_mode_label(sched)
    resumed_run = False

    # 멈춰 있는 동안 그 시간대에 다른 작업이 들어왔을 수 있다 — 되돌리기 전에 다시 본다.
    _check_schedule_conflict(db, sched.RobotName, mode, sched, exclude_id=sched.id)

    if mode == "standby":
        from app.scheduler.run_conditions import standby_window
        window = standby_window(sched, now)
        if window:
            begin, _end = window
            run = (
                db.query(ScheduleRun)
                .filter(ScheduleRun.ScheduleId == sched.id, ScheduleRun.PlannedAt == begin)
                .first()
            )
            if run and run.Result != "running":
                run.Result = "running"
                run.EndedAt = None
                run.Reason = f"{run.Reason or '중단'} → 사용자 재개"
                resumed_run = True

    sched.TaskStatus = "대기"
    db.commit()

    log_event("schedule", "schedule_resumed",
              f"작업 재개: {sched.WorkName}",
              detail=f"모드={mode}, 회차 이어받음={'예' if resumed_run else '아니오'}",
              robot_name=sched.RobotName)
    write_audit(db, current_user.id, "schedule_resumed", "schedule", schedule_id,
                detail=f"작업명: {sched.WorkName}, 로봇: {sched.RobotName}, "
                       f"모드: {mode}, 회차 이어받음: {'예' if resumed_run else '아니오'}",
                ip_address=get_client_ip(request))

    return {
        "status": "ok",
        "id": schedule_id,
        "TaskStatus": sched.TaskStatus,
        "resumedRun": resumed_run,
        "message": (
            "오늘 근무를 이어서 재개합니다. 로봇이 대기 장소로 돌아간 뒤 호출을 기다립니다."
            if resumed_run else
            "작업을 다시 실행 대상으로 되돌렸습니다."
        ),
    }


class ScheduleDeleteReq(BaseModel):
    # "all" (기본) | "thisAndFuture" | "this"
    RepeatScope: str | None = None
    # "this"/"thisAndFuture" 기준 날짜 (YYYY-MM-DD, 생략 시 오늘)
    TargetDate: str | None = None


@database.delete("/schedule/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    request: Request,
    req: ScheduleDeleteReq | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("schedule-list")),
):
    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == schedule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")

    work_name = sched.WorkName
    series_group_id = sched.SeriesGroupId
    is_series = (sched.ScheduleMode in ("weekly", "interval")) or (sched.Repeat == "Y")

    scope = ((req.RepeatScope if req else None) or "all").strip()
    # 시리즈가 아니면 범위 의미 없음 → 단일 삭제로 강등
    if not is_series:
        scope = "all"

    if req and req.TargetDate:
        try:
            target_date = datetime.strptime(req.TargetDate, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"잘못된 TargetDate: {req.TargetDate}")
    else:
        target_date = date.today()

    deleted_ids: list[int] = []

    if scope == "all":
        if is_series and series_group_id:
            siblings = (
                db.query(ScheduleInfo)
                .filter(ScheduleInfo.SeriesGroupId == series_group_id)
                .all()
            )
            for s in siblings:
                deleted_ids.append(s.id)
                db.delete(s)
        else:
            deleted_ids.append(sched.id)
            db.delete(sched)
        audit_detail = f"스케줄 삭제(전체): {work_name} / id={deleted_ids}"

    elif scope == "thisAndFuture":
        # 같은 그룹에서 SeriesStartDate >= target_date 형제 row 삭제
        if series_group_id:
            futures = (
                db.query(ScheduleInfo)
                .filter(
                    ScheduleInfo.SeriesGroupId == series_group_id,
                    ScheduleInfo.id != sched.id,
                    ScheduleInfo.SeriesStartDate != None,  # noqa: E711
                    ScheduleInfo.SeriesStartDate >= target_date,
                )
                .all()
            )
            for f in futures:
                deleted_ids.append(f.id)
                db.delete(f)

        # 현재 row 처리: 절단 후 실제 실행 가능 회차가 하나도 없으면 통째로 삭제.
        # SeriesStartDate 만 기준으로 비교하면 "요일 반복 + 시작일이 첫 실행 요일 아님" 케이스에서
        # 유령 row가 남음 (예: 시작 4/23 목 + RepeatDays=월 → 첫 실행 4/27.
        # target_date=4/27로 절단하면 [4/23~4/26]에 월요일이 없어 실행 0회인 dead row 잔존).
        first_exec = _first_execution_date(sched)
        is_dead_after_truncate = first_exec is not None and first_exec >= target_date
        if is_dead_after_truncate:
            deleted_ids.append(sched.id)
            db.delete(sched)
            truncated = False
        else:
            new_end = target_date - timedelta(days=1)
            sched.SeriesEndDate = new_end
            sched.Repeat_End = new_end.strftime("%Y-%m-%d")
            truncated = True

        audit_detail = (
            f"스케줄 삭제(현재+이후): {work_name} 기준일={target_date} / "
            + ("원본 절단" if truncated else "원본 삭제")
            + (f" / 삭제 id={deleted_ids}" if deleted_ids else "")
        )

    elif scope == "this":
        target_str = target_date.strftime("%Y-%m-%d")
        sched_is_target_single = (
            sched.SeriesStartDate == target_date and sched.SeriesEndDate == target_date
        )
        if sched_is_target_single:
            # 이미 단일일 row면 그대로 삭제 (예외 등록 불필요)
            deleted_ids.append(sched.id)
            db.delete(sched)
        else:
            # 원본 시리즈에 예외 등록
            existing_exc = set()
            if sched.SeriesExceptions:
                existing_exc = {d.strip() for d in sched.SeriesExceptions.split(",") if d.strip()}
            existing_exc.add(target_str)
            sched.SeriesExceptions = ",".join(sorted(existing_exc))

            # 같은 그룹에 있는 target_date 단일일 형제(취소·예외 분할 잔재)도 함께 제거
            if series_group_id:
                single_siblings = (
                    db.query(ScheduleInfo)
                    .filter(
                        ScheduleInfo.SeriesGroupId == series_group_id,
                        ScheduleInfo.id != sched.id,
                        ScheduleInfo.SeriesStartDate == target_date,
                        ScheduleInfo.SeriesEndDate == target_date,
                    )
                    .all()
                )
                for s in single_siblings:
                    deleted_ids.append(s.id)
                    db.delete(s)

        audit_detail = (
            f"스케줄 삭제(현재만): {work_name} 기준일={target_date} / "
            + (f"삭제 id={deleted_ids}" if deleted_ids else "예외 등록")
        )

    else:
        raise HTTPException(status_code=400, detail=f"알 수 없는 RepeatScope: {scope}")

    db.commit()

    write_audit(db, current_user.id, "schedule_deleted", "schedule", schedule_id,
                detail=audit_detail,
                ip_address=get_client_ip(request))

    return {
        "status": "deleted",
        "id": schedule_id,
        "scope": scope,
        "deleted_ids": deleted_ids,
    }
