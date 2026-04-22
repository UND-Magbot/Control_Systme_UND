"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import styles from "../ScheduleCrud.module.css";
import CustomSelect, { type SelectOption } from "@/app/components/select/CustomSelect";
import NumberSpinner from "./NumberSpinner";
import MiniCalendar from "./MiniCalendar";
import { AMPM_OPTIONS, HOUR_OPTIONS } from "../../constants";

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
  /** true이면 날짜 영역을 완전히 숨김 (시각만 선택) */
  hideDate?: boolean;
  /** true이면 외부 래퍼 없이 컨트롤만 렌더링 */
  inline?: boolean;
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
  hideDate,
  inline,
}: TimePickerProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarWrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null);

  const handleCloseCalendar = useCallback(() => setIsCalendarOpen(false), []);

  // 모달 overflow 클리핑 회피: 달력을 body 포털로 띄우고 trigger rect 기준으로 위치 계산
  useEffect(() => {
    if (!isCalendarOpen) { setPopoverPos(null); return; }
    const trigger = calendarWrapperRef.current;
    if (!trigger) return;
    const updatePos = () => {
      const rect = trigger.getBoundingClientRect();
      setPopoverPos({ left: rect.left, top: rect.bottom + 4 });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [isCalendarOpen]);

  // 포털 영역 포함해서 외부 클릭 판정
  useEffect(() => {
    if (!isCalendarOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (calendarWrapperRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      handleCloseCalendar();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isCalendarOpen, handleCloseCalendar]);

  const renderCalendarPortal = () => {
    if (!isCalendarOpen || dateDisabled || !popoverPos) return null;
    if (typeof document === "undefined") return null;
    return createPortal(
      <div
        ref={popoverRef}
        style={{ position: "fixed", left: popoverPos.left, top: popoverPos.top, zIndex: 1000 }}
      >
        <MiniCalendar
          value={date}
          showTodayButton
          size="modal"
          minDate={minDate}
          maxDate={maxDate}
          onPickDate={(d) => { onDateChange(d); setIsCalendarOpen(false); }}
        />
      </div>,
      document.body
    );
  };

  const ampmValue = ampm ? { id: ampm, label: ampm } : null;
  const hourValue = hour ? { id: hour, label: hour } : null;

  const timeError = errors?.ampm || errors?.hour || errors?.minute;
  const dateTimeError = errors?.dateTime;

  if (inline) {
    return (
      <div className={styles.itemDateBox}>
        <div className={styles.itemDateLabel}>{label}</div>
        {!hideDate && (
          <div
            ref={calendarWrapperRef}
            className={`${styles.itemDate} ${errors?.date ? styles.inputError : ""}`}
            style={dateDisabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}
          >
            {formatDate(date)}
            <img src="/icon/search_calendar.png" alt=""
              onClick={() => !dateDisabled && setIsCalendarOpen((v) => !v)} />
          </div>
        )}
        {renderCalendarPortal()}
        <CustomSelect options={AMPM_OPTIONS} value={ampmValue}
          onChange={(opt) => onAmpmChange(opt.label)} placeholder="오전" compact error={!!errors?.ampm} />
        <CustomSelect options={HOUR_OPTIONS} value={hourValue}
          onChange={(opt) => onHourChange(opt.label)} placeholder={HOUR_OPTIONS[0].label} compact error={!!errors?.hour} />
        <NumberSpinner value={minute !== null ? Number(minute) : null}
          onChange={(v) => onMinuteChange(String(v).padStart(2, "0"))}
          min={0} max={59} placeholder="00" error={!!errors?.minute} />
      </div>
    );
  }

  return (
    <div className={styles.itemBoxWrap}>
      <div className={styles.itemBox}>
        <div>{label === "시작" ? "작업일시" : label === "실행 일시" ? "실행 일시" : ""}</div>
        <div className={styles.itemDateBox}>
          {label !== "실행 일시" && <div className={styles.itemDateLabel}>{label}</div>}
          {!hideDate && (
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
            </div>
          )}
          {renderCalendarPortal()}
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
          <NumberSpinner
            value={minute !== null ? Number(minute) : null}
            onChange={(v) => onMinuteChange(String(v).padStart(2, "0"))}
            min={0}
            max={59}
            placeholder="00"
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
