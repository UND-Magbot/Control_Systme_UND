"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import styles from "./LogList.module.css";
import videoListStyles from "./VideoList.module.css";
import Pagination from "@/app/components/pagination";
import LogDetailModal from "./LogDetailModal";
import modalStyles from "@/app/components/modal/Modal.module.css";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import type { FilterOption } from "@/app/components/button/FilterSelectBox";
import { BaseCalendar, getTodayStr, parseYMD } from "@/app/components/calendar/index";
import type { LogItem, LogCategory } from "@/app/type";
import { LOG_CATEGORY_LABELS } from "@/app/type";
import * as XLSX from "xlsx";

const THEAD_HEIGHT = 44;
const ROW_HEIGHT = 48;

const LOG_TYPE_ITEMS: (FilterOption & { value: LogCategory })[] = [
  { id: "system", label: "시스템", value: "system" },
  { id: "robot", label: "로봇", value: "robot" },
  { id: "schedule", label: "스케줄", value: "schedule" },
  { id: "error", label: "에러", value: "error" },
];

const BADGE_CLASS_MAP: Record<string, string> = {
  robot: styles.badgeRobot,
  system: styles.badgeSystem,
  schedule: styles.badgeSchedule,
  error: styles.badgeError,
};

const TIME_ITEMS: FilterOption[] = [
  "00:00", "01:00", "02:00", "03:00", "04:00", "05:00",
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
  "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
  "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "23:59",
].map((t) => ({ id: t, label: t }));

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

type LogListProps = {
  logData: LogItem[];
};

export default function LogList({ logData }: LogListProps) {
  // 필터 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLogType, setSelectedLogType] = useState<LogCategory | null>(null);
  const [startDate, setStartDate] = useState(getToday());
  const [endDate, setEndDate] = useState(getToday());
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");

  // 페이지네이션
  const [logPage, setLogPage] = useState(1);

  // tableWrapper 높이 기반 동적 pageSize 계산
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(7);

  useEffect(() => {
    const el = tableWrapperRef.current;
    if (!el) return;

    const calcRows = () => {
      const rows = Math.max(1, Math.floor((el.clientHeight - THEAD_HEIGHT) / ROW_HEIGHT));
      setPageSize(rows);
    };

    calcRows();

    const ro = new ResizeObserver(calcRows);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 필터된 데이터 (초기: 오늘 날짜 기준 필터링)
  const [filteredData, setFilteredData] = useState<LogItem[]>(() => {
    const today = getToday();
    const start = new Date(`${today}T00:00:00`);
    const end = new Date(`${today}T23:59:59`);
    return logData.filter((log) => {
      const d = new Date(log.CreatedAt);
      return d >= start && d <= end;
    });
  });

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

  const handleCalendarSelect = (field: "start" | "end", date: string) => {
    if (field === "start") setStartDate(date);
    else setEndDate(date);
    setCalendarOpen(false);
    setCalendarField(null);
  };

  // 필터 적용
  const applyFilters = useCallback(() => {
    let filtered = [...logData];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((log) => log.Message.toLowerCase().includes(q));
    }

    if (selectedLogType) {
      filtered = filtered.filter((log) => log.Category === selectedLogType);
    }

    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:59`);

    if (start > end) {
      setAlertMessage("시작 일시가 종료 일시보다 이후입니다.\n조회 조건을 확인해주세요.");
      return;
    }

    filtered = filtered.filter((log) => {
      const d = new Date(log.CreatedAt);
      return d >= start && d <= end;
    });

    setFilteredData(filtered);
    setLogPage(1);
  }, [logData, searchQuery, selectedLogType, startDate, endDate, startTime, endTime]);

  // 초기화 (초기 진입과 동일하게 오늘 날짜 기준 필터)
  const handleReset = () => {
    const today = getToday();
    const start = new Date(`${today}T00:00:00`);
    const end = new Date(`${today}T23:59:59`);

    setSearchQuery("");
    setSelectedLogType(null);
    setStartDate(today);
    setEndDate(today);
    setStartTime("00:00");
    setEndTime("23:59");
    setFilteredData(
      logData.filter((log) => {
        const d = new Date(log.CreatedAt);
        return d >= start && d <= end;
      })
    );
    setLogPage(1);
  };

  // 현재 페이지 데이터
  const pagedData = useMemo(() => {
    const startIdx = (logPage - 1) * pageSize;
    return filteredData.slice(startIdx, startIdx + pageSize);
  }, [filteredData, logPage, pageSize]);

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

  // Excel 내보내기
  const exportToExcel = () => {
    const rows = filteredData.map((log) => ({
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

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "로그");
    XLSX.writeFile(wb, `log_export_${getToday()}.xlsx`);
  };


  return (
    <div className={styles.logContainer}>
      {/* 상단 헤더: 타이틀 + Excel */}
      <div className={videoListStyles.videoListTopPosition}>
        <h2>로그 관리</h2>
        <button className={styles.excelButton} onClick={exportToExcel}>Excel 내보내기</button>
      </div>

      {/* 필터 바 */}
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

        <span className={styles.filterLabel}>시작</span>
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
                initialViewDate={parseYMD(startDate)}
              />
            </div>
          )}
        </div>

        <span className={styles.filterLabel}>종료</span>
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
                initialViewDate={parseYMD(endDate)}
              />
            </div>
          )}
        </div>

        <span className={styles.filterLabel}>시간</span>
        <FilterSelectBox
          items={TIME_ITEMS}
          selectedLabel={startTime}
          placeholder="시작"
          showTotal={false}
          width={90}
          onSelect={(item) => {
            if (item) setStartTime(item.label);
          }}
        />
        <span className={styles.timeSeparator}>-</span>
        <FilterSelectBox
          items={TIME_ITEMS}
          selectedLabel={endTime}
          placeholder="종료"
          showTotal={false}
          width={90}
          onSelect={(item) => {
            if (item) setEndTime(item.label);
          }}
        />

        <button className={styles.resetButton} onClick={handleReset}>초기화</button>
        <button className={styles.searchButton} onClick={applyFilters}>조회</button>
      </div>

      {/* 테이블 */}
      <div ref={tableWrapperRef} className={styles.tableWrapper}>
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
      <div className={styles.paginationArea}>
        <Pagination
          totalItems={filteredData.length}
          currentPage={logPage}
          onPageChange={setLogPage}
          pageSize={pageSize}
          blockSize={5}
        />
        {filteredData.length > 0 && (
          <div className={styles.totalCount}>
            총 <span>{filteredData.length}</span> 개
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
