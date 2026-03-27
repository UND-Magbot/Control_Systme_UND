/**
 * 반복 스케줄을 달력 표시 범위 내 개별 인스턴스로 확장하는 유틸리티
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
};

export type ExpandedSchedule = DBSchedule & {
  _virtualDate: Date;
  _isVirtual: boolean;
  _originalId: number;
};

/**
 * 반복 스케줄을 rangeStart~rangeEnd 범위 내 개별 날짜 인스턴스로 확장한다.
 * 비반복 스케줄은 StartDate가 범위 안에 있으면 그대로 반환.
 */
export function expandRepeatSchedules(
  schedules: DBSchedule[],
  rangeStart: Date,
  rangeEnd: Date,
): ExpandedSchedule[] {
  const result: ExpandedSchedule[] = [];

  for (const schedule of schedules) {
    const startDate = new Date(schedule.StartDate);

    // 비반복 스케줄: 기존 로직 유지 (StartDate가 범위 안에 있으면 포함)
    if (schedule.Repeat !== "Y" || !schedule.Repeat_Day) {
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
      continue;
    }

    // 반복 스케줄: Repeat_Day 파싱
    const repeatDayNums = new Set(
      schedule.Repeat_Day.split(",")
        .map((d) => KOREAN_DAY_TO_JS[d.trim()])
        .filter((n) => n !== undefined)
    );

    if (repeatDayNums.size === 0) continue;

    // 반복 종료일 결정
    const repeatEnd = schedule.Repeat_End
      ? new Date(schedule.Repeat_End)
      : null;

    // 순회 시작: max(StartDate, rangeStart)
    const iterStart = new Date(Math.max(startDate.getTime(), rangeStart.getTime()));
    iterStart.setHours(0, 0, 0, 0);

    // 순회 종료: min(Repeat_End, rangeEnd)
    const iterEndTime = repeatEnd
      ? Math.min(repeatEnd.getTime(), rangeEnd.getTime())
      : rangeEnd.getTime();
    const iterEnd = new Date(iterEndTime);
    iterEnd.setHours(23, 59, 59, 999);

    // 원본의 시간 오프셋 (시:분:초) 보존용
    const origStart = new Date(schedule.StartDate);
    const origEnd = new Date(schedule.EndDate);
    const startHours = origStart.getHours();
    const startMinutes = origStart.getMinutes();
    const startSeconds = origStart.getSeconds();
    const endHours = origEnd.getHours();
    const endMinutes = origEnd.getMinutes();
    const endSeconds = origEnd.getSeconds();

    // 날짜별 순회
    const cursor = new Date(iterStart);
    while (cursor <= iterEnd) {
      if (repeatDayNums.has(cursor.getDay())) {
        const virtualStart = new Date(cursor);
        virtualStart.setHours(startHours, startMinutes, startSeconds, 0);

        const virtualEnd = new Date(cursor);
        virtualEnd.setHours(endHours, endMinutes, endSeconds, 0);

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

  return result;
}

/**
 * 확장된 이벤트 ID에서 원본 DB ID를 추출한다.
 * "5_2026-03-28" → "5", "5" → "5"
 */
export function extractOriginalId(eventId: string): string {
  const idx = eventId.indexOf("_");
  return idx >= 0 ? eventId.substring(0, idx) : eventId;
}
