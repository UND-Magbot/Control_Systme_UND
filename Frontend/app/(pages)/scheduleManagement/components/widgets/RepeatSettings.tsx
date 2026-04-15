"use client";

import React, { useState, useRef, useCallback } from "react";
import styles from "../ScheduleCrud.module.css";
import MiniCalendar from "./MiniCalendar";
import { useOutsideClick } from "@/app/hooks/useOutsideClick";
import { DOWS, type Dow } from "../../constants";

type RepeatSettingsProps = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  days: Dow[];
  onDaysChange: (days: Dow[]) => void;
  everyday: boolean;
  onEverydayChange: (checked: boolean) => void;
  endType: "none" | "date";
  onEndTypeChange: (type: "none" | "date") => void;
  endDate: string;
  onEndDateChange: (date: string) => void;
  formatDate: (d: Date) => string;
  errors?: {
    repeatDays?: string;
    repeatEndDate?: string;
  };
};

export default function RepeatSettings({
  enabled,
  onEnabledChange,
  days,
  onDaysChange,
  everyday,
  onEverydayChange,
  endType,
  onEndTypeChange,
  endDate,
  onEndDateChange,
  formatDate,
  errors,
}: RepeatSettingsProps) {
  const [isEndDateCalendarOpen, setIsEndDateCalendarOpen] = useState(false);
  const endDateWrapperRef = useRef<HTMLDivElement>(null);

  const handleCloseCalendar = useCallback(() => setIsEndDateCalendarOpen(false), []);
  useOutsideClick(endDateWrapperRef, handleCloseCalendar, isEndDateCalendarOpen);

  const toggleDay = (d: Dow) => {
    const exists = days.includes(d);
    const nextDays = exists ? days.filter((x) => x !== d) : [...days, d];
    onDaysChange(nextDays);
    onEverydayChange(nextDays.length === 7);
  };

  const toggleEveryday = (checked: boolean) => {
    onEverydayChange(checked);
    onDaysChange(checked ? [...DOWS] : []);
  };

  return (
    <>
      <div className={styles.itemRadioBox}>
        <div>반복설정</div>
        <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`}>
          <div
            className={styles.radioBtnBox}
            role="button"
            tabIndex={0}
            onClick={() => onEnabledChange(true)}
          >
            <img
              src={enabled ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
              alt=""
            />
            <span>반복</span>
          </div>
          <div
            className={styles.radioBtnBox}
            role="button"
            tabIndex={0}
            onClick={() => onEnabledChange(false)}
          >
            <img
              src={!enabled ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
              alt=""
            />
            <span>반복 안함</span>
          </div>
        </div>
      </div>

      {enabled && (
        <>
          <div className={styles.itemRadioBox}>
            <div>반복요일</div>
            <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`} style={{ gap: 10 }}>
              {DOWS.map((d) => {
                const active = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`${styles.repeatDayBtn} ${active ? styles.repeatDayBtnActive : ""}`}
                  >
                    {d}
                  </button>
                );
              })}
              <label className={styles.everydayBox}>
                <input
                  type="checkbox"
                  checked={everyday}
                  onChange={(e) => toggleEveryday(e.target.checked)}
                />
                <span>매일</span>
              </label>
            </div>
          </div>
          {errors?.repeatDays && (
            <div style={{ marginBottom: 16, marginLeft: 100 }}>
              <span className={styles.fieldError}>{errors.repeatDays}</span>
            </div>
          )}

          <div className={styles.itemRadioBox}>
            <div>반복종료</div>
            <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`}>
              <div
                className={styles.radioBtnBox}
                role="button"
                tabIndex={0}
                onClick={() => onEndTypeChange("none")}
              >
                <img
                  src={endType === "none" ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                  alt=""
                />
                <span>없음</span>
              </div>
              <div
                className={styles.radioBtnBox}
                role="button"
                tabIndex={0}
                onClick={() => onEndTypeChange("date")}
                style={{ gap: 10 }}
              >
                <img
                  src={endType === "date" ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                  alt=""
                />
                <span>종료 날짜</span>
                <div
                  className={`${styles.repeatEndDateBox} ${
                    endType !== "date" ? styles.repeatEndDateBoxDisabled : ""
                  } ${errors?.repeatEndDate ? styles.inputError : ""}`}
                  ref={endDateWrapperRef}
                >
                  <span className={styles.repeatEndDateText}>{endDate}</span>
                  <img
                    src="/icon/search_calendar.png"
                    alt=""
                    onClick={(e) => {
                      e.stopPropagation();
                      if (endType === "date") {
                        setIsEndDateCalendarOpen((v) => !v);
                      }
                    }}
                  />
                  {endType === "date" && isEndDateCalendarOpen && (
                    <div
                      className={styles.calendarPopover}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MiniCalendar
                        value={new Date(endDate)}
                        showTodayButton
                        size="modal"
                        onPickDate={(date) => {
                          onEndDateChange(formatDate(date));
                          setIsEndDateCalendarOpen(false);
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          {errors?.repeatEndDate && (
            <div style={{ marginBottom: 16, marginLeft: 100 }}>
              <span className={styles.fieldError}>{errors.repeatEndDate}</span>
            </div>
          )}
        </>
      )}
    </>
  );
}
