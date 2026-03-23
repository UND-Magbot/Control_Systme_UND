export type DayCell = {
  day: number;
  inMonth: boolean;
  date: Date;
  dateStr: string; // YYYY-MM-DD
};

export function formatDateToYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseYMD(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isSameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function getToday(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

export function getTodayStr(): string {
  return formatDateToYMD(getToday());
}

export function generateCalendarCells(viewDate: Date): DayCell[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const cells: DayCell[] = [];

  const firstDow = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const prevLastDate = new Date(year, month, 0).getDate();

  // 이전달
  for (let i = 0; i < firstDow; i++) {
    const day = prevLastDate - (firstDow - 1 - i);
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    cells.push({ day, inMonth: false, date, dateStr: formatDateToYMD(date) });
  }

  // 이번달
  for (let d = 1; d <= lastDate; d++) {
    const date = new Date(year, month, d);
    date.setHours(0, 0, 0, 0);
    cells.push({ day: d, inMonth: true, date, dateStr: formatDateToYMD(date) });
  }

  // 다음달 (42칸 채우기)
  let nextDay = 1;
  while (cells.length < 42) {
    const date = new Date(year, month + 1, nextDay);
    date.setHours(0, 0, 0, 0);
    cells.push({ day: nextDay, inMonth: false, date, dateStr: formatDateToYMD(date) });
    nextDay++;
  }

  return cells;
}
