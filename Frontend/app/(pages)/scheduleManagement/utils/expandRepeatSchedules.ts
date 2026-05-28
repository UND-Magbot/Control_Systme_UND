/**
 * 반복 스케줄을 달력 표시 범위 내 개별 인스턴스로 확장하는 유틸리티
 * 3모드 지원: once, weekly, interval
 */

/** 한글 요일 → JS Date.getDay() 매핑 */
const KOREAN_DAY_TO_JS: Record<string, number> = {
  "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6,
};

export type DBSchedule = {
  id: number;
  RobotName: string;
  WorkName: string;
  TaskType: string;
  StartDate: string;
  EndDate: string;
  TaskStatus: string;
  WayName: string;
  Repeat: string;
  Repeat_Day: string | null;
  Repeat_End: string | null;
  // 3모드 필드
  ScheduleMode?: string;
  ExecutionTime?: string | null;
  IntervalMinutes?: number | null;
  ActiveStartTime?: string | null;
  ActiveEndTime?: string | null;
  SeriesStartDate?: string | null;
  SeriesEndDate?: string | null;
  SeriesExceptions?: string | null;  // "YYYY-MM-DD,YYYY-MM-DD" — 'this' 범위 수정으로 스킵된 날짜
};

export type ExpandedSchedule = DBSchedule & {
  _virtualDate: Date;
  _isVirtual: boolean;
  _originalId: number;
};

/** Repeat_Day 문자열을 JS weekday 숫자 Set으로 파싱 */
function parseRepeatDays(repeatDay: string | null): Set<number> {
  if (!repeatDay) return new Set();
  return new Set(
    repeatDay.split(",")
      .map((d) => KOREAN_DAY_TO_JS[d.trim()])
      .filter((n) => n !== undefined)
  );
}

/** 시간 문자열 "HH:MM" → { hours, minutes } */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

/** "YYYY-MM-DD" 날짜 문자열을 로컬 시간으로 파싱 (UTC 파싱 방지) */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 스케줄을 rangeStart~rangeEnd 범위 내 개별 날짜 인스턴스로 확장한다.
 */
export function expandRepeatSchedules(
  schedules: DBSchedule[],
  rangeStart: Date,
  rangeEnd: Date,
): ExpandedSchedule[] {
  const result: ExpandedSchedule[] = [];

  for (const schedule of schedules) {
    // Repeat 플래그 우선 판별 (API에서 ScheduleMode 미포함 시 대비)
    let mode: string;
    if (schedule.Repeat === "Y") {
      mode = (schedule.ScheduleMode === "weekly" || schedule.ScheduleMode === "interval")
        ? schedule.ScheduleMode
        : "weekly";
    } else {
      mode = schedule.ScheduleMode || "once";
    }

    if (mode === "once") {
      expandOnce(schedule, rangeStart, rangeEnd, result);
    } else if (mode === "weekly") {
      expandWeekly(schedule, rangeStart, rangeEnd, result);
    } else if (mode === "interval") {
      expandInterval(schedule, rangeStart, rangeEnd, result);
    }
  }

  return result;
}

/** 단일 실행: StartDate가 범위 안에 있으면 포함 */
function expandOnce(
  schedule: DBSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  result: ExpandedSchedule[],
) {
  const startDate = new Date(schedule.StartDate);
  const dateOnly = new Date(startDate);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly >= rangeStart && dateOnly <= rangeEnd) {
    result.push({
      ...schedule,
      _virtualDate: startDate,
      _isVirtual: false,
      _originalId: schedule.id,
    });
  }
}

/**
 * 요일반복 다중시각: 원본 TaskStatus로부터 각 가상 인스턴스의 상태를 추론.
 * - 오늘이 아닌 날짜의 인스턴스 → 원본 상태 그대로 (대기/완료 등)
 * - 오늘 날짜의 인스턴스:
 *   · 원본이 "진행중"/"진행" → 현재 시각에 가장 가까운(직전~현재) 인스턴스만 "진행중", 이전은 "완료", 이후는 "대기"
 *   · 원본이 "대기" → 전부 "대기"
 *   · 원본이 "완료" → 전부 "완료"
 */
function inferVirtualStatus(
  originalStatus: string,
  virtualMin: number,
  allExecMins: number[],
  isToday: boolean,
): string {
  if (!isToday) return originalStatus;
  const isActive = originalStatus === "진행중" || originalStatus === "진행";
  if (!isActive) return originalStatus;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sorted = [...allExecMins].sort((a, b) => a - b);

  // 현재 시각 이하인 시각 중 가장 마지막 = 현재 실행 중인 시각
  let currentRunMin = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i] <= nowMin) { currentRunMin = sorted[i]; break; }
  }

  if (virtualMin === currentRunMin) return "진행중";
  if (virtualMin < currentRunMin) return "완료";
  return "대기"; // 미래 시각
}

