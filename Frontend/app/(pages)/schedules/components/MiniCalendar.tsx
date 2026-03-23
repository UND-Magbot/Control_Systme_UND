"use client";

import { useState, useEffect, useMemo } from "react";
import { BaseCalendar, formatDateToYMD, getToday } from "@/app/components/calendar/index";

type MiniCalendarProps = {
  value?: Date | null;
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
  size = "page",
}: MiniCalendarProps) {
  const [hasPicked, setHasPicked] = useState(false);
  const [internalDate, setInternalDate] = useState<string | null>(null);

  const selected = hasPicked
    ? (value ? formatDateToYMD(value) : internalDate)
    : null;

  const handleDateSelect = (dateStr: string) => {
    setHasPicked(true);
    setInternalDate(dateStr);
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    onPickDate?.(date);
  };

  useEffect(() => {
    setHasPicked(false);
    setInternalDate(null);
  }, [todayResetKey]);

  const calendarSize = size === "modal" ? "modal" : "compact";

  return (
    <BaseCalendar
      mode="single"
      selectedDate={selected}
      onDateSelect={handleDateSelect}
      showTodayButton={showTodayButton}
      showYearNav
      showWeekHighlight
      size={calendarSize}
    />
  );
}
