"use client";

import React, { useState, useRef, useCallback } from "react";
import styles from "./ScheduleCrud.module.css";
import CustomSelect, { type SelectOption } from "@/app/components/select/CustomSelect";
import MiniCalendar from "./MiniCalendar";
import { useOutsideClick } from "@/app/hooks/useOutsideClick";
import { AMPM, HOURS, MINUTES } from "../constants";

const AMPM_OPTIONS: SelectOption[] = AMPM.map((v) => ({ id: v, label: v }));
const HOUR_OPTIONS: SelectOption[] = HOURS.map((h) => {
  const s = String(h).padStart(2, "0");
  return { id: s, label: s };
});
const MINUTE_OPTIONS: SelectOption[] = MINUTES.map((m) => ({ id: m, label: m }));

type TimePickerProps = {
  label: string;
  date: Date;
  onDateChange: (d: Date) => void;
  ampm: string | null;
  onAmpmChange: (v: string) => void;
  hour: string | null;
  onHourChange: (v: string) => void;
  minute: string | null;
  onMinuteChange: (v: string) => void;
  errors?: {
    ampm?: string;
    hour?: string;
    minute?: string;
    date?: string;
    dateTime?: string;
  };
  minDate?: string;
  maxDate?: string;
  formatDate: (d: Date) => string;
  /** true이면 날짜 선택 영역을 비활성화 (당일 일정 전용) */
  dateDisabled?: boolean;
};

export default function TimePicker({
  label,
  date,
  onDateChange,
  ampm,
  onAmpmChange,
  hour,
  onHourChange,
  minute,
  onMinuteChange,
  errors,
  minDate,
  maxDate,
  formatDate,
  dateDisabled,
}: TimePickerProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarWrapperRef = useRef<HTMLDivElement>(null);

  const handleCloseCalendar = useCallback(() => setIsCalendarOpen(false), []);
  useOutsideClick(calendarWrapperRef, handleCloseCalendar, isCalendarOpen);

  const ampmValue = ampm ? { id: ampm, label: ampm } : null;
  const hourValue = hour ? { id: hour, label: hour } : null;
  const minuteValue = minute ? { id: minute, label: minute } : null;

  const timeError = errors?.ampm || errors?.hour || errors?.minute;
  const dateTimeError = errors?.dateTime;

  return (
    <div className={styles.itemBoxWrap}>
      <div className={styles.itemBox}>
        <div>{label === "시작" ? "작업일시" : ""}</div>
        <div className={styles.itemDateBox}>
          <div className={styles.itemDateLabel}>{label}</div>
          <div
            ref={calendarWrapperRef}
            className={`${styles.itemDate} ${errors?.date ? styles.inputError : ""}`}
            style={dateDisabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}
          >
            {formatDate(date)}
            <img
              src="/icon/search_calendar.png"
              alt=""
              onClick={() => !dateDisabled && setIsCalendarOpen((v) => !v)}
            />
            {isCalendarOpen && !dateDisabled && (
              <div className={styles.calendarPopover}>
                <MiniCalendar
                  value={date}
                  showTodayButton
                  size="modal"
                  minDate={minDate}
                  maxDate={maxDate}
                  onPickDate={(d) => {
                    onDateChange(d);
                    setIsCalendarOpen(false);
                  }}
                />
              </div>
            )}
          </div>
          <CustomSelect
            options={AMPM_OPTIONS}
            value={ampmValue}
            onChange={(opt) => onAmpmChange(opt.label)}
            placeholder="오전"
            compact
            error={!!errors?.ampm}
          />
          <CustomSelect
            options={HOUR_OPTIONS}
            value={hourValue}
            onChange={(opt) => onHourChange(opt.label)}
            placeholder={HOUR_OPTIONS[0].label}
            compact
            error={!!errors?.hour}
          />
          <CustomSelect
            options={MINUTE_OPTIONS}
            value={minuteValue}
            onChange={(opt) => onMinuteChange(opt.label)}
            placeholder={MINUTE_OPTIONS[0].label}
            compact
            error={!!errors?.minute}
          />
        </div>
      </div>
      {(timeError || dateTimeError) && (
        <span className={styles.fieldError}>
          {dateTimeError || timeError}
        </span>
      )}
    </div>
  );
}
