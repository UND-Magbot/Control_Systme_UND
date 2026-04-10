"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import styles from "./LogList.module.css";
import videoListStyles from "./VideoList.module.css";
import Pagination from "@/app/components/pagination";

import LogDetailModal from "./LogDetailModal";
import modalStyles from "@/app/components/modal/Modal.module.css";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import type { FilterOption } from "@/app/components/button/FilterSelectBox";
import { BaseCalendar, getTodayStr, parseYMD, formatDateToYMD } from "@/app/components/calendar/index";
import type { LogItem, LogCategory, Period } from "@/app/type";
import { LOG_CATEGORY_LABELS } from "@/app/type";
import { getLogData } from "@/app/lib/logData";

const THEAD_HEIGHT = 44;
const ROW_HEIGHT = 48;
const DEBOUNCE_MS = 400;

const LOG_TYPE_ITEMS: (FilterOption & { value: LogCategory })[] = [
  { id: "system", label: "시스템", value: "system" },
  { id: "robot", label: "로봇", value: "robot" },
  { id: "schedule", label: "스케줄", value: "schedule" },
  { id: "error", label: "에러", value: "error" },
];

const PERIOD_ITEMS: { key: Period | "Total"; label: string }[] = [
  { key: "Total", label: "전체" },
  { key: "today", label: "당일" },
  { key: "3days", label: "3일" },
  { key: "1week", label: "1주" },
  { key: "1month", label: "1달" },
];

const BADGE_CLASS_MAP: Record<string, string> = {
  robot: styles.badgeRobot,
  system: styles.badgeSystem,
  schedule: styles.badgeSchedule,
  error: styles.badgeError,
};

