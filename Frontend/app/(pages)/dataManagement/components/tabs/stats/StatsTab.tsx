"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import styles from '../../DataManagementTabs.module.css';
import BaseCalendar from "@/app/components/calendar/BaseCalendar";
import { useOutsideClick } from "@/app/hooks/useOutsideClick";
import type { RobotRowData, RobotType, Period } from "@/app/types";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import { apiFetch } from "@/app/lib/api";
import { convertMinutesToText } from "@/app/utils/convertMinutesToText";
import {
  buildRobotTypeBarFromApi,
  buildTaskBarFromApi,
  buildTimeBarFromApi,
  buildErrorBarFromApi,
} from "@/app/utils/Charts";
import KpiSummaryCard from "./KpiSummaryCard";
import ComparisonCard from "./ComparisonCard";
import DonutWithLegend from "./DonutWithLegend";
import VerticalBarChart from "./VerticalBarChart";
import { useStatsFetch } from "../../../hooks/useStatsFetch";
import { periodFormatDate } from "../../../utils/videoHelpers";
import { computeStatsSummary } from "../../../utils/computeStatsSummary";
import { exportStatsToExcel } from "../../../utils/exportStats";

type Props = {
  robotTypeData: RobotType[];
  robots: RobotRowData[];
  onLoaded?: () => void;
};

