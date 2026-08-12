// 회차(occurrence) 상태 판정의 단일 출처.
//
// ScheduleInfo.TaskStatus 는 **시리즈 row 하나**에 붙은 값인데, 화면들은 **회차**를 보여준다.
// 회차별 상태를 저장하는 곳이 없어 각 화면이 따로 추론하다 보니 규칙이 갈라졌다 —
// 캘린더는 '대기', 상세 모달은 '진행중' 같은 모순이 그래서 생긴다.
//
// 시간축으로 나누면 이렇다.
//   · 과거 : ScheduleRun 이 정본 (아직 화면이 보지 않는다 → 잠정적으로 시리즈 상태)
//   · 오늘 : TaskStatus 가 유효
//   · 미래 : 정의상 '대기'. 아직 일어나지 않았다

/** 사람이 그 날짜를 콕 집어 끈 것이라 시간과 무관하게 유지되는 상태 */
const DATE_PINNED = new Set(["취소"]);

function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 그 회차를 화면에 어떤 상태로 보여줄 것인가.
 *
 * @param seriesStatus 시리즈 원본 TaskStatus
 * @param occurrenceDate 회차 날짜 (Date 또는 "YYYY-MM-DD")
 */
export function resolveOccurrenceStatus(
  seriesStatus: string,
  occurrenceDate: Date | string | null | undefined,
  today: Date = new Date(),
): string {
  if (!occurrenceDate) return seriesStatus;
  if (DATE_PINNED.has(seriesStatus)) return seriesStatus;

  const ymd = typeof occurrenceDate === "string" ? occurrenceDate : toYmd(occurrenceDate);
  return ymd > toYmd(today) ? "대기" : seriesStatus;
}

/** 이 회차가 아직 오지 않았는가 — 수정 차단 판정 등에서 쓴다 */
export function isFutureOccurrence(
  occurrenceDate: Date | string | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!occurrenceDate) return false;
  const ymd = typeof occurrenceDate === "string" ? occurrenceDate : toYmd(occurrenceDate);
  return ymd > toYmd(today);
}
