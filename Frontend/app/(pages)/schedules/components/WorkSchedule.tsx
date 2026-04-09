"use client";

import styles from './WorkSchedule.module.css';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import MiniCalendar from './MiniCalendar';
import ScheduleInsert from './ScheduleInsert';
import ScheduleDetail from './ScheduleDetail';
import type { RobotRowData } from '@/app/type';
import { mockScheduleRows, type ScheduleStatus } from "@/app/mock/schedule_data";
import { apiFetch } from "@/app/lib/api";
import { expandRepeatSchedules, extractOriginalId, type DBSchedule } from "../utils/expandRepeatSchedules";

// ===== 반복 스케줄 테스트용 Mock 데이터 =====
const MOCK_SCHEDULES: DBSchedule[] = [
    {
        id: 901,
        RobotName: "Robot 1",
        WorkName: "월수금 순찰",
        TaskType: "task1",
        StartDate: "2026-03-23T09:00:00",
        EndDate: "2026-03-23T10:30:00",
        TaskStatus: "대기",
        WayName: "A구역",
        Repeat: "Y",
        Repeat_Day: "월,수,금",
        Repeat_End: "2026-04-30",
    },
    {
        id: 902,
        RobotName: "Robot 2",
        WorkName: "화목 배송",
        TaskType: "task2",
        StartDate: "2026-03-24T14:00:00",
        EndDate: "2026-03-24T15:30:00",
        TaskStatus: "대기",
        WayName: "B구역",
        Repeat: "Y",
        Repeat_Day: "화,목",
        Repeat_End: "2026-04-30",
    },
    {
        id: 903,
        RobotName: "Robot 3",
        WorkName: "매일 점검",
        TaskType: "task3",
        StartDate: "2026-03-24T08:00:00",
        EndDate: "2026-03-24T08:30:00",
        TaskStatus: "진행중",
        WayName: "C구역",
        Repeat: "Y",
        Repeat_Day: "월,화,수,목,금,토,일",
        Repeat_End: null,
    },
    {
        id: 904,
        RobotName: "Robot 1",
        WorkName: "단일 작업 (비반복)",
        TaskType: "task1",
        StartDate: "2026-03-25T11:00:00",
        EndDate: "2026-03-25T12:00:00",
        TaskStatus: "완료",
        WayName: "D구역",
        Repeat: "N",
        Repeat_Day: null,
        Repeat_End: null,
        ScheduleMode: "once",
    },
    {
        id: 905,
        RobotName: "Robot 2",
        WorkName: "주기 순찰 (10분)",
        TaskType: "task1",
        StartDate: "2026-03-24T09:00:00",
        EndDate: "2026-03-24T18:00:00",
        TaskStatus: "대기",
        WayName: "E구역",
        Repeat: "Y",
        Repeat_Day: "월,화,수,목,금",
        Repeat_End: "2026-04-30",
        ScheduleMode: "interval",
        IntervalMinutes: 10,
        ActiveStartTime: "09:00",
        ActiveEndTime: "18:00",
        SeriesStartDate: "2026-03-24",
        SeriesEndDate: "2026-04-30",
    },
];
const USE_MOCK = false; // false로 바꾸면 실제 API 사용
// ===== Mock 데이터 끝 =====


