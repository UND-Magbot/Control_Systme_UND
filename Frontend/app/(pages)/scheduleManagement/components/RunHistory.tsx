"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./RunHistory.module.css";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import { apiFetch } from "@/app/lib/api";
import Pagination from "@/app/components/common/Pagination";
import FilterSelectBox, { type FilterOption } from "@/app/components/button/FilterSelectBox";
import type { RobotRowData } from "@/app/types";

/** 회차 실행 결과 — 백엔드 ScheduleRun.Result 와 1:1 */
type RunResult =
  | "running" | "success" | "completed_delayed" | "missed"
  | "skipped_offline" | "timeout" | "aborted" | "cancelled" | "error";

type RunItem = {
  id: number;
  ScheduleId: number;
  WorkName: string | null;
  RobotName: string | null;
  PlannedAt: string | null;
  StartedAt: string | null;
  EndedAt: string | null;
  Result: RunResult;
  ResultLabel: string;
  Reason: string | null;
  DelaySec: number | null;
};

type RunSummary = {
  planned: number;
  executed: number;
  rate: number | null;
  byResult: Record<string, number>;
};

type PausedItem = {
  id: number;
  WorkName: string | null;
  RobotName: string | null;
  PausedUntil: string | null;
};

const PAGE_SIZE = 12;

const PERIOD_ITEMS = [
  { days: 1, label: "오늘" },
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
];

const RESULT_ITEMS: FilterOption[] = [
  { id: "success", label: "성공" },
  { id: "completed_delayed", label: "성공(지연)" },
  { id: "missed", label: "미실행" },
  { id: "skipped_offline", label: "오프라인 스킵" },
  { id: "timeout", label: "시간 초과" },
  { id: "aborted", label: "중단" },
  { id: "error", label: "오류" },
  { id: "cancelled", label: "취소" },
];

/** 결과별 배지 색 — 성공 계열 녹색, 실패 계열 적색, 미실행·스킵은 앰버 */
const BADGE_CLASS: Record<RunResult, string> = {
  running: styles.badgeRunning,
  success: styles.badgeOk,
  completed_delayed: styles.badgeOk,
  missed: styles.badgeWarn,
  skipped_offline: styles.badgeWarn,
  timeout: styles.badgeErr,
  aborted: styles.badgeErr,
  error: styles.badgeErr,
  cancelled: styles.badgeNone,
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(5, 10).replace("-", "-");
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(11, 16);
}

function fmtDelay(sec: number | null): string {
  if (!sec || sec < 60) return "—";
  const min = Math.round(sec / 60);
  return `+${min}분`;
}

type Props = {
  robots: RobotRowData[];
  onLoaded?: () => void;
};

