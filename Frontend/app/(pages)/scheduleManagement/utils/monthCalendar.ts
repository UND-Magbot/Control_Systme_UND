import { formatDate } from './datetime';

export type MonthDayCell = {
  date: Date;
  day: number;
  inMonth: boolean;
  key: string; // YYYY-MM-DD
};

/** 월간 달력 그리드(5주 또는 6주) 셀을 생성. */
export function buildMonthCells(viewDate: Date): { cells: MonthDayCell[]; weeks: number } {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0~11

  const firstDow = new Date(year, month, 1).getDay();      // 0=일
  const lastDate = new Date(year, month + 1, 0).getDate(); // 이번달 마지막 일
  const prevLast = new Date(year, month, 0).getDate();     // 전달 마지막 일

  // 이번 달이 달력 그리드에 차지하는 실제 칸 수
  const usedCells = firstDow + lastDate;
  const weeks = Math.ceil(usedCells / 7); // 5 또는 6(드물게 4도 가능하지만 보통 5/6)
  const totalCells = weeks * 7;

  const cells: MonthDayCell[] = [];

  // 1) 앞쪽(이전달)
  for (let i = 0; i < firstDow; i++) {
    const day = prevLast - (firstDow - 1 - i);
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    cells.push({ date, day, inMonth: false, key: formatDate(date) });
  }

  // 2) 이번달
  for (let d = 1; d <= lastDate; d++) {
    const date = new Date(year, month, d);
    date.setHours(0, 0, 0, 0);
    cells.push({ date, day: d, inMonth: true, key: formatDate(date) });
  }

  // 3) 뒤쪽(다음달) - totalCells 맞춰 채우기
  let nextDay = 1;
  while (cells.length < totalCells) {
    const date = new Date(year, month + 1, nextDay++);
    date.setHours(0, 0, 0, 0);
    cells.push({ date, day: date.getDate(), inMonth: false, key: formatDate(date) });
  }

  return { cells, weeks };
}