// 주간
type WeekEvent = {
  id: string;
  title: string;

  robotNo: string;     // 예: "Robot 3"
  robotType: string;   // 예: "순찰/보안"

  dayIndex: number;   // 0=일 ... 6=토
  startMin: number;   // 0~1439
  endMin: number;     // 1~1440
  color?: "green" | "yellow" | "blue" | "red";
  status?: string;       // "대기" | "진행중" | "완료" | "오류"
  scheduleMode?: string; // "once" | "weekly" | "interval"
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function hourLabel(h: number) {
  const ampm = h < 12 ? "오전" : "오후";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${display}시`;
}

/** 분 단위까지 간소하게 표시 (예: "오후5:31", 정각이면 "오후5:00") */
function timeLabel(totalMin: number) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ampm = h < 12 ? "오전" : "오후";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${ampm}${display}:${String(m).padStart(2, "0")}`;
}

// 월간
type MonthDayCell = {
  date: Date;
  day: number;
  inMonth: boolean;
  key: string; // YYYY-MM-DD
};

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmdDate(value: string) {
  const parts = value.split("-");
  if (parts.length !== 3) return new Date(value);

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (!year || !month || !day) return new Date(value);

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function clampMinutes(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 24 * 60) return 24 * 60;
  return Math.round(value);
}

type ParsedMinutes = {
  value: number | null;
  isMinutesOfDay: boolean;
};

function parseMinuteValue(input: number | string): ParsedMinutes {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { value: null, isMinutesOfDay: false };
    if (input >= 60) return { value: input, isMinutesOfDay: true };
    return { value: input, isMinutesOfDay: false };
  }

  const raw = input.trim();
  if (!raw) return { value: null, isMinutesOfDay: false };

  const hhmmMatch = raw.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (hhmmMatch) {
    const h = Number(hhmmMatch[1]);
    const m = Number(hhmmMatch[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { value: h * 60 + m, isMinutesOfDay: true };
    }
  }

  const exprMatch = raw.match(/^\s*(\d{1,2})\s*\*\s*60\s*\+\s*(\d{1,2})\s*$/);
  if (exprMatch) {
    const h = Number(exprMatch[1]);
    const m = Number(exprMatch[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { value: h * 60 + m, isMinutesOfDay: true };
    }
  }

  const num = Number(raw);
  if (Number.isFinite(num)) {
    return { value: num, isMinutesOfDay: num >= 60 };
  }

  const looseNumbers = raw.match(/\d+/g);
  if (looseNumbers && looseNumbers.length >= 2) {
    const h = Number(looseNumbers[0]);
    const m = Number(looseNumbers[1]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { value: h * 60 + m, isMinutesOfDay: true };
    }
  } else if (looseNumbers && looseNumbers.length === 1) {
    const only = Number(looseNumbers[0]);
    if (Number.isFinite(only)) {
      return { value: only, isMinutesOfDay: only >= 60 };
    }
  }

  return { value: null, isMinutesOfDay: false };
}

function normalizeMinuteRange(startValue: number | string, endValue: number | string) {
  const startParsed = parseMinuteValue(startValue);
  const endParsed = parseMinuteValue(endValue);

  if (!Number.isFinite(startParsed.value ?? NaN) || !Number.isFinite(endParsed.value ?? NaN)) {
    return { startMin: 0, endMin: 0 };
  }

  const startNum = startParsed.value as number;
  const endNum = endParsed.value as number;
  const treatAsHours = !startParsed.isMinutesOfDay && !endParsed.isMinutesOfDay && startNum <= 24 && endNum <= 24;
  const factor = treatAsHours ? 60 : 1;

  return {
    startMin: clampMinutes(startNum * factor),
    endMin: clampMinutes(endNum * factor),
  };
}

type MonthEvent = {
  id: string;
  title: string;
  date: string; // "2025-01-09"
  color?: "green" | "yellow" | "blue" | "red";
  status?: ScheduleStatus;
  startMin?: number;
};


function buildMonthCells(viewDate: Date) {

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
    cells.push({ date, day, inMonth: false, key: ymd(date) });
  }

  // 2) 이번달
  for (let d = 1; d <= lastDate; d++) {
    const date = new Date(year, month, d);
    date.setHours(0, 0, 0, 0);
    cells.push({ date, day: d, inMonth: true, key: ymd(date) });
  }

  // 3) 뒤쪽(다음달) - totalCells 맞춰 채우기 (5주면 35칸, 6주면 42칸)
  let nextDay = 1;
  while (cells.length < totalCells) {
    const date = new Date(year, month + 1, nextDay++);
    date.setHours(0, 0, 0, 0);
    cells.push({ date, day: date.getDate(), inMonth: false, key: ymd(date) });
  }

  return { cells, weeks };
}

const monthColorClass: Record<NonNullable<MonthEvent["color"]>, string> = {
  green: styles.evGreen,
  yellow: styles.evYellow,
  blue: styles.evBlue,
  red: styles.evRed,
};

function statusToColor(status: string): WeekEvent["color"] {
  switch (status) {
    case "대기": return "yellow";
    case "진행": case "진행중": return "blue";
    case "오류": return "red";
    case "완료": return "green";
    default: return "green";
  }
}

const MONTH_MAX_VISIBLE = 3;
const WEEK_MAX_VISIBLE = 2;

const statusDotClass = (status?: ScheduleStatus) => {
  switch (status) {
    case "대기":
      return styles.statusWaiting;
    case "진행":
      return styles.statusWorking;
    case "오류":
      return styles.statusError;
    case "완료":
      return styles.statusCompleted;
    default:
      return styles.statusCompleted;
  }
};

interface RobotScheduleProps {
  robots: RobotRowData[];
}

export default function Page({ robots }: RobotScheduleProps) {
    // DBSchedule 타입은 ../utils/expandRepeatSchedules 에서 import

    const [schedules, setSchedules] = useState<DBSchedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSchedules = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (USE_MOCK) {
                setSchedules(MOCK_SCHEDULES);
            } else {
                const res = await apiFetch(`/DB/schedule`);
                if (!res.ok) throw new Error("서버 응답 오류");
                const data = await res.json();
                setSchedules(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            console.error("스케줄 조회 실패", e);
            setError("스케줄 데이터를 불러오지 못했습니다.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSchedules();
    }, [fetchSchedules]);

    // URL ?id= 파라미터로 상세 모달 자동 열기
    const searchParams = useSearchParams();
    const [autoOpenHandled, setAutoOpenHandled] = useState(false);

    useEffect(() => {
        if (autoOpenHandled || loading || schedules.length === 0) return;
        const idParam = searchParams.get("id");
        if (!idParam) return;

        const found = schedules.find((s) => String(s.id) === idParam);
        if (found) {
            const start = new Date(found.StartDate);
            setSelectedWeekEvent({
                id: String(found.id),
                title: found.WorkName,
                robotNo: found.RobotName,
                robotType: found.TaskType,
                dayIndex: start.getDay(),
                startMin: start.getHours() * 60 + start.getMinutes(),
                endMin: new Date(found.EndDate).getHours() * 60 + new Date(found.EndDate).getMinutes(),
                color: statusToColor(found.TaskStatus),
                status: found.TaskStatus,
                scheduleMode: found.ScheduleMode || (found.Repeat === "Y" ? "weekly" : "once"),
            });
            setIsDetailModalOpen(true);
        }
        setAutoOpenHandled(true);
    }, [searchParams, schedules, loading, autoOpenHandled]);

    // 필터 항목 드롭다운 구현
    const [isRobotTypeSelected, setIsRobotTypeSelected] = useState(true);
    const [isRobotNameSelected, setIsRobotNameSelected] = useState(true);
    
    // 필터 항목 다중 선택
    const [selectedRobotTypes, setSelectedRobotTypes] = useState<string[]>([]);
    const [selectedRobotNames, setSelectedRobotNames] = useState<string[]>([]);
    const robotTypes = ["task1", "task2", "task3"];

    const toggleRobotType = (label: string) => {
        setSelectedRobotTypes((prev) =>
            prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]
        );
    };
    const toggleRobotName = (name: string) => {
        setSelectedRobotNames((prev) =>
            prev.includes(name)
            ? prev.filter((x) => x !== name)
            : [...prev, name]
        );
    };

    const isTypeFilterOn = selectedRobotTypes.length > 0;
    const isNameFilterOn = selectedRobotNames.length > 0;

    const robotNameOptions = robots;

    // 필터 조건 스크롤 뷰
    const filterScrollRef = useRef<HTMLDivElement>(null);
    const filterTrackRef = useRef<HTMLDivElement>(null);
    const filterThumbRef = useRef<HTMLDivElement>(null);

    useCustomScrollbar({
        enabled: true,            // 기존 로직 유지 (원하면 필터 영역 조건으로 바꿔도 됨)
        scrollRef: filterScrollRef,    // ✅ 키 이름만 훅 규격에 맞춤
        trackRef: filterTrackRef,
        thumbRef: filterThumbRef,
        minThumbHeight: 50,
        deps: [
            selectedRobotTypes.length,
            selectedRobotNames.length,
            robotNameOptions.length,
            isRobotTypeSelected,
            isRobotNameSelected,
        ],
    });
    
    type ScheduleView = "week" | "month";
    const [viewType, setViewType] = useState<ScheduleView>("week");
    
    // 달력에서 보고 있는 기준 월
    const [viewDate, setViewDate] = useState(new Date());

    const startOfWeek = (d: Date) => {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        x.setDate(x.getDate() - x.getDay()); // 일요일 시작
        return x;
    };

    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        return t;
    });
    const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));

    const [todayResetKey, setTodayResetKey] = useState(0);

    const displayDate = viewType === "week" ? weekStart : viewDate;
    const year = displayDate.getFullYear();
    const month = displayDate.getMonth(); // 0~11

      /* =========================
        📌 월간 이벤트 계산
    ========================= */
    const monthExpanded = useMemo(() => {
        const y = viewDate.getFullYear();
        const m = viewDate.getMonth();
        const rangeStart = new Date(y, m, 1);
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(y, m + 1, 0);
        rangeEnd.setHours(23, 59, 59, 999);
        return expandRepeatSchedules(schedules, rangeStart, rangeEnd);
    }, [schedules, viewDate]);

    const monthEvents: MonthEvent[] = useMemo(() => {
        return monthExpanded.map((s) => {
            const displayTitle = s.ScheduleMode === 'interval' && s.IntervalMinutes
                ? `${s.WorkName} (${s.IntervalMinutes}분)`
                : s.WorkName;
            const origStart = new Date(s.StartDate);
            return {
                id: s._isVirtual ? `${s._originalId}_${ymd(s._virtualDate)}_${s._virtualDate.getHours()}${s._virtualDate.getMinutes()}` : String(s._originalId),
                title: displayTitle,
                date: ymd(s._virtualDate),
                color: statusToColor(s.TaskStatus),
                status: s.TaskStatus as ScheduleStatus,
                startMin: origStart.getHours() * 60 + origStart.getMinutes(),
            };
        });
    }, [monthExpanded]);

    const filteredMonthEvents: MonthEvent[] = useMemo(() => {
        if (!isTypeFilterOn && !isNameFilterOn) return monthEvents;
        return monthEvents.filter((ev) => {
            const origId = extractOriginalId(ev.id);
            const full = schedules.find((s) => String(s.id) === origId);
            if (!full) return false;
            const typeOk = !isTypeFilterOn || selectedRobotTypes.includes(full.TaskType);
            const nameOk = !isNameFilterOn || selectedRobotNames.includes(full.RobotName);
            return typeOk && nameOk;
        });
    }, [monthEvents, schedules, isTypeFilterOn, isNameFilterOn, selectedRobotTypes, selectedRobotNames]);

    const monthEventsForDay = (dateKey: string) =>
        filteredMonthEvents.filter((ev) => ev.date === dateKey);

    /* =========================
        📌 주간 이벤트 계산
    ========================= */
    const weekEvents: WeekEvent[] = useMemo(() => {
        const start = new Date(weekStart);
        start.setHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);

        const expanded = expandRepeatSchedules(schedules, start, end);

        return expanded.map((s) => {
            const d = s._virtualDate;
            const origStart = new Date(s.StartDate);
            const origEnd = new Date(s.EndDate);

            // interval 모드: 제목에 간격 표시
            const displayTitle = s.ScheduleMode === 'interval' && s.IntervalMinutes
                ? `${s.WorkName} (${s.IntervalMinutes}분 간격)`
                : s.WorkName;

            const mode = s.ScheduleMode || (s.Repeat === "Y" ? "weekly" : "once");

            return {
                id: s._isVirtual ? `${s._originalId}_${ymd(d)}_${origStart.getHours()}${origStart.getMinutes()}` : String(s._originalId),
                title: displayTitle,
                robotNo: s.RobotName,
                robotType: s.TaskType,
                dayIndex: d.getDay(),
                startMin: origStart.getHours() * 60 + origStart.getMinutes(),
                endMin: origEnd.getHours() * 60 + origEnd.getMinutes(),
                color: statusToColor(s.TaskStatus),
                status: s.TaskStatus,
                scheduleMode: mode,
            };
        });
    }, [schedules, weekStart]);

    const weekDates = useMemo(() => {
        return Array.from({ length: 7 }, (_, i) => {
            const dt = new Date(weekStart);
            dt.setDate(weekStart.getDate() + i);
            return dt;
        });
    }, [weekStart]);

        /** ✅ 조건 1/2/3 실시간 반영 필터 */
    const filteredWeekEvents = useMemo(() => {
        // 필터가 하나도 없으면 전체 표시
        if (!isTypeFilterOn && !isNameFilterOn) return weekEvents;

        return weekEvents.filter((ev) => {
            const typeOk = !isTypeFilterOn || selectedRobotTypes.includes(ev.robotType);
            const nameOk = !isNameFilterOn || selectedRobotNames.includes(ev.robotNo);

            // ✅ 조건3: 둘 다 선택된 경우 교집합(type AND name)
            return typeOk && nameOk;
        });
    }, [weekEvents, isTypeFilterOn, isNameFilterOn, selectedRobotTypes, selectedRobotNames]);

    // 겹치는 이벤트 컬럼 레이아웃 계산
    type LayoutEvent = WeekEvent & { col: number; totalCols: number };
    const layoutWeekEvents: LayoutEvent[] = useMemo(() => {
        // 요일별 그룹핑
        const byDay = new Map<number, WeekEvent[]>();
        for (const ev of filteredWeekEvents) {
            const arr = byDay.get(ev.dayIndex) ?? [];
            arr.push(ev);
            byDay.set(ev.dayIndex, arr);
        }

        const result: LayoutEvent[] = [];

        for (const [, events] of byDay) {
            // 시작시간 순 정렬
            const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

            // 겹침 그룹 분리
            const groups: WeekEvent[][] = [];
            let currentGroup: WeekEvent[] = [];
            let groupEnd = -1;

            for (const ev of sorted) {
                if (currentGroup.length === 0 || ev.startMin < groupEnd) {
                    currentGroup.push(ev);
                    groupEnd = Math.max(groupEnd, ev.endMin);
                } else {
                    groups.push(currentGroup);
                    currentGroup = [ev];
                    groupEnd = ev.endMin;
                }
            }
            if (currentGroup.length > 0) groups.push(currentGroup);

            // 각 그룹 내 컬럼 배치
            for (const group of groups) {
                const columns: WeekEvent[][] = [];
                for (const ev of group) {
                    let placed = false;
                    for (let c = 0; c < columns.length; c++) {
                        const last = columns[c][columns[c].length - 1];
                        if (ev.startMin >= last.endMin) {
                            columns[c].push(ev);
                            placed = true;
                            break;
                        }
                    }
                    if (!placed) columns.push([ev]);
                }

                const totalCols = columns.length;
                for (let c = 0; c < columns.length; c++) {
                    for (const ev of columns[c]) {
                        result.push({ ...ev, col: c, totalCols });
                    }
                }
            }
        }

        return result;
    }, [filteredWeekEvents]);

    // 드롭다운 상태: 겹침 그룹 키 → 열림 여부
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);

    // 개별 이벤트 리스트
    const groupedEvents = layoutWeekEvents;

    // 드롭다운 외부 클릭 시 닫기
    useEffect(() => {
        if (!openDropdown) return;
        const handle = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest(`.${styles.eventDropdown}`) && !target.closest(`.${styles.event}`)) {
                setOpenDropdown(null);
            }
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [openDropdown]);

    // Header의 이전/다음 버튼 처리
    const addDays = (base: Date, days: number) => {
        const d = new Date(base);
        d.setDate(d.getDate() + days);
        d.setHours(0, 0, 0, 0);
        return d;
    };

    const handlePrev = () => {
        if (viewType === "week") {
            setWeekStart((prev) => addDays(prev, -7));
        } else {
            setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    }
    };

    const handleNext = () => {
        if (viewType === "week") {
            setWeekStart((prev) => addDays(prev, +7));
        } else {
            setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
        }
    };

    // 기존 dates 목업을 대체
    const dates = useMemo(() => weekDates.map((d) => String(d.getDate())), [weekDates]);

    const handlePickDate = (d: Date) => {
    setSelectedDate(d);
    setWeekStart(startOfWeek(d));

    // 상단 "년/월" 표시도 선택월로 동기화
    setViewDate(d);

    // 조건4: 선택일 기준 주간 스케줄을 보여줘야 한다면 주간 탭으로 전환
    setViewType("week");
    };

    /** 1) 화면 옵션 */
    const hourRowPx = 60;     // 1시간 칸 높이
    const totalMinutes = 24 * 60;
    const gridHeight = 24 * hourRowPx;

    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);


    /** 4) 시간 라벨 (24개) */
    const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

    const colorClass = (c?: WeekEvent["color"]) => {
        switch (c) {
        case "green":
            return styles.evGreen;
        case "yellow":
            return styles.evYellow;
        case "blue":
            return styles.evBlue;
        case "red":
            return styles.evRed;
        default:
            return styles.evGreen;
        }
    };

    const { cells: monthCells, weeks } = useMemo(() => {
        return buildMonthCells(viewDate);
    }, [viewDate]);

    const handleToday = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 선택 날짜 = 오늘
        setSelectedDate(today);

        // 주간 기준일 = 오늘이 포함된 주 시작
        setWeekStart(startOfWeek(today));

        // 상단 년/월 표시 + 월간 기준 월 동기화
        setViewDate(today);

        // MiniCalendar를 오늘로 "초기화"시키는 신호
        setTodayResetKey((k) => k + 1);
    };

    // 현재 시간 (Now line)
    const [nowMinutes, setNowMinutes] = useState(() => {
        const n = new Date();
        return n.getHours() * 60 + n.getMinutes();
    });

    useEffect(() => {
        const timer = setInterval(() => {
            const n = new Date();
            setNowMinutes(n.getHours() * 60 + n.getMinutes());
        }, 60000); // 1분마다 업데이트
        return () => clearInterval(timer);
    }, []);

    const todayDayIndex = useMemo(() => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
            const wd = new Date(weekStart);
            wd.setDate(weekStart.getDate() + i);
            if (wd.getFullYear() === t.getFullYear() && wd.getMonth() === t.getMonth() && wd.getDate() === t.getDate()) {
                return i;
            }
        }
        return -1; // 이번 주에 오늘이 없음
    }, [weekStart]);

    const isSameYmd = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

        const today0 = useMemo(() => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        return t;
    }, []);


    // 주간 스크롤바
    useCustomScrollbar({
        enabled: viewType === "week",
        scrollRef,
        trackRef,
        thumbRef,
        minThumbHeight: 10,
        deps: [viewType, gridHeight],
    });

    // 주간 뷰 로드 시 현재 시간대로 자동 스크롤 (1시간 전 위치)
    useEffect(() => {
        if (viewType !== "week" || loading || schedules.length === 0) return;
        // DOM 렌더링 후 스크롤
        requestAnimationFrame(() => {
            if (!scrollRef.current) return;
            const now = new Date();
            const offsetHour = Math.max(0, now.getHours() - 1);
            scrollRef.current.scrollTop = offsetHour * hourRowPx;
        });
    }, [viewType, weekStart, loading, schedules.length]);

    // 작업등록 모달 open/close 상태
    const [isInsertModalOpen, setIsInsertModalOpen] = useState(false);

    // 작업상세 모달 open/close 상태
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

    // ✅ 클릭된 주간 이벤트 저장
    const [selectedWeekEvent, setSelectedWeekEvent] = useState<WeekEvent | null>(null);

    // 날짜별 작업 목록 모달
    const [isDayListOpen, setIsDayListOpen] = useState(false);
    const [dayListDate, setDayListDate] = useState<string>("");
    const [dayListEvents, setDayListEvents] = useState<LayoutEvent[]>([]);
    const [dayListFilterType, setDayListFilterType] = useState<string>("all");
    const [dayListFilterRobot, setDayListFilterRobot] = useState<string>("all");

    const handleClickWeekEvent = (event: WeekEvent) => {
        // 같은 시간대(시작 시간 기준)의 이벤트를 모아서 목록 모달 열기
        const clickedHour = Math.floor(event.startMin / 60);
        const hourEvents = groupedEvents.filter((ev) =>
            ev.dayIndex === event.dayIndex && Math.floor(ev.startMin / 60) === clickedHour
        );
        if (hourEvents.length === 1) {
            // 1개면 바로 상세 모달
            const realId = extractOriginalId(event.id);
            setSelectedWeekEvent({ ...event, id: realId });
            setIsDetailModalOpen(true);
        } else {
            // 2개 이상이면 목록 모달
            const clickedHour = Math.floor(event.startMin / 60);
            const hourLabel12 = clickedHour < 12
                ? `오전 ${clickedHour === 0 ? 12 : clickedHour}시`
                : `오후 ${clickedHour === 12 ? 12 : clickedHour - 12}시`;
            const dateStr = weekDates[event.dayIndex];
            setDayListDate(dateStr ? `${dateStr.getMonth() + 1}월 ${dateStr.getDate()}일 ${hourLabel12}` : "");
            setDayListEvents(hourEvents);
            setDayListFilterType(selectedRobotTypes.length === 1 ? selectedRobotTypes[0] : "all"); setDayListFilterRobot(selectedRobotNames.length === 1 ? selectedRobotNames[0] : "all"); setIsDayListOpen(true);
        }
    };

    const handleDayListSelect = (event: LayoutEvent) => {
        const realId = extractOriginalId(event.id);
        setSelectedWeekEvent({ ...event, id: realId });
        setIsDayListOpen(false);
        setIsDetailModalOpen(true);
    };

    const handleCloseDetail = () => {
        setIsDetailModalOpen(false);
        setSelectedWeekEvent(null);
    };

    const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
    // 월간: 셀에서 노출 가능한 row 수(리사이즈 반영)
    const monthBodyRef = useRef<HTMLDivElement>(null);
    const [monthMaxVisibleRows, setMonthMaxVisibleRows] = useState(1);

    // 월간: “초과 팝업” 상태
    const [monthOverflowOpen, setMonthOverflowOpen] = useState(false);
    const [monthOverflowDateKey, setMonthOverflowDateKey] = useState<string>("");
    const [monthOverflowDateObj, setMonthOverflowDateObj] = useState<Date | null>(null);

    const toDetailEventFromMonth = (ev: MonthEvent): WeekEvent | null => {
    const origId = extractOriginalId(ev.id);
    // 먼저 확장된 배열에서 찾기 (가상 인스턴스의 날짜/시간 반영)
    const expanded = monthExpanded.find(
        (s) => {
            const vd = s._virtualDate;
            const sid = s._isVirtual ? `${s._originalId}_${ymd(vd)}_${vd.getHours()}${vd.getMinutes()}` : String(s._originalId);
            return sid === ev.id;
        }
    );
    const full = expanded ?? schedules.find((s) => String(s.id) === origId);
    if (!full) return null;

    const d = new Date(full.StartDate);
    const end = new Date(full.EndDate);

    return {
    id: origId,
    title: full.WorkName,
    robotNo: full.RobotName,
    robotType: full.TaskType,
    dayIndex: d.getDay(),
    startMin: d.getHours() * 60 + d.getMinutes(),
    endMin: end.getHours() * 60 + end.getMinutes(),
    color: statusToColor(full.TaskStatus),
    };
    };

    useEffect(() => {
  if (viewType !== "month") return;

  const el = monthBodyRef.current;
  if (!el) return;

  const calc = () => {
    // monthContainer(630) - header(40) 영역 = monthBody 높이
    // 이 높이를 weeks로 나누면 셀 높이
    const bodyH = el.clientHeight;
    const cellH = weeks > 0 ? bodyH / weeks : bodyH;

    // 대략값(디자인 기준): date 라인/패딩 영역 확보
    const reserved = 24;     // 날짜 표시 + 상단 여백
    const gap = 2;           // row 간격(gap)
    const rowH = 16;         // event row 높이(폰트/패딩 감안)
    const usable = Math.max(0, cellH - reserved);

    // 표시 가능 row 수 계산
    const rows = Math.max(1, Math.floor((usable + gap) / (rowH + gap)));

    // 과도하게 많아지는 건 UX상 제한(원하면 제거 가능)
    setMonthMaxVisibleRows(Math.min(rows, 6));
  };

  calc();
  const ro = new ResizeObserver(calc);
  ro.observe(el);
  window.addEventListener("resize", calc);

  return () => {
    ro.disconnect();
    window.removeEventListener("resize", calc);
  };
}, [viewType, weeks]);

