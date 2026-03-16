"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import styles from "./MiniCalendar.module.css";

type MiniCalendarProps = {
  /** WorkSchedule에서 선택한 날짜를 전달(없으면 내부 state로 운영) */
  value?: Date | null;
  /** 날짜 선택 시 WorkSchedule에 알려주기 */
  onPickDate?: (date: Date) => void;
  todayResetKey?: number;
  showTodayButton?: boolean;
  size?: "page" | "modal";
};

export default function MiniCalendar({ 
  value = null,
  onPickDate,
  todayResetKey = 0,
  showTodayButton = false,
  size = "page"
 }: MiniCalendarProps) {
  
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  // 선택 일자 및 주간 표시는 일자 선택한 시점부터 적용
  const [hasPicked, setHasPicked] = useState(false);

  // 달력에서 보고 있는 기준 월
  const [viewDate, setViewDate] = useState(new Date());

  // 달력에서 클릭한 임시 선택값
  const [tempDate, setTempDate] = useState<Date | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0~11

  type DayCell = {
    day: number;
    inMonth: boolean;
    date: Date;
  };

  const days: DayCell[] = [];

  // 이번달 1일의 요일(0=일)
  const firstDow = new Date(year, month, 1).getDay();
  // 이번달 마지막 일자
  const lastDate = new Date(year, month + 1, 0).getDate();
  // 이전달 마지막 일자
  const prevLastDate = new Date(year, month, 0).getDate();

  // 1) 앞쪽(이전달)
  for (let i = 0; i < firstDow; i++) {
    const day = prevLastDate - (firstDow - 1 - i);
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    days.push({ day, inMonth: false, date });
  }

  // 2) 이번달
  for (let d = 1; d <= lastDate; d++) {
    const date = new Date(year, month, d);
    date.setHours(0, 0, 0, 0);
    days.push({ day: d, inMonth: true, date });
  }

  // 3) 뒤쪽(다음달) - 42칸 채우기
  let nextDay = 1;
  while (days.length < 42) {
    const date = new Date(year, month + 1, nextDay);
    date.setHours(0, 0, 0, 0);
    days.push({ day: nextDay, inMonth: false, date });
    nextDay++;
  }

  const selected = hasPicked ? (value ?? tempDate) : null;

  const isSameYMD = (a: Date | null, b: Date) => {
    if (!a) return false;
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  };


  // 선택일 인덱스(42칸 중)
  const selectedIdx = selected
    ? days.findIndex((c) => isSameYMD(selected, c.date))
    : -1;

  // 선택일의 "주(행)" 인덱스
  const selectedWeekRow = selectedIdx >= 0 ? Math.floor(selectedIdx / 7) : -1;

  const weeks = useMemo(() => {
    return Array.from({ length: 6 }, (_, w) =>
      days.slice(w * 7, w * 7 + 7)
    );
  }, [days]);

  const handlePick = (date: Date) => {
    setHasPicked(true);     // ← 선택 순간부터 적용
    setTempDate(date);
    onPickDate?.(date);
  };

  // 이전년, 다음년, 이전월, 다음월 이동
  const movePrevYear = () => {
    setViewDate((prev) => new Date(prev.getFullYear() - 1, prev.getMonth(), 1));
  };

  const moveNextYear = () => {
    setViewDate((prev) => new Date(prev.getFullYear() + 1, prev.getMonth(), 1));
  };

  const movePrevMonth = () => {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const moveNextMonth = () => {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const moveToday = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    setViewDate(new Date(t.getFullYear(), t.getMonth(), 1));
    setTempDate(t);
    setHasPicked(true);
    onPickDate?.(t);
  };

  useEffect(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);

    setViewDate(new Date(t.getFullYear(), t.getMonth(), 1));
    setTempDate(t);

    setHasPicked(false);
  }, [todayResetKey]);


  return (
    <div
      ref={wrapperRef}
      className={[
        styles.calendarModal,
        size === "modal" ? styles.calendarModalModal : styles.calendarModalPage,
      ].join(" ")}
    >
    
      {/* 헤더 */}
      <div className={styles.header}>
        <button type="button" onClick={movePrevYear}>
              <div>
                  <img src="/icon/arrow-left-g.png" alt="left" />
                  <img src="/icon/arrow-left-g.png" alt="left" />
              </div>
          </button>

        <button type="button" onClick={movePrevMonth}>
          <img src="/icon/arrow-left-g.png" alt="left" />
        </button>

          <div className={styles.title}>
          {year}년 {month + 1}월
          </div>

        <button type="button" onClick={moveNextMonth}>
          <img src="/icon/arrow-right-g.png" alt="next" />
        </button>

        <button type="button" onClick={moveNextYear}>
          <div>
            <img src="/icon/arrow-right-g.png" alt="next" />
            <img src="/icon/arrow-right-g.png" alt="next" />
          </div>
        </button>

      </div>

      {/* 요일 */}
      <div className={styles.weekRow}>
          <span className={styles.sun}>일</span>
          <span>월</span>
          <span>화</span>
          <span>수</span>
          <span>목</span>
          <span>금</span>
          <span className={styles.sat}>토</span>
      </div>

      {/* 날짜 */}
      <div className={styles.daysGrid}>
        {weeks.map((week, rowIdx) => {
          const isSelectedWeek = selectedWeekRow >= 0 && rowIdx === selectedWeekRow;

          return (
            <div
              key={rowIdx}
              className={[
                styles.weekLine,
                isSelectedWeek ? styles.weekRange : "",
              ].join(" ")}
            >
              {week.map((cell) => {
                const isSelectedDay = isSameYMD(selected, cell.date);
                const isToday = isSameYMD(today, cell.date);
                const isDisabled = !cell.inMonth;

                return (
                  <button
                    key={cell.date.toISOString()}
                    type="button"
                    onClick={() => handlePick(cell.date)}
                    className={[
                      styles.dayBtn,
                      isDisabled ? styles.dayDisabled : "",
                      isSelectedDay ? styles.daySelected : "",
                      !isSelectedDay && isToday ? styles.dayToday : "",
                    ].join(" ")}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {showTodayButton && (
        <div className={styles.calendarFooter}>
        <button type="button" className={styles.todayBtn} onClick={moveToday}>
          오늘
        </button>
        </div>
      )}
    </div>
  );
}
