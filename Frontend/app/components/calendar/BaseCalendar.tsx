"use client";

import { useState, useMemo } from "react";
import styles from "./BaseCalendar.module.css";
import { generateCalendarCells, formatDateToYMD, isSameDay, getToday, parseYMD } from "./utils";
import type { DayCell } from "./utils";

type BaseCalendarProps = {
  mode: "single" | "range";

  // 단일 모드
  selectedDate?: string | null;
  onDateSelect?: (date: string) => void;

  // 범위 모드
  startDate?: string | null;
  endDate?: string | null;
  activeField?: "start" | "end" | null;
  onRangeSelect?: (field: "start" | "end", date: string) => void;

  // 공통 옵션
  minDate?: string | null;
  maxDate?: string | null;
  showTodayButton?: boolean;
  showYearNav?: boolean;
  showWeekHighlight?: boolean;
  size?: "compact" | "default" | "modal";

  // 외부에서 viewDate 제어 (선택적)
  initialViewDate?: Date;

  footer?: React.ReactNode;
};

export default function BaseCalendar({
  mode,
  selectedDate,
  onDateSelect,
  startDate,
  endDate,
  activeField,
  onRangeSelect,
  minDate,
  maxDate,
  showTodayButton = false,
  showYearNav = false,
  showWeekHighlight = false,
  size = "default",
  initialViewDate,
  footer,
}: BaseCalendarProps) {
  const today = useMemo(() => getToday(), []);

  const [viewDate, setViewDate] = useState(
    initialViewDate ?? new Date()
  );

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const cells = useMemo(() => generateCalendarCells(viewDate), [viewDate]);

  // 네비게이션
  const movePrevMonth = () =>
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const moveNextMonth = () =>
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  const movePrevYear = () =>
    setViewDate((prev) => new Date(prev.getFullYear() - 1, prev.getMonth(), 1));
  const moveNextYear = () =>
    setViewDate((prev) => new Date(prev.getFullYear() + 1, prev.getMonth(), 1));
  const moveToday = () => {
    const t = getToday();
    setViewDate(new Date(t.getFullYear(), t.getMonth(), 1));
    if (mode === "single") {
      onDateSelect?.(formatDateToYMD(t));
    }
  };

  // range 모드: 시작~종료 사이 판별
  const rangeStart = startDate ? parseYMD(startDate) : null;
  const rangeEnd = endDate ? parseYMD(endDate) : null;
  const isInRange = (cell: DayCell): boolean => {
    if (mode !== "range" || !rangeStart || !rangeEnd) return false;
    const s = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const e = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    return cell.date > s && cell.date < e;
  };

  // single 모드: 선택된 날짜
  const selectedParsed = selectedDate ? parseYMD(selectedDate) : null;

  // 주간 하이라이트 (single 모드)
  const selectedIdx = selectedParsed
    ? cells.findIndex((c) => isSameDay(selectedParsed, c.date))
    : -1;
  const selectedWeekRow = selectedIdx >= 0 ? Math.floor(selectedIdx / 7) : -1;

  // minDate / maxDate 파싱
  const minParsed = minDate ? parseYMD(minDate) : null;
  const maxParsed = maxDate ? parseYMD(maxDate) : null;

  const handleDayClick = (cell: DayCell) => {
    if (minParsed && cell.date < minParsed) return;
    if (maxParsed && cell.date > maxParsed) return;

    if (mode === "single") {
      onDateSelect?.(cell.dateStr);
    } else if (mode === "range" && activeField) {
      onRangeSelect?.(activeField, cell.dateStr);
    }
  };

  const sizeClass =
    size === "compact" ? styles.sizeCompact
      : size === "modal" ? styles.sizeModal
        : styles.sizeDefault;

  // 주간 행 렌더링 vs 플랫 렌더링
  const useWeekRows = mode === "single" && showWeekHighlight;
  const weeks = useWeekRows
    ? Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
    : null;

  const renderDayButton = (cell: DayCell, key: string | number) => {
    const isMinDisabled = minParsed ? cell.date < minParsed : false;
    const isMaxDisabled = maxParsed ? cell.date > maxParsed : false;
    const isSelectedSingle = mode === "single" && selectedParsed && isSameDay(selectedParsed, cell.date);
    const isRangeStart = mode === "range" && rangeStart && isSameDay(rangeStart, cell.date);
    const isRangeEnd = mode === "range" && rangeEnd && isSameDay(rangeEnd, cell.date);
    const isSelected = isSelectedSingle || isRangeStart || isRangeEnd;
    const isDay = isSameDay(today, cell.date);
    const inRange = isInRange(cell);

    const isDateDisabled = isMinDisabled || isMaxDisabled;

    const classNames = [
      styles.dayBtn,
      isDateDisabled ? styles.dayMinDisabled
        : isSelected ? styles.daySelected
          : inRange ? styles.dayInRange
            : !cell.inMonth ? styles.dayOutside
              : "",
      !isDateDisabled && isDay ? styles.dayToday : "",
    ].filter(Boolean).join(" ");

    return (
      <button
        key={key}
        type="button"
        disabled={isDateDisabled}
        className={classNames}
        onClick={() => handleDayClick(cell)}
      >
        {cell.day}
      </button>
    );
  };

  return (
    <div className={`${styles.calendar} ${sizeClass}`}>
      {/* 헤더 */}
      <div className={styles.header}>
        {showYearNav && (
          <button type="button" onClick={movePrevYear}>
            <div>
              <img src="/icon/arrow-left-g.png" alt="prev year" />
              <img src="/icon/arrow-left-g.png" alt="" />
            </div>
          </button>
        )}
        <button type="button" onClick={movePrevMonth}>
          <img src="/icon/arrow-left-g.png" alt="prev" />
        </button>
        <div className={styles.title}>
          {year}년 {month + 1}월
        </div>
        <button type="button" onClick={moveNextMonth}>
          <img src="/icon/arrow-right-g.png" alt="next" />
        </button>
        {showYearNav && (
          <button type="button" onClick={moveNextYear}>
            <div>
              <img src="/icon/arrow-right-g.png" alt="next year" />
              <img src="/icon/arrow-right-g.png" alt="" />
            </div>
          </button>
        )}
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
      {useWeekRows && weeks ? (
        <div>
          {weeks.map((week, rowIdx) => (
            <div
              key={rowIdx}
              className={[
                styles.weekLine,
                selectedWeekRow >= 0 && rowIdx === selectedWeekRow ? styles.weekRange : "",
              ].join(" ")}
            >
              {week.map((cell) => renderDayButton(cell, cell.dateStr))}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.daysGrid}>
          {cells.map((cell, idx) => renderDayButton(cell, idx))}
        </div>
      )}

      {/* 하단 */}
      {(showTodayButton || footer) && (
        <div className={styles.footer}>
          {showTodayButton && (
            <button type="button" className={styles.todayBtn} onClick={moveToday}>
              오늘
            </button>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