// 주간
// 주간: 요일별 접기/펼치기
const WEEK_ROW_LIMIT = 4;
const [expandedWeekDays, setExpandedWeekDays] = useState<Set<number>>(new Set());

// 주간 이벤트: 요일별 그룹
const weekEventsByDay = useMemo(() => {
  const map = new Map<number, WeekEvent[]>();
  for (let i = 0; i < 7; i++) map.set(i, []);
  filteredWeekEvents.forEach((ev) => {
    map.get(ev.dayIndex)?.push(ev);
  });

  // 시간순 정렬(선택)
  for (let i = 0; i < 7; i++) {
    map.get(i)!.sort((a, b) => a.startMin - b.startMin);
  }
  return map;
}, [filteredWeekEvents]);

// “레인 높이”는 확장 상태를 반영해 최대 row 수로 결정
const weekLaneRowH = 18;
const weekLanePad = 8;
const weekLaneHeaderH = 0; // 필요하면 18 정도로 올려도 됨

const maxLaneRows = useMemo(() => {
  let max = 0;
  for (let i = 0; i < 7; i++) {
    const list = weekEventsByDay.get(i) ?? [];
    const expanded = expandedWeekDays.has(i);
    const visibleCount = expanded ? list.length : Math.min(list.length, WEEK_ROW_LIMIT);
    max = Math.max(max, visibleCount);
  }
  return max;
}, [weekEventsByDay, expandedWeekDays]);