/** 요일 반복: 매칭 요일마다 실행 시각으로 인스턴스 생성 */
function expandWeekly(
  schedule: DBSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  result: ExpandedSchedule[],
) {
  const repeatDayNums = parseRepeatDays(schedule.Repeat_Day);
  if (repeatDayNums.size === 0) return;

  // 시리즈 시작/종료 (로컬 시간으로 파싱)
  const seriesStart = schedule.SeriesStartDate
    ? parseLocalDate(schedule.SeriesStartDate)
    : new Date(schedule.StartDate);
  seriesStart.setHours(0, 0, 0, 0);

  const seriesEnd = schedule.SeriesEndDate
    ? parseLocalDate(schedule.SeriesEndDate)
    : schedule.Repeat_End
      ? parseLocalDate(schedule.Repeat_End)
      : null;
  if (seriesEnd) seriesEnd.setHours(23, 59, 59, 999);

  // 다중 시각 파싱 ("09:00,13:00,18:00" → [{hours,minutes}, ...]) + 정렬
  const execTimes: { hours: number; minutes: number }[] = [];
  if (schedule.ExecutionTime) {
    for (const t of schedule.ExecutionTime.split(",")) {
      execTimes.push(parseTime(t.trim()));
    }
  } else {
    const origStart = new Date(schedule.StartDate);
    execTimes.push({ hours: origStart.getHours(), minutes: origStart.getMinutes() });
  }
  execTimes.sort((a, b) => (a.hours * 60 + a.minutes) - (b.hours * 60 + b.minutes));

  const allExecMins = execTimes.map((et) => et.hours * 60 + et.minutes);
  // 각 인스턴스의 표시 지속시간(분): 다음 시각과의 간격, 최대 30분, 최소 1분
  const DEFAULT_DURATION_MIN = 30;
  const durations = allExecMins.map((m, i) => {
    if (i === allExecMins.length - 1) return DEFAULT_DURATION_MIN;
    const gap = allExecMins[i + 1] - m;
    return Math.max(1, Math.min(DEFAULT_DURATION_MIN, gap - 1));
  });
  const todayStr = new Date().toISOString().slice(0, 10);

  // this 범위 편집으로 스킵된 날짜 집합
  const exceptionSet = new Set<string>(
    (schedule.SeriesExceptions || "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
  );

  // 순회 범위
  const iterStart = new Date(Math.max(seriesStart.getTime(), rangeStart.getTime()));
  iterStart.setHours(0, 0, 0, 0);
  const iterEndTime = seriesEnd
    ? Math.min(seriesEnd.getTime(), rangeEnd.getTime())
    : rangeEnd.getTime();
  const iterEnd = new Date(iterEndTime);
  iterEnd.setHours(23, 59, 59, 999);

  const cursor = new Date(iterStart);
  while (cursor <= iterEnd) {
    if (repeatDayNums.has(cursor.getDay())) {
      const cursorStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      if (exceptionSet.has(cursorStr)) { cursor.setDate(cursor.getDate() + 1); continue; }
      const isToday = cursorStr === todayStr;

      for (let i = 0; i < execTimes.length; i++) {
        const et = execTimes[i];
        const virtualStart = new Date(cursor);
        virtualStart.setHours(et.hours, et.minutes, 0, 0);
        const virtualEnd = new Date(virtualStart.getTime() + durations[i] * 60 * 1000);
        const virtualMin = et.hours * 60 + et.minutes;

        const status = inferVirtualStatus(schedule.TaskStatus, virtualMin, allExecMins, isToday);

        result.push({
          ...schedule,
          StartDate: virtualStart.toISOString(),
          EndDate: virtualEnd.toISOString(),
          TaskStatus: status,
          _virtualDate: virtualStart,
          _isVirtual: true,
          _originalId: schedule.id,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
}

/** 주기 반복: 매칭 날짜마다 ActiveStartTime~ActiveEndTime 시간대 밴드 생성 */
function expandInterval(
  schedule: DBSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  result: ExpandedSchedule[],
) {
  const repeatDayNums = parseRepeatDays(schedule.Repeat_Day);

  const seriesStart = schedule.SeriesStartDate
    ? parseLocalDate(schedule.SeriesStartDate)
    : new Date(schedule.StartDate);
  seriesStart.setHours(0, 0, 0, 0);

  const seriesEnd = schedule.SeriesEndDate
    ? parseLocalDate(schedule.SeriesEndDate)
    : schedule.Repeat_End
      ? parseLocalDate(schedule.Repeat_End)
      : null;
  if (seriesEnd) seriesEnd.setHours(23, 59, 59, 999);

  const { hours: startH, minutes: startM } = parseTime(schedule.ActiveStartTime || "00:00");
  const { hours: endH, minutes: endM } = parseTime(schedule.ActiveEndTime || "23:59");

  const exceptionSet = new Set<string>(
    (schedule.SeriesExceptions || "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
  );

  // 순회 범위
  const iterStart = new Date(Math.max(seriesStart.getTime(), rangeStart.getTime()));
  iterStart.setHours(0, 0, 0, 0);
  const iterEndTime = seriesEnd
    ? Math.min(seriesEnd.getTime(), rangeEnd.getTime())
    : rangeEnd.getTime();
  const iterEnd = new Date(iterEndTime);
  iterEnd.setHours(23, 59, 59, 999);

  const cursor = new Date(iterStart);
  while (cursor <= iterEnd) {
    const dayMatch = repeatDayNums.size === 0 || repeatDayNums.has(cursor.getDay());
    const cursorStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (dayMatch && !exceptionSet.has(cursorStr)) {
      const virtualStart = new Date(cursor);
      virtualStart.setHours(startH, startM, 0, 0);
      const virtualEnd = new Date(cursor);
      virtualEnd.setHours(endH, endM, 0, 0);
      // 자정 넘김: 종료가 시작보다 앞이면 다음날까지
      if (virtualEnd <= virtualStart) {
        virtualEnd.setDate(virtualEnd.getDate() + 1);
      }

      result.push({
        ...schedule,
        StartDate: virtualStart.toISOString(),
        EndDate: virtualEnd.toISOString(),
        _virtualDate: virtualStart,
        _isVirtual: true,
        _originalId: schedule.id,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
}

/**
 * 확장된 이벤트 ID에서 원본 DB ID를 추출한다.
 * "5_2026-03-28" → "5", "5" → "5"
 */
export function extractOriginalId(eventId: string): string {
  const idx = eventId.indexOf("_");
  return idx >= 0 ? eventId.substring(0, idx) : eventId;
}
