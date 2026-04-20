/** YYYY-MM-DD 형식. */
export function periodFormatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "mm:ss" 또는 "hh:mm:ss" 입력을 "1h 23m 45s" 형태로 변환. */
export function formatVideoTime(time: string): string {
  const parts = time.split(":").map(Number);
  const hh = parts.length >= 3 ? (parts[0] || 0) : 0;
  const mm = parts.length >= 3 ? (parts[1] || 0) : (parts[0] || 0);
  const ss = parts.length >= 3 ? (parts[2] || 0) : (parts[1] || 0);

  let result = "";
  if (hh > 0) result += `${hh}h `;
  if (mm > 0 || hh > 0) result += `${mm}m `;
  result += `${ss}s`;
  return result.trim();
}

/** ISO datetime → "YYYY.MM.DD hh:mm.ss" */
export function videoFormatDate(datetime: string): string {
  const date = new Date(datetime);
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}.${MM}.${dd} ${hh}:${mm}.${ss}`;
}

/** 선택 기간에 대한 직전 같은 길이 기간을 계산 (통계 비교용).
 *  기간이 365일 초과면 null 반환 (비교 의미 없음). */
export function calcPrevPeriod(
  start: string | null,
  end: string | null,
): { prevStart: string; prevEnd: string } | null {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  const diffMs = e.getTime() - s.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays > 365) return null;

  const prevEnd = new Date(s);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - diffDays);

  return { prevStart: periodFormatDate(prevStart), prevEnd: periodFormatDate(prevEnd) };
}
