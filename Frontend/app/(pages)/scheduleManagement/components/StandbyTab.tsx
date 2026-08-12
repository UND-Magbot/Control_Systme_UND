"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import styles from "./StandbyTab.module.css";
import { apiFetch } from "@/app/lib/api";
import Pagination from "@/app/components/common/Pagination";
import FilterSelectBox, { type FilterOption } from "@/app/components/button/FilterSelectBox";
import type { RobotRowData } from "@/app/types";

/** 백엔드 ServiceSession.Result 와 1:1 */
type SessionResult =
  | "running" | "completed" | "completed_delayed" | "no_match"
  | "unknown_dest" | "nav_failed" | "aborted_no_progress"
  | "aborted_operator" | "aborted_offline";

type SessionItem = {
  id: number;
  RobotName: string | null;
  StartedAt: string | null;
  Heard: string | null;
  MatchedSlot: string | null;
  Confidence: number | null;
  RetryCount: number;
  DestinationId: number | null;
  DestinationName: string | null;
  Result: SessionResult;
  ResultLabel: string;
  ExtendedCount: number;
  Reason: string | null;
  DurationSec: number | null;
};

/** 실시간 패널과 이력 탭이 공유하는 집계 (백엔드 `_summarize`) */
type SessionSummary = {
  total: number; completed: number; noMatch: number;
  unknownDest: number; aborted: number; avgSec: number | null;
};

type HistorySummary = SessionSummary & {
  closed: number;
  firstTryRate: number | null;
  successRate: number | null;
  extendedRate: number | null;
};

const PAGE_SIZE = 10;

const PERIOD_ITEMS = [
  { days: 1, label: "오늘" },
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
];

const RESULT_ITEMS: FilterOption[] = [
  { id: "completed", label: "안내 완료" },
  { id: "completed_delayed", label: "안내 완료(지연)" },
  { id: "no_match", label: "미인식" },
  { id: "unknown_dest", label: "목적지 없음" },
  { id: "nav_failed", label: "이동 실패" },
  { id: "aborted_no_progress", label: "중단(무진전)" },
  { id: "aborted_operator", label: "중단(정지)" },
];

const BADGE_CLASS: Record<SessionResult, string> = {
  running: styles.badgeRunning,
  completed: styles.badgeOk,
  completed_delayed: styles.badgeOk,
  no_match: styles.badgeWarn,
  unknown_dest: styles.badgeErr,
  nav_failed: styles.badgeErr,
  aborted_no_progress: styles.badgeErr,
  aborted_operator: styles.badgeNone,
  aborted_offline: styles.badgeErr,
};

function fmtDuration(sec: number | null): string {
  if (sec === null || sec === undefined) return "—";
  return `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, "0")}"`;
}

function fmtTime(iso: string | null | undefined): string {
  return iso ? iso.slice(11, 16) : "—";
}

/** 응대 집계 6칸 — 실시간 패널과 이력 탭이 같은 모양으로 읽히게 한 곳에서 그린다 */
function SummaryCards({ s }: { s: SessionSummary }) {
  return (
    <div className={styles.statRow}>
      <div className={styles.stat}><div className={styles.statValue}>{s.total}</div><div className={styles.statName}>응대</div></div>
      <div className={`${styles.stat} ${styles.statOk}`}><div className={styles.statValue}>{s.completed}</div><div className={styles.statName}>안내 완료</div></div>
      <div className={`${styles.stat} ${styles.statWarn}`}><div className={styles.statValue}>{s.noMatch}</div><div className={styles.statName}>미인식</div></div>
      <div className={`${styles.stat} ${styles.statErr}`}><div className={styles.statValue}>{s.unknownDest}</div><div className={styles.statName}>목적지 없음</div></div>
      <div className={`${styles.stat} ${styles.statErr}`}><div className={styles.statValue}>{s.aborted}</div><div className={styles.statName}>중단</div></div>
      <div className={styles.stat}><div className={styles.statValue}>{fmtDuration(s.avgSec)}</div><div className={styles.statName}>평균 응대</div></div>
    </div>
  );
}

type Props = { robots: RobotRowData[] };

