"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./Calendar.module.css";
import { BaseCalendar, formatDateToYMD, parseYMD } from "@/app/components/calendar/index";
import type { VideoItem, Period, ActiveField } from '@/app/type';

type Props = {
  videoData: VideoItem[];
  selectedVideo: { label: string } | null;
  selectedRobot: { no: string } | null;
  onFilteredChange: (data: VideoItem[]) => void;
  selectedPeriod: Period;
  onChangePeriod: (period: Period | null) => void;
  externalStartDate?: string | null;
  externalEndDate?: string | null;
};

export default function VideoDateRange({
  videoData,
  selectedVideo,
  selectedRobot,
  onFilteredChange,
  selectedPeriod,
  onChangePeriod,
  externalStartDate,
  externalEndDate,
}: Props) {

  const today = new Date();
  const [startDate, setStartDate] = useState(formatDateToYMD(today));
  const [endDate, setEndDate] = useState(formatDateToYMD(today));
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 캘린더에서 날짜 선택 시
  const handleRangeSelect = (field: "start" | "end", date: string) => {
    let nextStart = startDate;
    let nextEnd = endDate;

    if (field === "start") {
      nextStart = date;
      setStartDate(date);
    } else {
      nextEnd = date;
      setEndDate(date);
    }

    syncPeriodWithRange(nextStart, nextEnd, onChangePeriod);
    setIsCalendarOpen(false);
    setActiveField(null);
  };

  const openCalendar = (field: ActiveField) => {
    setActiveField(field);
    setIsCalendarOpen(true);
  };

  // videoData에서 가장 오래된 날짜 구하기
  const getEarliestVideoDate = (videoData: VideoItem[]): string | null => {
    if (!videoData || videoData.length === 0) return null;
    const earliest = videoData.reduce<Date | null>((earliest, item) => {
      const d = new Date(item.date);
      if (isNaN(d.getTime())) return earliest;
      if (!earliest) return d;
      return d < earliest ? d : earliest;
    }, null);
    return earliest ? formatDateToYMD(earliest) : null;
  };

  const earliestVideoDateStr = getEarliestVideoDate(videoData);

  // 현재 start/end 범위가 1주/1달/1년 중 무엇인지 확인
  function syncPeriodWithRange(
    startStr: string,
    endStr: string,
    onChangePeriod: (period: Period | null) => void
  ) {
    const today = new Date();
    const todayStr = formatDateToYMD(today);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(today);
    monthStart.setMonth(monthStart.getMonth() - 1);
    const yearStart = new Date(today);
    yearStart.setFullYear(yearStart.getFullYear() - 1);

    let nextPeriod: Period | null = null;
    if (startStr === formatDateToYMD(weekStart) && endStr === todayStr) {
      nextPeriod = "1week";
    } else if (startStr === formatDateToYMD(monthStart) && endStr === todayStr) {
      nextPeriod = "1month";
    } else if (startStr === formatDateToYMD(yearStart) && endStr === todayStr) {
      nextPeriod = "1year";
    }
    onChangePeriod(nextPeriod);
  }

  // 비디오 타입 / 로봇 / 날짜 범위 필터링
  useEffect(() => {
    const baseFiltered = videoData.filter((item) => {
      const matchVideo = selectedVideo ? item.cameraType === selectedVideo.label : true;
      const matchRobot = selectedRobot ? item.robotNo === selectedRobot.no : true;
      return matchVideo && matchRobot;
    });

    if (!startDate || !endDate) {
      onFilteredChange(baseFiltered);
      return;
    }

    const filtered = baseFiltered.filter((item) => {
      const itemDate = new Date(item.date);
      if (isNaN(itemDate.getTime())) return false;
      let start = new Date(startDate);
      let end = new Date(endDate);
      if (start > end) { const tmp = start; start = end; end = tmp; }
      end.setHours(23, 59, 59, 999);
      return itemDate >= start && itemDate <= end;
    });

    onFilteredChange(filtered);
  }, [videoData, selectedVideo, selectedRobot, startDate, endDate, onFilteredChange]);

  // 기간 버튼 클릭 시 시작일/종료일 자동 변경
  useEffect(() => {
    if (!selectedPeriod) return;
    const today = new Date();
    const start = new Date(today);

    if (selectedPeriod === '1week') start.setDate(start.getDate() - 7);
    else if (selectedPeriod === '1month') start.setMonth(start.getMonth() - 1);
    else if (selectedPeriod === '1year') start.setFullYear(start.getFullYear() - 1);

    setStartDate(formatDateToYMD(start));
    setEndDate(formatDateToYMD(today));
  }, [selectedPeriod]);

  // 외부 클릭 닫기
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsCalendarOpen(false);
        setActiveField(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // 외부 날짜 동기화
  useEffect(() => {
    if (externalStartDate) setStartDate(externalStartDate);
    if (externalEndDate) setEndDate(externalEndDate);
  }, [externalStartDate, externalEndDate]);

  // 현재 activeField 기준 initialViewDate
  const calendarInitialDate = activeField === "start"
    ? parseYMD(startDate)
    : activeField === "end"
      ? parseYMD(endDate)
      : new Date();

  return (
    <div className={styles.wrapper}>
      <div className={styles.videoDate}>
        <div
          className={`${styles.startDate} ${activeField === "start" ? styles.activeBtn : ""}`}
          onClick={() => openCalendar("start")}
        >
          <div>{startDate}</div>
          <img src="/icon/search_calendar.png" alt="calendar" />
        </div>
        <div>~</div>
        <div
          className={`${styles.endDate} ${activeField === "end" ? styles.activeBtn : ""}`}
          onClick={() => openCalendar("end")}
        >
          <div>{endDate}</div>
          <img src="/icon/search_calendar.png" alt="calendar" />
        </div>
      </div>

      {/* 달력 모달 — BaseCalendar 사용 */}
      {isCalendarOpen && activeField && (
        <div ref={wrapperRef} className={styles.calendarOverlay}>
          <BaseCalendar
            mode="range"
            startDate={startDate}
            endDate={endDate}
            activeField={activeField}
            onRangeSelect={handleRangeSelect}
            minDate={earliestVideoDateStr}
            showTodayButton
            initialViewDate={calendarInitialDate}
          />
        </div>
      )}
    </div>
  );
}