export default function RunHistory({ robots, onLoaded }: Props) {
  const [items, setItems] = useState<RunItem[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [paused, setPaused] = useState<PausedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [days, setDays] = useState(7);
  const [robot, setRobot] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 표 내부 스크롤 — 응대 세션 탭과 같은 커스텀 스크롤바를 쓴다
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableTrackRef = useRef<HTMLDivElement>(null);
  const tableThumbRef = useRef<HTMLDivElement>(null);

  useCustomScrollbar({
    enabled: true,
    scrollRef: tableScrollRef,
    trackRef: tableTrackRef,
    thumbRef: tableThumbRef,
    minThumbHeight: 40,
    deps: [items.length, loading],
  });

  // RobotRowData.no 가 RobotName (WorkSchedule 의 로봇 필터와 같은 규약)
  const robotItems = useMemo<FilterOption[]>(
    () => robots.map((r) => ({ id: r.no, label: r.no })),
    [robots]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        days: String(days),
        page: String(page),
        size: String(PAGE_SIZE),
      });
      if (robot) params.set("robot", robot);
      if (result) params.set("result", result);

      const [runRes, pausedRes] = await Promise.all([
        apiFetch(`/DB/schedule-runs?${params.toString()}`),
        apiFetch(`/DB/schedule-runs/paused`),
      ]);
      if (!runRes.ok) throw new Error(`실행 이력 조회 실패 (${runRes.status})`);

      const data = await runRes.json();
      setItems(data.items ?? []);
      setSummary(data.summary ?? null);
      setTotal(data.total ?? 0);
      setPaused(pausedRes.ok ? await pausedRes.json() : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실행 이력을 불러오지 못했습니다.");
      setItems([]);
      setSummary(null);
    } finally {
      setLoading(false);
      onLoaded?.();
    }
  }, [days, page, robot, result, onLoaded]);

  useEffect(() => { load(); }, [load]);

  // 필터가 바뀌면 첫 페이지로
  useEffect(() => { setPage(1); }, [days, robot, result]);

  const handleResume = async (scheduleId: number) => {
    const res = await apiFetch(`/DB/schedule-runs/${scheduleId}/resume`, { method: "POST" });
    if (res.ok) load();
  };

  const failCount = summary
    ? (summary.byResult.missed ?? 0) + (summary.byResult.skipped_offline ?? 0)
      + (summary.byResult.timeout ?? 0) + (summary.byResult.aborted ?? 0)
      + (summary.byResult.error ?? 0)
    : 0;

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <h2>실행 이력</h2>

        <div className={styles.filterBar}>
          <div className={styles.periodGroup}>
            {PERIOD_ITEMS.map((p) => (
              <div
                key={p.days}
                className={`${styles.periodItem} ${days === p.days ? styles.periodActive : ""}`}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </div>
            ))}
          </div>

          <FilterSelectBox
            items={robotItems}
            selectedLabel={robot}
            placeholder="전체 로봇"
            width={140}
            onSelect={(item) => setRobot(item ? String(item.id) : null)}
          />
          <FilterSelectBox
            items={RESULT_ITEMS}
            selectedLabel={RESULT_ITEMS.find((r) => r.id === result)?.label ?? null}
            placeholder="전체 결과"
            width={130}
            onSelect={(item) => setResult(item ? String(item.id) : null)}
          />

          {summary && summary.rate !== null && (
            <span className={styles.rateBox}>
              실행률 <span className={styles.rateValue}>{summary.rate}%</span>
              <span className={styles.rateSub}>({summary.executed}/{summary.planned})</span>
            </span>
          )}
        </div>
      </div>

      {/* 연속 실패로 자동 정지된 작업 — 사람이 풀어줘야 다시 돈다 */}
      {paused.length > 0 && (
        <div className={styles.pausedBanner}>
          <span className={styles.pausedIcon} />
          <span className={styles.pausedText}>
            연속 실패로 <b>{paused.length}건</b>의 작업이 자동 일시정지되었습니다 —
            원인을 확인한 뒤 해제하세요.
          </span>
          <div className={styles.pausedList}>
            {paused.map((p) => (
              <button key={p.id} className={styles.resumeBtn} onClick={() => handleResume(p.id)}>
                {p.WorkName} 해제
              </button>
            ))}
          </div>
        </div>
      )}

      {summary && failCount > 0 && (
        <div className={styles.failNote}>
          이 기간에 <b>{failCount}건</b>의 회차가 실행되지 못했습니다. 사유는 아래 표에 남습니다.
        </div>
      )}

      <div className={styles.tableArea}>
        <div ref={tableScrollRef} className={styles.tableWrapper}>
          <table className={styles.runTable}>
            <thead>
              <tr>
                <th>날짜</th>
                <th className={styles.thLeft}>작업명</th>
                <th>로봇</th>
                <th>예정</th>
                <th>실제 시작</th>
                <th>지연</th>
                <th>결과</th>
                <th className={styles.thLeft}>사유</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><div className={styles.emptyState}>불러오는 중…</div></td></tr>
              ) : error ? (
                <tr><td colSpan={8}><div className={styles.emptyState}>{error}</div></td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className={styles.emptyState}>
                      조회된 회차가 없습니다. 실행 이력은 이 기능이 반영된 시점부터 쌓입니다.
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.PlannedAt)}</td>
                    <td className={`${styles.tdLeft} ${styles.nameCell}`}>{r.WorkName ?? "—"}</td>
                    <td>{r.RobotName ?? "—"}</td>
                    <td>{fmtTime(r.PlannedAt)}</td>
                    <td>{fmtTime(r.StartedAt)}</td>
                    <td className={r.DelaySec && r.DelaySec >= 60 ? styles.delayCell : ""}>
                      {fmtDelay(r.DelaySec)}
                    </td>
                    <td>
                      <span className={`${styles.badge} ${BADGE_CLASS[r.Result] ?? ""}`}>
                        {r.ResultLabel}
                      </span>
                    </td>
                    <td className={`${styles.tdLeft} ${styles.reasonCell}`} title={r.Reason ?? ""}>
                      {r.Reason ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div ref={tableTrackRef} className={styles.scrollTrack}>
          <div ref={tableThumbRef} className={styles.scrollThumb} />
        </div>
      </div>

      <div className={styles.paginationArea}>
        <Pagination
          totalItems={total}
          currentPage={page}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          blockSize={5}
        />
        {total > 0 && (
          <div className={styles.totalCount}>총 <span>{total}</span> 회차</div>
        )}
      </div>
    </div>
  );
}
