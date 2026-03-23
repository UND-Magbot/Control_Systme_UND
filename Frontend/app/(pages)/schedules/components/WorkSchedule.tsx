"use client";

import styles from './WorkSchedule.module.css';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import MiniCalendar from './MiniCalendar';
import ScheduleInsert from './ScheduleInsert';
import ScheduleDetail from './ScheduleDetail';
import type { RobotRowData } from '@/app/type';
import { mockScheduleRows, type ScheduleStatus } from "@/app/mock/schedule_data";
import { API_BASE } from "@/app/config";


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
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function hourLabel(h: number) {
  const ampm = h < 12 ? "오전" : "오후";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${display}시`;
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
    case "대기": return "blue";
    case "진행": case "진행중": return "yellow";
    case "오류": return "red";
    case "완료": return "green";
    default: return "green";
  }
}

const MONTH_MAX_VISIBLE = 2;

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
    type DBSchedule = {
        id: number;
        RobotName: string;
        WorkName: string;
        TaskType: string;
        StartDate: string;
        EndDate: string;
        TaskStatus: string;
        WayName: string;
    };

    const [schedules, setSchedules] = useState<DBSchedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSchedules = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/DB/schedule`);
            if (!res.ok) throw new Error("서버 응답 오류");
            const data = await res.json();
            setSchedules(data);
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
    const monthEvents: MonthEvent[] = useMemo(() => {
        const y = viewDate.getFullYear();
        const m = viewDate.getMonth();

        return schedules
            .filter((s) => {
            const d = new Date(s.StartDate);
            return d.getFullYear() === y && d.getMonth() === m;
            })
            .map((s) => ({
            id: String(s.id),
            title: s.WorkName,
            date: ymd(new Date(s.StartDate)),
            color: statusToColor(s.TaskStatus),
            status: s.TaskStatus as ScheduleStatus,
            }));
    }, [schedules, viewDate]);

    const filteredMonthEvents: MonthEvent[] = useMemo(() => {
        if (!isTypeFilterOn && !isNameFilterOn) return monthEvents;
        return monthEvents.filter((ev) => {
            const full = schedules.find((s) => String(s.id) === ev.id);
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
        end.setDate(start.getDate() + 7);

        return schedules
            .filter((s) => {
            const d = new Date(s.StartDate);
            return d >= start && d < end;
            })
            .map((s) => {
            const d = new Date(s.StartDate);

            const startMin =
                d.getHours() * 60 + d.getMinutes();

            const endDate = new Date(s.EndDate);
            const endMin =
                endDate.getHours() * 60 + endDate.getMinutes();

            return {
                id: String(s.id),
                title: s.WorkName,
                robotNo: s.RobotName,
                robotType: s.TaskType,
                dayIndex: d.getDay(),
                startMin,
                endMin,
                color: statusToColor(s.TaskStatus),
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

    // 겹침 그룹별 이벤트 맵 (col 0 대표 + 나머지)
    const groupedEvents = useMemo(() => {
        const map = new Map<string, LayoutEvent[]>();
        for (const ev of layoutWeekEvents) {
            const start = Math.max(0, Math.min(24 * 60, ev.startMin));
            const key = `${ev.dayIndex}-${start}`;
            const arr = map.get(key) ?? [];
            arr.push(ev);
            map.set(key, arr);
        }
        return map;
    }, [layoutWeekEvents]);

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
    const hourRowPx = 38;     // 1시간 칸 높이
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


    // 작업등록 모달 open/close 상태
    const [isInsertModalOpen, setIsInsertModalOpen] = useState(false);

    // 작업상세 모달 open/close 상태
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

    // ✅ 클릭된 주간 이벤트 저장
    const [selectedWeekEvent, setSelectedWeekEvent] = useState<WeekEvent | null>(null);

    const handleClickWeekEvent = (event: WeekEvent) => {
        setSelectedWeekEvent(event);
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
    const full = schedules.find((s) => String(s.id) === ev.id);
    if (!full) return null;

    const d = new Date(full.StartDate);
    const end = new Date(full.EndDate);

    return {
    id: String(full.id),
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

                                    {/* 7일 컬럼 배경(오늘 강조) */}
                                    {Array.from({ length: 7 }).map((_, i) => {
                                        const isToday = isSameYmd(weekDates[i], today0);

                                        return (
                                            <div
                                            key={`bg-${i}`}
                                            className={`${styles.dayColBg} ${isToday ? styles.todayColBg : ""}`}
                                            style={{
                                                left: `${(i / 7) * 100}%`,
                                                width: `${100 / 7}%`,
                                                height: gridHeight,
                                            }}
                                            />
                                        );
                                    })}

                                    {/* Now 라인 */}
                                    {todayDayIndex >= 0 && (
                                        <div
                                            className={styles.nowLine}
                                            style={{
                                                top: (nowMinutes / 60) * hourRowPx,
                                                left: `${(todayDayIndex / 7) * 100}%`,
                                                width: `${100 / 7}%`,
                                            }}
                                        />
                                    )}

                                    {/* 이벤트 (겹침 → 대표 1개 + 드롭다운) */}
                                    {Array.from(groupedEvents.entries()).map(([groupKey, evts]) => {
                                        const first = evts[0];
                                        const start = Math.max(0, Math.min(totalMinutes, first.startMin));
                                        const end = Math.max(0, Math.min(totalMinutes, first.endMin));
                                        const dur = Math.max(10, end - start);

                                        const top = (start / 60) * hourRowPx;
                                        const height = (dur / 60) * hourRowPx;

                                        const dayLeftPct = (first.dayIndex / 7) * 100;
                                        const dayWidthPct = 100 / 7;
                                        const padding = 4;

                                        const fullWidth = `calc(${dayWidthPct}% - ${padding * 2}px)`;
                                        const fullLeft = `calc(${dayLeftPct}% + ${padding}px)`;
                                        const isOpen = openDropdown === groupKey;
                                        const hasMultiple = evts.length > 1;

                                        return (
                                        <React.Fragment key={groupKey}>
                                            {/* 대표 이벤트 */}
                                            <div
                                                className={`${styles.event} ${colorClass(first.color)}`}
                                                style={{
                                                    top,
                                                    height,
                                                    left: fullLeft,
                                                    width: fullWidth,
                                                }}
                                                title={first.title}
                                                onClick={() => {
                                                    if (hasMultiple) {
                                                        setOpenDropdown(isOpen ? null : groupKey);
                                                    } else {
                                                        handleClickWeekEvent(first);
                                                    }
                                                }}
                                            >
                                                <span className={styles.eventCircle}></span>
                                                {first.title}
                                                {hasMultiple && (
                                                    <span className={styles.eventBadge}>+{evts.length - 1}</span>
                                                )}
                                                {dur >= 30 && (
                                                    <span className={styles.eventTime}>
                                                        {hourLabel(Math.floor(first.startMin / 60))} ~ {hourLabel(Math.floor(first.endMin / 60))}
                                                    </span>
                                                )}
                                            </div>

                                            {/* 드롭다운 */}
                                            {isOpen && (
                                                <div
                                                    className={styles.eventDropdown}
                                                    style={{
                                                        position: 'absolute',
                                                        top: top + height + 2,
                                                        left: fullLeft,
                                                        width: fullWidth,
                                                        zIndex: 20,
                                                    }}
                                                >
                                                    {evts.map((ev) => (
                                                        <button
                                                            key={ev.id}
                                                            type="button"
                                                            className={styles.eventDropdownItem}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setOpenDropdown(null);
                                                                handleClickWeekEvent(ev);
                                                            }}
                                                        >
                                                            <span className={`${styles.eventCircle} ${colorClass(ev.color)}`}></span>
                                                            <span className={styles.eventDropdownText}>{ev.title}</span>
                                                            <span className={styles.eventDropdownTime}>
                                                                {hourLabel(Math.floor(ev.startMin / 60))} ~ {hourLabel(Math.floor(ev.endMin / 60))}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </React.Fragment>
                                        );
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

                {isDetailModalOpen && selectedWeekEvent && (
                    <ScheduleDetail
                        isOpen={isDetailModalOpen}
                        onClose={handleCloseDetail}
                        event={selectedWeekEvent}
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

                                return (
                                    <div
                                    key={cell.key}
                                    className={`${styles.monthCell} ${isToday ? styles.monthToday : ""}`}
                                    >
                                        <div className={styles.dateNumber}>{cell.day}</div>

                                        <div className={styles.cellEvents}>
                                            {visible.map((ev) => (
                                                <button
                                                    key={ev.id}
                                                    type="button"
                                                    className={`${styles.cellEvent} ${ev.color ? monthColorClass[ev.color] : styles.evGreen}`}
                                                    onClick={(e) => {
                                                    e.stopPropagation();
                                                    const detail = toDetailEventFromMonth(ev);
                                                    if (!detail) return;
                                                    setSelectedWeekEvent(detail);
                                                    setIsDetailModalOpen(true);
                                                    }}
                                                >
                                                    <span className={`${styles.cellEventDot} ${statusDotClass(ev.status)}`.trim()} />
                                                    <span className={styles.cellEventText}>{ev.title}</span>
                                                </button>
                                            ))}

                                            {remain > 0 && (
                                                <button
                                                    type="button"
                                                    className={styles.moreBtn}
                                                    onClick={(e) => {
                                                    e.stopPropagation();
                                                    setMonthOverflowDateKey(cell.key);
                                                    setMonthOverflowDateObj(cell.date);
                                                    setMonthOverflowOpen(true);
                                                    }}
                                                >
                                                    +{remain}건
                                                </button>
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
