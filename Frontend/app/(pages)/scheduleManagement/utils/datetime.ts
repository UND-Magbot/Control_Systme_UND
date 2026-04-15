export const pad2 = (n: number) => String(n).padStart(2, '0');

export const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
};

export function minToHm(min: number): { h: number; m: number } {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { h, m };
}

export function hmToMin(h: number, m: number): number {
  return h * 60 + m;
}

export function toAmpmHour(h24: number): { ampm: '오전' | '오후'; h12: number } {
  const ampm = h24 < 12 ? '오전' : '오후';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { ampm, h12 };
}

export function fromAmpmHour(ampm: string, h12: number): number {
  // 12AM=0, 12PM=12
  if (ampm === '오전') return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

/** "YYYY-MM-DD" 문자열을 로컬 자정 기준 Date로 파싱 */
export function parseYmdDate(value: string): Date {
  const parts = value.split('-');
  if (parts.length !== 3) return new Date(value);

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (!year || !month || !day) return new Date(value);

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** "오전 9시" 형태 시간 라벨 */
export function hourLabel(h: number): string {
  const ampm = h < 12 ? '오전' : '오후';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${display}시`;
}

/** "오후5:31" 같은 분 단위 시간 라벨 */
export function timeLabel(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ampm = h < 12 ? '오전' : '오후';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${ampm}${display}:${pad2(m)}`;
}