const weekLaneHeight = useMemo(() => {
  // row가 0이면 레인 자체를 최소 높이로
  if (maxLaneRows <= 0) return 0;
  return weekLanePad * 2 + weekLaneHeaderH + maxLaneRows * weekLaneRowH;
}, [maxLaneRows]);

const toggleWeekDayExpand = (dayIdx: number) => {
  setExpandedWeekDays((prev) => {
    const next = new Set(prev);
    if (next.has(dayIdx)) next.delete(dayIdx);
    else next.add(dayIdx);
    return next;
  });
};

useEffect(() => {
  if (!monthOverflowOpen) return;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") setMonthOverflowOpen(false);
  };

  document.addEventListener("keydown", onKeyDown);
  document.body.style.overflow = "hidden";

  return () => {
    document.removeEventListener("keydown", onKeyDown);
    document.body.style.overflow = "unset";
  };
}, [monthOverflowOpen]);


    return (
      <>
        <div className={styles.ScheduleContainer}>
            <div>

                <div>
                    <MiniCalendar value={selectedDate} onPickDate={handlePickDate} todayResetKey={todayResetKey} />
                </div>
                <div className={styles.whiteLine}></div>
                <div className={styles.selectBoxContainer}>
                    <div ref={filterScrollRef} className={styles.filterInner}>
                        <div className={styles.selectBoxGap}>
                            <div className={styles.selecteBoxCommon} onClick={() => setIsRobotTypeSelected(prev => !prev)}>
                                <div>작업유형</div>
                                <img src={isRobotTypeSelected ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                            </div>
                            {isRobotTypeSelected && (
                                <div>
                                    <div
                                        className={`${styles.robotSelecteItem} ${selectedRobotTypes.length === robotTypes.length ? styles.active : ""}`}
                                        onClick={() => {
                                            if (selectedRobotTypes.length === robotTypes.length) {
                                                setSelectedRobotTypes([]);
                                            } else {
                                                setSelectedRobotTypes([...robotTypes]);
                                            }
                                        }}
                                    >
                                        <img
                                            src={selectedRobotTypes.length === robotTypes.length ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                                            alt=""
                                        />
                                        <span>전체</span>
                                    </div>
                                    {robotTypes.map((label) => {
                                        const isSelected = selectedRobotTypes.includes(label);

                                        return (
                                            <div
                                            key={label}
                                            className={`${styles.robotSelecteItem} ${isSelected ? styles.active : ""}`}
                                            onClick={() => toggleRobotType(label)}
                                            >
                                            <img
                                                src={isSelected ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                                                alt=""
                                            />
                                            <span>{label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div>
                            <div className={styles.selecteBoxCommon} onClick={() => setIsRobotNameSelected(prev => !prev)}>
                                <div>로봇명</div>
                                <img src={isRobotNameSelected ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                            </div>
                            {isRobotNameSelected && (
                            <div>
                                <div
                                    className={`${styles.robotSelecteItem} ${selectedRobotNames.length === robotNameOptions.length ? styles.active : ""}`}
                                    onClick={() => {
                                        if (selectedRobotNames.length === robotNameOptions.length) {
                                            setSelectedRobotNames([]);
                                        } else {
                                            setSelectedRobotNames(robotNameOptions.map(r => r.no));
                                        }
                                    }}
                                >
                                    <img
                                        src={selectedRobotNames.length === robotNameOptions.length ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                                        alt=""
                                    />
                                    <span>전체</span>
                                </div>
                                {robotNameOptions.map((robot) => {
                                const active = selectedRobotNames.includes(robot.no);

                                return (
                                    <div
                                    key={robot.id}
                                    className={`${styles.robotSelecteItem} ${
                                        active ? styles.active : ""
                                    }`}
                                    onClick={() => toggleRobotName(robot.no)}
                                    >
                                    <img
                                        src={
                                        active
                                            ? "/icon/robot_chk.png"
                                            : "/icon/robot_none_chk.png"
                                        }
                                        alt=""
                                    />
                                    <span>{robot.no}</span>
                                    </div>
                                );
                                })}
                            </div>
                            )}
                        </div>
                    </div>

                    <div className={styles.selectBoxGutter}>
                        <div ref={filterTrackRef} className={styles.filterScrollTrack}>
                            <div ref={filterThumbRef} className={styles.filterScrollThumb} />
                        </div>
                    </div>
                </div>
            </div>

            {/* 스케줄 */}
            <div className={styles.scheduleRight}>

                <div className={styles.scheduleRightHeader}>
                    <div className={styles.rightHeaderTopL}>
                        <div className={styles.todayBtn} onClick={handleToday}>오늘</div>
                        <div className={styles.calendarHeader}>
                            <button type="button" onClick={handlePrev}>
                                <img src="/icon/arrow-left-g.png" alt="left" />
                            </button>
                            <div className={styles.calendarHeaderTitle}>{year}년 {month + 1}월</div>
                            <button type="button" onClick={handleNext}>
                                <img src="/icon/arrow-right-g.png" alt="next" />
                            </button>
                        </div>
                        <div className={styles.statusUpdate}>
                            <img
                                src="/icon/data_update.png"
                                alt="새로고침"
                                className={`${styles.refreshBtn} ${loading ? styles.refreshing : ""}`}
                                onClick={fetchSchedules}
                            />
                        </div>
                    </div>

                    <div className={styles.scheduleControl}>
                        <button type='button' className={styles.scheduleAddButton} onClick={() => setIsInsertModalOpen(true)}>
                            <span>+</span>
                            <span>작업등록</span>
                        </button>
                        <div className={styles.scheduleViewButtons}>
                            <button type='button' 
                                    className={`${styles.scheduleWeek} ${viewType === "week" ? styles.active : ""}`} 
                                    onClick={() => setViewType("week")}>주간</button>
                            <button type='button' className={`${styles.scheduleMonth} ${viewType === "month" ? styles.active : ""}`}
                                    onClick={() => setViewType("month")}>월간</button>
                        </div>
                    </div>
                </div>
                {/* 작업등록 모달 */}

                {isInsertModalOpen && (
                    <ScheduleInsert
                        isOpen={isInsertModalOpen}
                        onClose={() => setIsInsertModalOpen(false)}
                        robots={robots}
                        onScheduleChanged={fetchSchedules}
                    />
                )}

                {/* 로딩 / 에러 / 빈 상태 */}
                {loading && (
                    <div className={styles.stateOverlay}>
                        <div className={styles.spinner} />
                        <span>스케줄 데이터를 불러오는 중...</span>
                    </div>
                )}

                {!loading && error && (
                    <div className={styles.stateOverlay}>
                        <span>{error}</span>
                        <button type="button" className={styles.retryBtn} onClick={fetchSchedules}>
                            다시 시도
                        </button>
                    </div>
                )}

                {!loading && !error && schedules.length === 0 && (
                    <div className={styles.stateOverlay}>
                        <span>등록된 작업이 없습니다.</span>
                        <span style={{ fontSize: '12px', opacity: 0.6 }}>
                            상단의 &quot;작업등록&quot; 버튼으로 새 일정을 추가하세요.
                        </span>
                    </div>
                )}

                {!loading && !error && schedules.length > 0 && viewType === "week" && (
                <section className={styles.weekendGrid}>
                    <div className={styles.scroller}>
                        <div ref={scrollRef} className={styles.inner} role="listbox">
                            {/* 헤더(요일/날짜) */}
                            <div className={styles.headerRow}>
                                <div className={styles.corner} />
                                    {DOW.map((d, i) => {
                                        const isToday = isSameYmd(weekDates[i], today0);
                                        return (
                                            <div key={d} className={styles.dayHeader}>
                                            <div className={i === 0 ? styles.sun : i === 6 ? styles.sat : undefined}>{d}</div>
                                            <div className={`${styles.dateChip} ${isToday ? styles.todayDateChip : ""}`}>
                                                {dates[i] ?? ""}
                                            </div>
                                            </div>
                                        );
                                    })}
                            </div>

                            {/* 바디 */}
                            <div className={styles.body}>
                                {/* 시간 컬럼 */}
                                <div className={styles.timeCol}>
                                    <div className={styles.timeColInner} style={{ height: gridHeight }}>
                                    {hours.map((h) => (
                                        <div key={h} className={styles.timeCell} style={{ height: hourRowPx }}>
                                        {hourLabel(h)}
                                        </div>
                                    ))}
                                    </div>
                                </div>

                                {/* 7일 그리드 */}
                                <div className={styles.daysCol}>
                                    <div className={styles.daysGrid} style={{ height: gridHeight }}>

                                    {/* 가로 라인(시간) */}
                                    {hours.map((h) => (
                                        <div
                                        key={h}
                                        className={styles.hourRowLine}
                                        style={{ top: h * hourRowPx }}
                                        />
                                    ))}

                                    {/* 7일 컬럼 배경(오늘 강조 + 시간 칸별 클릭) */}
                                    {Array.from({ length: 7 }).map((_, i) => {
                                        const isToday = isSameYmd(weekDates[i], today0);
                                        const dayEvts = groupedEvents.filter((ev) => ev.dayIndex === i);
                                        return (
                                            <div
                                            key={`bg-${i}`}
                                            className={`${styles.dayColBg} ${isToday ? styles.todayColBg : ""}`}
                                            style={{
                                                left: `${(i / 7) * 100}%`,
                                                width: `${100 / 7}%`,
                                                height: gridHeight,
                                            }}
                                            >
                                                {hours.map((h) => {
                                                    const hourEvts = dayEvts.filter((ev) => Math.floor(ev.startMin / 60) === h);
                                                    const hasEvents = hourEvts.length > 0;
                                                    return (
                                                        <div
                                                            key={h}
                                                            className={`${styles.hourCell} ${hasEvents ? styles.hourCellClickable : ""}`}
                                                            style={{ height: hourRowPx }}
                                                            onClick={() => {
                                                                if (!hasEvents) return;
                                                                const dateStr = weekDates[i];
                                                                const hourLabel12 = h < 12
                                                                    ? `오전 ${h === 0 ? 12 : h}시`
                                                                    : `오후 ${h === 12 ? 12 : h - 12}시`;
                                                                setDayListDate(dateStr ? `${dateStr.getMonth() + 1}월 ${dateStr.getDate()}일 ${hourLabel12}` : "");
                                                                setDayListEvents(hourEvts.sort((a, b) => a.startMin - b.startMin));
                                                                setDayListFilterType(selectedRobotTypes.length === 1 ? selectedRobotTypes[0] : "all"); setDayListFilterRobot(selectedRobotNames.length === 1 ? selectedRobotNames[0] : "all"); setIsDayListOpen(true);
                                                            }}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}

                                    {/* 현재 시간 하이라이트 (전체 행) */}
                                    {todayDayIndex >= 0 && (
                                        <div
                                            className={styles.nowLine}
                                            style={{
                                                top: Math.floor(nowMinutes / 60) * hourRowPx,
                                            }}
                                        />
                                    )}

                                    {/* 요일별 이벤트 컨테이너 */}
                                    {Array.from({ length: 7 }).map((_, dayIdx) => {
                                        const dayEvents = [...groupedEvents]
                                            .filter((ev) => ev.dayIndex === dayIdx)
                                            .sort((a, b) => a.startMin - b.startMin);
                                        if (dayEvents.length === 0) return null;

                                        // 시간대별 그룹핑 (같은 시간 시작 이벤트 묶기)
                                        const byHour = new Map<number, typeof dayEvents>();
                                        for (const ev of dayEvents) {
                                            const h = Math.floor(ev.startMin / 60);
                                            const arr = byHour.get(h) ?? [];
                                            arr.push(ev);
                                            byHour.set(h, arr);
                                        }

                                        const dayWidthPct = 100 / 7;
                                        const padding = 4;

                                        return Array.from(byHour.entries()).map(([h, evts]) => (
                                            <div
                                                key={`day${dayIdx}-h${h}`}
                                                className={styles.hourEventSlot}
                                                style={{
                                                    top: h * hourRowPx + 2,
                                                    left: `calc(${dayIdx * dayWidthPct}% + ${padding}px)`,
                                                    width: `calc(${dayWidthPct}% - ${padding * 2}px)`,
                                                    maxHeight: hourRowPx - 4,
                                                }}
                                            >
                                                {evts.slice(0, WEEK_MAX_VISIBLE).map((ev) => (
                                                    <div
                                                        key={ev.id}
                                                        className={styles.weekSlotEvent}
                                                        onClick={() => handleClickWeekEvent(ev)}
                                                        title={ev.scheduleMode === 'interval'
                                                          ? `${ev.title} (${timeLabel(ev.startMin)} ~ ${timeLabel(ev.endMin)})`
                                                          : `${ev.title} (${timeLabel(ev.startMin)})`}
                                                    >
                                                        <span className={`${styles.weekSlotDot} ${colorClass(ev.color)}`} />
                                                        <span className={styles.weekSlotTitle}>{ev.title}</span>
                                                        <span className={styles.weekSlotTime}>
                                                            {ev.scheduleMode === 'interval'
                                                              ? `${timeLabel(ev.startMin)}~${timeLabel(ev.endMin)}`
                                                              : timeLabel(ev.startMin)}
                                                        </span>
                                                        <span className={styles.weekSlotStatus}>{ev.status}</span>
                                                    </div>
                                                ))}
                                                {evts.length > WEEK_MAX_VISIBLE && (
                                                    <div className={styles.weekSlotMore}>··· +{evts.length - WEEK_MAX_VISIBLE}건</div>
                                                )}
                                            </div>
                                        ));
                                    })}

                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className={styles.scrollGutter}>
                            <div ref={trackRef} className={styles.scrollTrack}>
                                <div ref={thumbRef} className={styles.scrollThumb} />
                            </div>
                        </div>
                    </div>
                </section>
                )}

                {/* 날짜별 작업 목록 모달 */}
                {isDayListOpen && (() => {
                    // 필터용: 현재 목록의 작업유형/로봇명 추출
                    const typeSet = new Set<string>();
                    const robotSet = new Set<string>();
                    dayListEvents.forEach((ev) => {
                        if (ev.robotType) typeSet.add(ev.robotType);
                        if (ev.robotNo) robotSet.add(ev.robotNo);
                    });
                    const typeOptions = Array.from(typeSet);
                    const robotOptions = Array.from(robotSet);

                    const filtered = dayListEvents.filter((ev) => {
                        if (dayListFilterType !== "all" && ev.robotType !== dayListFilterType) return false;
                        if (dayListFilterRobot !== "all" && ev.robotNo !== dayListFilterRobot) return false;
                        return true;
                    });

                    return (
                    <div className={styles.dayListOverlay} onClick={() => setIsDayListOpen(false)}>
                        <div className={styles.dayListModal} onClick={(e) => e.stopPropagation()}>
                            <div className={styles.dayListHeader}>
                                <h3>{dayListDate} 작업 목록</h3>
                                <button type="button" onClick={() => setIsDayListOpen(false)} className={styles.dayListClose}>✕</button>
                            </div>
                            <div className={styles.dayListFilters}>
                                <select
                                    value={dayListFilterType}
                                    onChange={(e) => setDayListFilterType(e.target.value)}
                                    className={styles.dayListSelect}
                                >
                                    <option value="all">전체 작업유형</option>
                                    {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <select
                                    value={dayListFilterRobot}
                                    onChange={(e) => setDayListFilterRobot(e.target.value)}
                                    className={styles.dayListSelect}
                                >
                                    <option value="all">전체 로봇</option>
                                    {robotOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <span className={styles.dayListCount}>{filtered.length}건</span>
                            </div>
                            <div className={styles.dayListBody}>
                                {filtered.length === 0 && (
                                    <div className={styles.dayListEmpty}>해당 조건의 작업이 없습니다.</div>
                                )}
                                {filtered.map((ev) => {
                                    const origId = extractOriginalId(ev.id);
                                    const full = schedules.find((s) => String(s.id) === origId);
                                    const mode = full?.ScheduleMode || (full?.Repeat === "Y" ? "weekly" : "once");
                                    const isRepeat = mode === "weekly" || mode === "interval";
                                    const timeText = mode === 'interval'
                                        ? `${timeLabel(ev.startMin)} ~ ${timeLabel(ev.endMin)}`
                                        : timeLabel(ev.startMin);
                                    return (
                                    <button
                                        key={ev.id}
                                        type="button"
                                        className={styles.dayListItem}
                                        onClick={() => handleDayListSelect(ev)}
                                    >
                                        <div className={`${styles.dayListColor} ${colorClass(ev.color)}`} />
                                        <div className={styles.dayListInfo}>
                                            <div className={styles.dayListRowTop}>
                                                <span className={styles.dayListTitle}>{ev.title}</span>
                                                <span className={styles.dayListStatus} data-color={ev.color}>{ev.status || full?.TaskStatus}</span>
                                            </div>
                                            <div className={styles.dayListRowBottom}>
                                                <span className={styles.dayListModeBadge} data-mode={mode}>
                                                    {mode === 'once' ? '단일' : mode === 'weekly' ? '요일반복' : '주기반복'}
                                                </span>
                                                <span className={styles.dayListTime}>{timeText}</span>
                                                <span className={styles.dayListDivider}>·</span>
                                                <img src="/icon/robot_w.png" alt="" className={styles.dayListRobotIcon} />
                                                <span className={styles.dayListRobot}>{ev.robotNo}</span>
                                            </div>
                                        </div>
                                        <span className={styles.dayListArrow}>›</span>
                                    </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    );
                })()}

                {isDetailModalOpen && selectedWeekEvent && (
                    <ScheduleDetail
                        isOpen={isDetailModalOpen}
                        onClose={handleCloseDetail}
                        event={selectedWeekEvent}
                        mockData={USE_MOCK ? (() => {
                            const found = schedules.find((s) => String(s.id) === selectedWeekEvent.id);
                            if (!found) return null;
                            return {
                                RobotName: found.RobotName,
                                TaskName: found.WorkName,
                                TaskType: found.TaskType,
                                TaskStatus: found.TaskStatus,
                                StartDate: found.StartDate,
                                EndDate: found.EndDate,
                                WayName: found.WayName,
                                Repeat: found.Repeat,
                                Repeat_Day: found.Repeat_Day ?? null,
                                Repeat_End: found.Repeat_End ?? null,
                            };
                        })() : undefined}
                        onScheduleChanged={fetchSchedules}
                    />
                )}

                {!loading && !error && schedules.length > 0 && viewType === "month" && (
                <section className={styles.monthContainer}>
                    {/* 요일 헤더 */}
                    <div className={styles.monthHeaderRow}>
                    {DOW.map((d, i) => (
                        <div
                        key={d}
                        className={`${styles.monthWeekDay} ${
                            i === 0 ? styles.sun : i === 6 ? styles.sat : ""
                        }`}
                        >
                        {d}
                        </div>
                    ))}
                    </div>

                    {/* 바디 */}
                    <div
                    ref={monthBodyRef}
                    className={styles.monthBody}
                    >
                        <div
                            className={styles.monthGrid}
                            style={{ gridTemplateRows: `repeat(${weeks}, 1fr)` }}
                        >
                            {monthCells.map((cell) => {
                                const events = monthEventsForDay(cell.key);
                                const maxVisible = MONTH_MAX_VISIBLE;
                                const visible = events.slice(0, maxVisible);
                                const remain = events.length - visible.length;
                                const isToday = isSameYmd(cell.date, today0);

                                const handleCellClick = () => {
                                    if (events.length === 0) return;
                                    const d = cell.date;
                                    setDayListDate(`${d.getMonth() + 1}월 ${d.getDate()}일`);
                                    // 월간 이벤트를 LayoutEvent 형태로 변환
                                    const mapped = events.map((ev) => {
                                        const origId = extractOriginalId(ev.id);
                                        const full = schedules.find((s) => String(s.id) === origId);
                                        const startDate = full ? new Date(full.StartDate) : new Date();
                                        const endDate = full ? new Date(full.EndDate) : new Date();
                                        return {
                                            id: ev.id,
                                            title: ev.title,
                                            robotNo: full?.RobotName ?? "",
                                            robotType: full?.TaskType ?? "",
                                            dayIndex: d.getDay(),
                                            startMin: startDate.getHours() * 60 + startDate.getMinutes(),
                                            endMin: endDate.getHours() * 60 + endDate.getMinutes(),
                                            color: ev.color as WeekEvent["color"],
                                            col: 0,
                                            totalCols: 1,
                                        };
                                    });
                                    setDayListEvents(mapped.sort((a, b) => a.startMin - b.startMin));
                                    setDayListFilterType(selectedRobotTypes.length === 1 ? selectedRobotTypes[0] : "all"); setDayListFilterRobot(selectedRobotNames.length === 1 ? selectedRobotNames[0] : "all"); setIsDayListOpen(true);
                                };

                                return (
                                    <div
                                    key={cell.key}
                                    className={`${styles.monthCell} ${isToday ? styles.monthToday : ""} ${events.length > 0 ? styles.monthCellClickable : ""}`}
                                    onClick={handleCellClick}
                                    >
                                        <div className={styles.dateNumber}>{cell.day}</div>

                                        <div className={styles.cellEvents}>
                                            {visible.map((ev) => (
                                                <div
                                                    key={ev.id}
                                                    className={styles.cellEvent}
                                                >
                                                    <span className={`${styles.cellEventDot} ${statusDotClass(ev.status)}`.trim()} />
                                                    <span className={styles.cellEventText}>{ev.title}</span>
                                                    {ev.startMin != null && <span className={styles.cellEventTime}>{timeLabel(ev.startMin)}</span>}
                                                    {ev.status && <span className={styles.cellEventStatus}>{ev.status}</span>}
                                                </div>
                                            ))}

                                            {remain > 0 && (
                                                <div className={styles.moreBtn}>
                                                    ··· +{remain}건
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </section>
                )}
            </div>
        </div>

        {/* ✅ 월간: 초과 이벤트 모달 (viewType과 무관하게 전역 렌더) */}
            {monthOverflowOpen && monthOverflowDateObj && (
            <div
                className={styles.monthOverflowOverlay}
                onClick={() => setMonthOverflowOpen(false)}
            >
                <div
                className={styles.monthOverflowModal}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                >
                    <div className={styles.monthOverflowHeader}>
                        <div className={styles.monthOverflowTitle}>
                        {monthOverflowDateObj.getFullYear()}년{" "}
                        {monthOverflowDateObj.getMonth() + 1}월{" "}
                        {monthOverflowDateObj.getDate()}일 ({DOW_KR[monthOverflowDateObj.getDay()]})
                        </div>

                        <button
                        type="button"
                        className={styles.monthOverflowClose}
                        onClick={() => setMonthOverflowOpen(false)}
                        aria-label="close"
                        >
                        ✕
                        </button>
                    </div>
                    
                    <div className={styles.monthOverflowInner}>
                                        <div className={styles.monthOverflowList}>
                                            {monthEventsForDay(monthOverflowDateKey)
                                              .slice(MONTH_MAX_VISIBLE)
                                              .map((ev) => (
                                            <button
                                                key={ev.id}
                                                type="button"
                                className={styles.monthOverflowItem}
                                onClick={() => {
                                const detail = toDetailEventFromMonth(ev);
                                if (!detail) return;
                                setSelectedWeekEvent(detail);
                                setIsDetailModalOpen(true);
                                }}
                                title={ev.title}
                            >
                                <span className={`${styles.monthOverflowDot} ${statusDotClass(ev.status)}`.trim()} />
                                <span className={styles.monthOverflowText}>{ev.title}</span>
                            </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            )}

      </>
    )
}