export default function StatsTab({ robotTypeData, robots, onLoaded }: Props) {
  // ── 필터 상태 ──
  const [selectedRobotType, setSelectedRobotType] = useState<RobotType | null>(null);
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);

  const todayInit = useMemo(() => periodFormatDate(new Date()), []);
  const [dtStartDate, setDtStartDate] = useState<string | null>(todayInit);
  const [dtEndDate, setDtEndDate] = useState<string | null>(todayInit);
  const [dtPeriod, setDtPeriod] = useState<Period | null>("today");

  // 가장 이른 데이터 날짜 (1회 조회)
  const [dtEarliestDate, setDtEarliestDate] = useState<string | null>(null);
  useEffect(() => {
    apiFetch("/DB/statistics/earliest-date")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.earliest_date) setDtEarliestDate(data.earliest_date); })
      .catch(() => {});
  }, []);

  // 달력
  const [dtCalendarOpen, setDtCalendarOpen] = useState(false);
  const [dtActiveField, setDtActiveField] = useState<"start" | "end">("start");
  const dtCalendarRef = useRef<HTMLDivElement>(null);
  useOutsideClick(dtCalendarRef, useCallback(() => setDtCalendarOpen(false), []));

  // 데이터 fetch (현재 + 이전 기간 병렬)
  const { statsData, prevStatsData } = useStatsFetch({
    enabled: true,
    selectedRobotType,
    selectedRobot,
    startDate: dtStartDate,
    endDate: dtEndDate,
    onLoaded,
  });

  // 로봇 명 셀렉트 옵션 (로봇 종류 필터 연동)
  const robotNameItems = useMemo(() => {
    const source = selectedRobotType ? robots.filter((r) => r.type === selectedRobotType.label) : robots;
    return source.map((r) => ({ id: r.id, label: r.no }));
  }, [robots, selectedRobotType]);

  // 차트 데이터
  const robotTypeBar = useMemo(() => (statsData ? buildRobotTypeBarFromApi(statsData.robot_types) : []), [statsData]);
  const taskBar = useMemo(() => (statsData ? buildTaskBarFromApi(statsData.tasks) : []), [statsData]);
  const timeBar = useMemo(() => (statsData ? buildTimeBarFromApi(statsData.time_minutes) : []), [statsData]);
  const errorBar = useMemo(() => (statsData ? buildErrorBarFromApi(statsData.errors) : []), [statsData]);

  const prevRobotTypeBar = useMemo(() => (prevStatsData ? buildRobotTypeBarFromApi(prevStatsData.robot_types) : []), [prevStatsData]);
  const prevTaskBar = useMemo(() => (prevStatsData ? buildTaskBarFromApi(prevStatsData.tasks) : []), [prevStatsData]);
  const prevTimeBar = useMemo(() => (prevStatsData ? buildTimeBarFromApi(prevStatsData.time_minutes) : []), [prevStatsData]);
  const prevErrorBar = useMemo(() => (prevStatsData ? buildErrorBarFromApi(prevStatsData.errors) : []), [prevStatsData]);

  // 비교 라벨
  const prevLabel = useMemo(() => {
    if (!dtStartDate || !dtEndDate) return "";
    const diffDays = Math.round((new Date(dtEndDate).getTime() - new Date(dtStartDate).getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "전일";
    if (diffDays <= 7) return "전주";
    if (diffDays <= 31) return "전월";
    if (diffDays <= 365) return "전년";
    return "";
  }, [dtStartDate, dtEndDate]);

  const statsSummary = useMemo(
    () => computeStatsSummary(statsData, prevStatsData, prevLabel),
    [statsData, prevStatsData, prevLabel],
  );
  const { totalRobots, totalTasks, totalErrors, opHText, opMText, timeHText, timeMText } = statsSummary;

  // 기간 버튼
  const handleDtPeriodClick = (period: Period | null) => {
    setDtPeriod(period);
    const today = new Date();

    if (period === "Total" || !period) {
      setDtStartDate(dtEarliestDate);
      setDtEndDate(periodFormatDate(today));
      return;
    }

    const start = new Date(today);
    if (period === "today") { /* start = today */ }
    else if (period === "1week") start.setDate(start.getDate() - 7);
    else if (period === "1month") start.setMonth(start.getMonth() - 1);
    else if (period === "1year") start.setFullYear(start.getFullYear() - 1);

    setDtStartDate(periodFormatDate(start));
    setDtEndDate(periodFormatDate(today));
  };

  const handleExportStatsToExcel = async () => {
    if (!statsData) return;
    await exportStatsToExcel(statsData);
  };

  return (
    <div className={styles.DT}>
      <div className={styles.videoListTopPosition}>
        <h2>통계 관리</h2>
        <div className={styles.dtSearch}>
          <div className={styles.videoSelect}>
            <FilterSelectBox
              items={robotTypeData.map((t) => ({ id: t.id, label: t.label }))}
              selectedLabel={selectedRobotType?.label ?? null}
              placeholder="로봇 종류"
              showTotal={true}
              onSelect={(item) => {
                if (item) {
                  const type = robotTypeData.find((t) => t.label === item.label);
                  if (type) {
                    setSelectedRobotType(type);
                    if (selectedRobot && selectedRobot.type !== type.label) setSelectedRobot(null);
                  }
                } else {
                  setSelectedRobotType(null);
                }
              }}
            />
            <FilterSelectBox
              items={robotNameItems}
              selectedLabel={selectedRobot?.no ?? null}
              placeholder="로봇 명"
              showTotal={robots.length > 0}
              onSelect={(item) => {
                if (item) {
                  const r = robots.find((r) => r.no === item.label);
                  if (r) {
                    setSelectedRobot(r);
                    if (selectedRobotType && selectedRobotType.label !== r.type) setSelectedRobotType(null);
                  }
                } else {
                  setSelectedRobot(null);
                }
              }}
            />
          </div>
          <div className={styles.dtPeriod}>
            {(
              [
                { key: "Total", label: "전체" },
                { key: "today", label: "당일" },
                { key: "1week", label: "1주" },
                { key: "1month", label: "1달" },
                { key: "1year", label: "1년" },
              ] as const
            ).map(({ key, label }) => (
              <div
                key={key}
                className={`${styles.periodItem} ${dtPeriod === key ? styles.active : ""}`}
                onClick={() => handleDtPeriodClick(key)}
              >
                {label}
              </div>
            ))}
          </div>
          <div ref={dtCalendarRef} className={styles.dtDateRange}>
            <div
              className={`${styles.dtDateInput} ${dtActiveField === "start" && dtCalendarOpen ? styles.active : ""}`}
              onClick={() => { setDtActiveField("start"); setDtCalendarOpen(true); }}
            >
              <div>{dtStartDate ?? "시작일"}</div>
              <img src="/icon/search_calendar.png" alt="calendar" />
            </div>
            <div className={styles.dtDateSep}>~</div>
            <div
              className={`${styles.dtDateInput} ${dtActiveField === "end" && dtCalendarOpen ? styles.active : ""}`}
              onClick={() => { setDtActiveField("end"); setDtCalendarOpen(true); }}
            >
              <div>{dtEndDate ?? "종료일"}</div>
              <img src="/icon/search_calendar.png" alt="calendar" />
            </div>
            {dtCalendarOpen && (
              <div className={styles.dtCalendarDropdown}>
                <BaseCalendar
                  mode="range"
                  startDate={dtStartDate}
                  endDate={dtEndDate}
                  activeField={dtActiveField}
                  onRangeSelect={(field, date) => {
                    if (field === "start") {
                      setDtStartDate(date);
                      if (dtEndDate && date > dtEndDate) setDtEndDate(date);
                      setDtActiveField("end");
                    } else {
                      setDtEndDate(date);
                      if (dtStartDate && date < dtStartDate) setDtStartDate(date);
                      setDtCalendarOpen(false);
                    }
                    setDtPeriod(null);
                  }}
                  maxDate={periodFormatDate(new Date())}
                  showTodayButton
                />
              </div>
            )}
          </div>
          <button className={styles.excelButton} onClick={handleExportStatsToExcel}>Excel 내보내기</button>
        </div>
      </div>

      {/* ── 3단 레이아웃: KPI 요약 → 상세 차트 → 기간 비교 ── */}
      <div className={styles.statsLayout}>
        {/* Section 1: KPI 요약 카드 */}
        <div className={styles.kpiRow}>
          <KpiSummaryCard title="로봇 현황" color="#92d4f4" value={totalRobots.toString()} unit="대" />
          <KpiSummaryCard
            title="운행 시간"
            color="#0e8ebf"
            value={`${opHText.replace("h", "")}h ${opMText.replace("m", "")}m`}
            subValue={`가동률 ${statsSummary.opRate}%`}
            subColor="#4db8e8"
          />
          <KpiSummaryCard
            title="작업 현황"
            color="#77a251"
            value={totalTasks.toLocaleString()}
            unit="건"
            subValue={`성공률 ${statsSummary.taskSuccessRate}%`}
            subColor="#77a251"
          />
          <KpiSummaryCard
            title="에러 현황"
            color="#c2434c"
            value={totalErrors.toString()}
            unit="건"
          />
        </div>

        {/* Section 2: 상세 차트 4열 */}
        <div className={styles.detailRow}>
          <div className={styles.chartCard}>
            <div className={styles.cellHead}>
              <div className={styles.cellDot} style={{ background: "#92d4f4" }} />
              <h3>로봇 타입</h3>
              <span className={styles.cellSum} style={{ color: "#92d4f4" }}>
                {totalRobots}<span>대</span>
              </span>
            </div>
            <VerticalBarChart
              items={robotTypeBar}
              color="#92d4f4"
              prevItems={prevRobotTypeBar.length > 0 ? prevRobotTypeBar : undefined}
              prevLabel={prevLabel}
            />
          </div>

          <div className={styles.chartCard}>
            <div className={styles.cellHead}>
              <div className={styles.cellDot} style={{ background: "#0e8ebf" }} />
              <h3>시간 통계</h3>
              <span className={styles.cellSum} style={{ color: "#4db8e8" }}>
                {timeHText.replace("h", "")}<span>h</span> {timeMText.replace("m", "")}<span>m</span>
              </span>
            </div>
            <VerticalBarChart
              items={timeBar}
              color="#0e8ebf"
              prevItems={prevTimeBar.length > 0 ? prevTimeBar : undefined}
              prevLabel={prevLabel}
            />
          </div>

          <div className={styles.chartCard}>
            <div className={styles.cellHead}>
              <div className={styles.cellDot} style={{ background: "#77a251" }} />
              <h3>작업 통계</h3>
              <span className={styles.cellSum} style={{ color: "#92ca60" }}>
                {totalTasks}<span>건</span>
              </span>
            </div>
            <DonutWithLegend
              items={taskBar}
              colors={["#6bcf4a", "#ff6b7a", "#a0a4b8"]}
              unit="건"
              prevItems={prevTaskBar.length > 0 ? prevTaskBar : undefined}
            />
          </div>

          <div className={styles.chartCard}>
            <div className={styles.cellHead}>
              <div className={styles.cellDot} style={{ background: "#c2434c" }} />
              <h3>에러 통계</h3>
              <span className={styles.cellSum} style={{ color: "#e06b73" }}>
                {totalErrors}<span>건</span>
              </span>
            </div>
            <DonutWithLegend
              items={errorBar}
              colors={["#ff7085", "#ffb844", "#50c8f0", "#a0a4b8"]}
              unit="건"
              prevItems={prevErrorBar.length > 0 ? prevErrorBar : undefined}
            />
          </div>
        </div>

        {/* Section 3: 기간 비교 */}
        <div className={styles.comparisonRow}>
          <ComparisonCard
            title="로봇"
            color="#92d4f4"
            prevPeriodLabel={prevLabel}
            delta={
              statsSummary.robotDelta !== null && statsSummary.robotDelta !== 0
                ? { value: `${Math.abs(statsSummary.robotDelta)}대`, isUp: statsSummary.robotDelta > 0 }
                : null
            }
            current={robotTypeBar.map((e) => ({ label: e.label, value: `${e.value}` }))}
            previous={prevRobotTypeBar.map((e) => ({ label: e.label, value: `${e.value}` }))}
          />
          <ComparisonCard
            title="시간"
            color="#0e8ebf"
            prevPeriodLabel={prevLabel}
            tooltip="가동률 = 운행시간 / (운행+충전+대기) × 100"
            delta={
              statsSummary.opDelta !== null && statsSummary.opDelta !== 0
                ? { value: convertMinutesToText(Math.abs(statsSummary.opDelta)), isUp: statsSummary.opDelta > 0 }
                : null
            }
            current={timeBar.map((e) => ({ label: e.label, value: e.displayValue ?? `${e.value}` }))}
            previous={prevTimeBar.map((e) => ({ label: e.label, value: e.displayValue ?? `${e.value}` }))}
          />
          <ComparisonCard
            title="작업"
            color="#77a251"
            prevPeriodLabel={prevLabel}
            tooltip="성공률 = 완료 작업 / 총 작업 × 100"
            delta={
              statsSummary.taskDelta !== null && statsSummary.taskDelta !== 0
                ? { value: `${Math.abs(statsSummary.taskDelta)}건`, isUp: statsSummary.taskDelta > 0 }
                : null
            }
            current={[
              { label: "완료", value: `${statsSummary.completed}` },
              { label: "실패", value: `${statsSummary.failed}` },
              { label: "취소", value: `${statsSummary.cancelled}` },
            ]}
            previous={
              prevStatsData
                ? [
                    { label: "완료", value: `${prevStatsData.tasks.completed}` },
                    { label: "실패", value: `${prevStatsData.tasks.failed}` },
                    { label: "취소", value: `${prevStatsData.tasks.cancelled}` },
                  ]
                : []
            }
          />
          <ComparisonCard
            title="에러"
            color="#c2434c"
            prevPeriodLabel={prevLabel}
            delta={
              statsSummary.errorDelta !== null && statsSummary.errorDelta !== 0
                ? { value: `${Math.abs(statsSummary.errorDelta)}건`, isUp: statsSummary.errorDelta > 0 }
                : null
            }
            current={errorBar.map((e) => ({ label: e.label, value: `${e.value}` }))}
            previous={prevErrorBar.map((e) => ({ label: e.label, value: `${e.value}` }))}
          />
        </div>
      </div>
    </div>
  );
}