function getToday(): string {
  return getTodayStr();
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/** 기간 프리셋 → 시작/종료일 계산 */
function periodToDates(period: Period | "Total"): { start: string; end: string } {
  const today = new Date();
  const end = formatDateToYMD(today);
  const start = new Date(today);

  if (period === "today") { /* start = today */ }
  else if (period === "3days") start.setDate(start.getDate() - 3);
  else if (period === "1week") start.setDate(start.getDate() - 7);
  else if (period === "1month") start.setMonth(start.getMonth() - 1);
  else if (period === "Total") return { start: "", end: "" };

  return { start: formatDateToYMD(start), end };
}

type LogListProps = {
  logData: LogItem[];
  initialSearch?: string;
};

export default function LogList({ logData, initialSearch }: LogListProps) {
  // 필터 상태
  const [searchQuery, setSearchQuery] = useState(initialSearch || "");
  const [selectedLogType, setSelectedLogType] = useState<LogCategory | null>(null);
  const [startDate, setStartDate] = useState(getToday());
  const [endDate, setEndDate] = useState(getToday());
  const [selectedPeriod, setSelectedPeriod] = useState<Period | "Total" | null>("today");

  // 컨테이너 높이 기반 동적 pageSize 계산
  const containerRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const paginationRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(7);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const calcRows = () => {
      const containerH = container.clientHeight;
      const topBarH = topBarRef.current?.offsetHeight ?? 0;
      const paginationH = paginationRef.current?.offsetHeight ?? 0;
      const available = containerH - topBarH - paginationH - THEAD_HEIGHT - 26;
      const rows = Math.max(1, Math.floor(available / ROW_HEIGHT));
      setPageSize(rows);
    };

    calcRows();

    const ro = new ResizeObserver(calcRows);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // 서버 페이지네이션 상태
  const [filteredData, setFilteredData] = useState<LogItem[]>(logData);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPage, setServerPage] = useState(1);

  // 가장 이른 로그 날짜 (마운트 시 1회 조회, "전체" 클릭 즉시 반영용)
  const [earliestDate, setEarliestDate] = useState<string | null>(null);
  useEffect(() => {
    getLogData({ size: 1 }).then((res) => {
      if (res.earliest_date) setEarliestDate(res.earliest_date);
    }).catch(() => {});
  }, []);
  const [isLoading, setIsLoading] = useState(false);

  // 알림 모달
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // 캘린더 팝업
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarField, setCalendarField] = useState<"start" | "end" | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  // 상세 모달
  const [selectedLogItem, setSelectedLogItem] = useState<LogItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // 캘린더 외부 클릭 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
        setCalendarField(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const openCalendar = (field: "start" | "end") => {
    setCalendarField(field);
    setCalendarOpen(true);
  };

  // 달력 선택 시 자동 보정 (시작 > 종료 방지)
  const handleCalendarSelect = (field: "start" | "end", date: string) => {
    if (field === "start") {
      setStartDate(date);
      if (date > endDate) setEndDate(date);
    } else {
      setEndDate(date);
      if (date < startDate) setStartDate(date);
    }
    setSelectedPeriod(null);
    setCalendarOpen(false);
    setCalendarField(null);
  };

  // 기간 프리셋 클릭
  const handlePeriodClick = (period: Period | "Total") => {
    setSelectedPeriod(period);
    if (period === "Total") {
      setStartDate(earliestDate || "");
      setEndDate(getToday());
    } else {
      const { start, end } = periodToDates(period);
      setStartDate(start);
      setEndDate(end);
    }
  };

  // 서버 페이지네이션 API 호출 (디바운스)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  const fetchLogs = useCallback(async (page: number) => {
    if (startDate && endDate && startDate > endDate) return;

    const id = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const res = await getLogData({
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        category: selectedLogType ?? undefined,
        search: searchQuery.trim() || undefined,
        page,
        size: pageSize,
      });
      if (id === fetchIdRef.current) {
        setFilteredData(res.items);
        setServerTotal(res.total);
        setServerPage(page);
        if (res.earliest_date && res.earliest_date !== earliestDate) {
          setEarliestDate(res.earliest_date);
        }
      }
    } catch {
      if (id === fetchIdRef.current) {
        setAlertMessage("로그 조회에 실패했습니다.");
      }
    } finally {
      if (id === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [startDate, endDate, selectedLogType, searchQuery, pageSize, earliestDate]);

  // 필터 변경 → 디바운스 후 1페이지로 리셋
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchLogs(1), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, selectedLogType, startDate, endDate, pageSize]);

  // 페이지 변경 → 즉시 호출
  const handleLogPageChange = (page: number) => {
    fetchLogs(page);
  };

  // 초기화
  const handleReset = () => {
    const today = getToday();
    setSearchQuery("");
    setSelectedLogType(null);
    setStartDate(today);
    setEndDate(today);
    setSelectedPeriod("today");
  };

  const logPage = serverPage;
  const pagedData = filteredData;
  const logTotalItems = serverTotal;

  // 상세보기
  const openDetail = (item: LogItem) => {
    setSelectedLogItem(item);
    setIsDetailModalOpen(true);
  };

  const closeDetail = () => {
    setIsDetailModalOpen(false);
    setSelectedLogItem(null);
  };

  // 현재 선택된 타입 라벨
  const selectedTypeLabel = LOG_TYPE_ITEMS.find((o) => o.value === selectedLogType)?.label ?? null;

  // Excel 내보내기 (전체 데이터 조회 후 다운로드)
  const exportToExcel = async () => {
    const allRes = await getLogData({
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      category: selectedLogType ?? undefined,
      search: searchQuery.trim() || undefined,
      size: 10000,
    });
    const rows = allRes.items.map((log) => ({
      "발생 일시": formatDateTime(log.CreatedAt),
      "로그 타입": LOG_CATEGORY_LABELS[log.Category] ?? log.Category,
      "메시지": log.Message,
      "데이터": JSON.stringify({
        id: log.id,
        Category: log.Category,
        Action: log.Action,
        Message: log.Message,
        Detail: log.Detail,
        RobotId: log.RobotId,
        RobotName: log.RobotName,
        CreatedAt: log.CreatedAt,
      }),
    }));

    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "로그");
    XLSX.writeFile(wb, `log_export_${getToday()}.xlsx`);
  };


  return (
    <div ref={containerRef} className={styles.logContainer}>
      {/* 상단 헤더: 타이틀 + 필터 + Excel */}
      <div ref={topBarRef} className={styles.topBar}>
        <h2>로그 관리</h2>

        <div className={styles.filterBar}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="로그 메시지를 입력하세요."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <span className={styles.filterLabel}>타입</span>
          <FilterSelectBox
            items={LOG_TYPE_ITEMS}
            selectedLabel={selectedTypeLabel}
            placeholder="로그 타입"
            width={120}
            onSelect={(item) => {
              if (item) {
                const found = LOG_TYPE_ITEMS.find((o) => o.id === item.id);
                setSelectedLogType(found?.value ?? null);
              } else {
                setSelectedLogType(null);
              }
            }}
          />

          <div className={videoListStyles.dtPeriod}>
            {PERIOD_ITEMS.map(({ key, label }) => (
              <div
                key={key}
                className={`${videoListStyles.periodItem} ${selectedPeriod === key ? videoListStyles.active : ""}`}
                onClick={() => handlePeriodClick(key)}
              >
                {label}
              </div>
            ))}
          </div>

          <div className={styles.dateWrapper} ref={calendarField === "start" ? calendarRef : undefined}>
            <div className={styles.dateInput} onClick={() => openCalendar("start")}>
              <span>{startDate}</span>
              <img src="/icon/search_calendar.png" alt="calendar" />
            </div>
            {calendarOpen && calendarField === "start" && (
              <div className={styles.calendarPopup}>
                <BaseCalendar
                  mode="range"
                  startDate={startDate}
                  endDate={endDate}
                  activeField="start"
                  onRangeSelect={handleCalendarSelect}
                  showTodayButton
                  maxDate={getToday()}
                  initialViewDate={parseYMD(startDate)}
                />
              </div>
            )}
          </div>

          <span className={styles.dateSeparator}>~</span>

          <div className={styles.dateWrapper} ref={calendarField === "end" ? calendarRef : undefined}>
            <div className={styles.dateInput} onClick={() => openCalendar("end")}>
              <span>{endDate}</span>
              <img src="/icon/search_calendar.png" alt="calendar" />
            </div>
            {calendarOpen && calendarField === "end" && (
              <div className={styles.calendarPopup}>
                <BaseCalendar
                  mode="range"
                  startDate={startDate}
                  endDate={endDate}
                  activeField="end"
                  onRangeSelect={handleCalendarSelect}
                  showTodayButton
                  maxDate={getToday()}
                  initialViewDate={parseYMD(endDate)}
                />
              </div>
            )}
          </div>

          <button className={styles.resetButton} onClick={handleReset}>초기화</button>
          <button className={styles.excelButton} onClick={exportToExcel}>Excel 내보내기</button>
        </div>
      </div>

      {/* 테이블 */}
      <div className={styles.tableWrapper}>
        <table className={styles.logTable}>
          <thead>
            <tr>
              <th>발생 일시</th>
              <th>로그 타입</th>
              <th>메시지</th>
              <th>상세</th>
            </tr>
          </thead>
          <tbody>
            {pagedData.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className={styles.emptyState}>조회된 로그가 없습니다.</div>
                </td>
              </tr>
            ) : (
              pagedData.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.CreatedAt)}</td>
                  <td>
                    <span className={`${styles.badge} ${BADGE_CLASS_MAP[log.Category] ?? ""}`}>
                      {LOG_CATEGORY_LABELS[log.Category] ?? log.Category}
                    </span>
                  </td>
                  <td className={styles.messageCell}>{log.Message}</td>
                  <td>
                    <button className={styles.detailButton} onClick={() => openDetail(log)}>
                      상세보기
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 하단 페이지네이션 */}
      <div ref={paginationRef} className={styles.paginationArea}>
        <Pagination
          totalItems={logTotalItems}
          currentPage={logPage}
          onPageChange={handleLogPageChange}
          pageSize={pageSize}
          blockSize={5}
        />
        {logTotalItems > 0 && (
          <div className={styles.totalCount}>
            총 <span>{logTotalItems}</span> 개
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      <LogDetailModal
        isOpen={isDetailModalOpen}
        onClose={closeDetail}
        logItem={selectedLogItem}
      />

      {/* 알림 모달 */}
      {alertMessage && (
        <div className={modalStyles.confirmOverlay}>
          <div className={modalStyles.confirmBox}>
            <button className={modalStyles.closeBox} onClick={() => setAlertMessage(null)}>
              <img src="/icon/close_btn.png" alt="닫기" />
            </button>
            <div className={modalStyles.confirmContents}>{alertMessage}</div>
            <div className={modalStyles.confirmButtons}>
              <button className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgBlue}`} onClick={() => setAlertMessage(null)}>
                <span className={modalStyles.btnIcon}><img src="/icon/check.png" alt="확인" /></span>
                <span>확인</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