export default function StandbyTab({ robots }: Props) {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [days, setDays] = useState(1);
  const [result, setResult] = useState<string | null>(null);
  const [robot, setRobot] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        days: String(days), page: String(page), size: String(PAGE_SIZE),
      });
      if (result) params.set("result", result);
      if (robot) params.set("robot", robot);
      if (search.trim()) params.set("search", search.trim());
      const res = await apiFetch(`/DB/standby-sessions?${params.toString()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
      setSummary(data.summary ?? null);
      setTotal(data.total ?? 0);
    } catch {
      setItems([]); setSummary(null); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [days, page, result, robot, search]);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { setPage(1); }, [days, result, robot, search]);

  // 표 내부 스크롤 — 네이티브 대신 다른 화면과 같은 커스텀 스크롤바를 쓴다
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

  const robotItems = useMemo<FilterOption[]>(
    () => robots.map((r) => ({ id: r.no, label: r.no })),
    [robots]
  );

  return (
    <div className={styles.container}>
      {/* ── 세션 이력 ── 기간·로봇·결과 필터가 걸리는 범위는 여기부터다 */}
      <div className={styles.topBar}>
        <h2>응대 세션 이력</h2>
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
          <input
            className={styles.searchInput}
            placeholder="요청 내용 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
            width={140}
            onSelect={(item) => setResult(item ? String(item.id) : null)}
          />
          {summary?.successRate !== null && summary?.successRate !== undefined && (
            <span className={styles.rateBox}>
              성공률 <b>{summary.successRate}%</b>
              {summary.firstTryRate !== null && summary.firstTryRate !== undefined && (
                <span className={styles.rateSub}>· 한 번에 인식 {summary.firstTryRate}%</span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* 근무가 끝나면 위 실시간 패널이 사라진다 — 그날을 돌아볼 자리는 여기다 */}
      {summary && (
        <>
          <div className={styles.statLabel}>
            {PERIOD_ITEMS.find((p) => p.days === days)?.label ?? `${days}일`} 응대 요약
            <span className={styles.statNote}>
              {" · "}
              {robot ?? "전체 로봇"} · 상시대기 작업 전체 합산
              {result && " · 결과 필터 적용 전 기준"}
            </span>
          </div>
          <SummaryCards s={summary} />
        </>
      )}

      <div className={styles.tableArea}>
        <div ref={tableScrollRef} className={styles.tableWrapper}>
          <table className={styles.sessionTable}>
            <thead>
              <tr>
                <th>시각</th>
                <th>로봇</th>
                <th className={styles.thLeft}>요청 내용</th>
                <th>판정 목적지</th>
                <th>신뢰도</th>
                <th>결과</th>
                <th>소요</th>
                <th>조치</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><div className={styles.emptyState}>불러오는 중…</div></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8}><div className={styles.emptyState}>조회된 응대가 없습니다.</div></td></tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id}>
                    <td>{fmtTime(s.StartedAt)}</td>
                    <td>{s.RobotName ?? "—"}</td>
                    <td className={styles.tdLeft}>
                      <span className={styles.quote}>{s.Heard ?? "(버튼 호출)"}</span>
                      {s.RetryCount > 0 && <span className={styles.retryTag}>되묻기 {s.RetryCount}회</span>}
                      {s.ExtendedCount > 0 && <span className={styles.retryTag}>연장 {s.ExtendedCount}회</span>}
                    </td>
                    <td>{s.DestinationName ?? s.MatchedSlot ?? "—"}</td>
                    <td>{s.Confidence !== null ? s.Confidence.toFixed(2) : "—"}</td>
                    <td>
                      <span className={`${styles.badge} ${BADGE_CLASS[s.Result] ?? ""}`}>{s.ResultLabel}</span>
                    </td>
                    <td>{fmtDuration(s.DurationSec)}</td>
                    <td>
                      {/* 현장 요청 내용이 그대로 학습 재료가 된다 */}
                      {s.Result === "no_match" && (
                        <a className={styles.actionBtn} href="/dataManagement?tab=voice">예시 추가</a>
                      )}
                      {s.Result === "unknown_dest" && (
                        <a className={styles.actionBtn} href="/dataManagement?tab=voice">장소 연결</a>
                      )}
                      {s.Result !== "no_match" && s.Result !== "unknown_dest" && "—"}
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
        <Pagination totalItems={total} currentPage={page} onPageChange={setPage} pageSize={PAGE_SIZE} blockSize={5} />
        {total > 0 && <div className={styles.totalCount}>총 <span>{total}</span> 건</div>}
      </div>
    </div>
  );
}
