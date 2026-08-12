"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./ScheduleTimeline.module.css";
import { apiFetch } from "@/app/lib/api";
import { resolveTaskTypeLabel } from "@/app/lib/taskType";
import { resolveScheduleMode, getScheduleModeLabel, isActiveWindowMode } from "@/app/lib/scheduleMode";
import BatteryPathModal from "@/app/components/modal/BatteryChargeModal";

type DBSchedule = {
  id: number;
  RobotName: string;
  WorkName: string;
  TaskType: string;
  StartDate: string;
  EndDate: string;
  TaskStatus: string;
  WayName: string;
  Repeat: string;
  Repeat_Day: string | null;
  Repeat_End: string | null;
  ScheduleMode?: string;
  ExecutionTime?: string | null;
  ActiveStartTime?: string | null;
  ActiveEndTime?: string | null;
  IntervalMinutes?: number | null;
  RunCount?: number;
  MaxRunCount?: number | null;
  LastRunDate?: string | null;
  SeriesStartDate?: string | null;
  SeriesEndDate?: string | null;
  SeriesExceptions?: string | null;
};

const getMode = resolveScheduleMode;
const getModeLabel = getScheduleModeLabel;

type ScheduleTimelineProps = {
  robotName?: string;
};

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getStatusClass(status: string): string {
  switch (status) {
    case "진행중": case "진행": return styles.statusActive;
    case "완료": return styles.statusDone;
    case "작업중(오류)": case "오류": return styles.statusError;
    case "취소": return styles.statusCancelled;
    default: return styles.statusWaiting;
  }
}

const KOREAN_DAY_TO_JS: Record<string, number> = {
  "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6,
};

/**
 * 대시보드 '작업 일정' — **개입만 하고 설정은 바꾸지 않는다.**
 *
 * 여기서 운영자가 하는 판단은 "오늘 이건 하지 마"(취소)이지 "이 일정을 없애"(삭제)가
 * 아니다. 삭제는 되돌릴 수 없고, 반복 일정이면 며칠치 계획이 통째로 날아간다.
 * 게다가 이 화면을 보는 사람과 일정을 만든 사람이 다를 수 있다.
 *
 *   대시보드   지금 무슨 일이 벌어지는가 · 개입   → 작업 취소
 *   작업관리   무엇을 언제 할 것인가 · 설정      → 삭제 · 수정 · 취소
 *
 * ⚠ 삭제 버튼을 여기 되살리지 말 것. 예전에 삭제 모달이 남아 있었는데
 *   문구는 "취소하시겠습니까?" 인데 동작은 영구 삭제였다(호출부가 없어 죽은 코드였다).
 */
export default function ScheduleTimeline({ robotName }: ScheduleTimelineProps) {
  const [schedules, setSchedules] = useState<DBSchedule[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<DBSchedule | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [modeFilter, setModeFilter] = useState<"all" | "once" | "weekly" | "interval" | "standby">("all");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // 데이터 fetch (5초 폴링)
  useEffect(() => {
    const fetchSchedules = () => {
      apiFetch(`/DB/schedule`)
        .then((res) => { if (!res.ok) throw new Error("fail"); return res.json(); })
        .then((data: DBSchedule[]) => setSchedules(data))
        .catch(() => setSchedules([]));
    };
    fetchSchedules();
    const timer = setInterval(fetchSchedules, 5_000);
    return () => clearInterval(timer);
  }, []);

  // 오늘 스케줄 필터
  const todaySchedules = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayDow = new Date().getDay();
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

    return schedules
      .filter((s) => {
        if (robotName && s.RobotName !== robotName) return false;
        const mode = getMode(s);

        // 요일반복: 시리즈 종료일 + 오늘 요일에 포함되어야 함
        if (mode === "weekly" && s.Repeat_Day) {
          // 시리즈 시작 전이면 아직 오늘 일이 아니다
          if ((s.SeriesStartDate || s.StartDate.slice(0, 10)) > todayStr) return false;
          if (s.SeriesEndDate && s.SeriesEndDate < todayStr) return false;
          // this 범위 수정으로 오늘이 스킵된 경우
          if (s.SeriesExceptions && s.SeriesExceptions.split(",").map(x => x.trim()).includes(todayStr)) return false;
          const days = s.Repeat_Day.split(",").map((d) => KOREAN_DAY_TO_JS[d.trim()]);
          if (!days.includes(todayDow)) return false;
          // 오늘 남은 실행 시각이 있거나 현재 진행 중이어야 함
          if (s.TaskStatus === "진행중" || s.TaskStatus === "진행") return true;
          if (s.ExecutionTime) {
            const hasRemaining = s.ExecutionTime.split(",").some((t) => {
              const [h, m] = t.trim().split(":").map(Number);
              return h * 60 + m >= nowMin;
            });
            return hasRemaining;
          }
          return true;
        }

        // 주기반복·상시대기: 시리즈 종료일 + 활성 시간 범위 내인지 + 오늘 요일.
        // 둘 다 ActiveStartTime~ActiveEndTime 으로 사는 모드라 판정이 같다.
        // (standby 가 여기 없으면 아래 '단일' fallback 으로 새어 SeriesExceptions 를
        //  안 보게 되고, 회차를 취소해도 대시보드엔 '대기'로 계속 남는다.)
        if (isActiveWindowMode(mode)) {
          // 시리즈 시작 전이면 아직 오늘 일이 아니다.
          // (작업관리 캘린더는 시작일부터 그리는데 여기만 안 봐서 내일 시작 작업이 오늘 '대기'로 떴다)
          if ((s.SeriesStartDate || s.StartDate.slice(0, 10)) > todayStr) return false;
          // 시리즈 종료일이 지났으면 표시하지 않음 (SeriesEndDate 기준)
          if (s.SeriesEndDate && s.SeriesEndDate < todayStr) return false;
          if (s.SeriesExceptions && s.SeriesExceptions.split(",").map(x => x.trim()).includes(todayStr)) return false;
          if (s.Repeat_Day) {
            const days = s.Repeat_Day.split(",").map((d) => KOREAN_DAY_TO_JS[d.trim()]);
            if (!days.includes(todayDow)) return false;
          }
          if (s.TaskStatus === "진행중" || s.TaskStatus === "진행") return true;
          if (s.ActiveEndTime) {
            const [h, m] = s.ActiveEndTime.split(":").map(Number);
            return h * 60 + m > nowMin;
          }
          // ActiveEndTime 없는 interval: 시리즈 기간 내이면 표시
          const iStart = s.SeriesStartDate || s.StartDate.slice(0, 10);
          const iEnd = s.SeriesEndDate;
          return iStart <= todayStr && (!iEnd || todayStr <= iEnd);
        }

        // 단일: 날짜 범위 확인
        return s.StartDate.slice(0, 10) <= todayStr && todayStr <= s.EndDate.slice(0, 10);
      })
      .sort((a, b) => new Date(a.StartDate).getTime() - new Date(b.StartDate).getTime());
  }, [schedules, robotName]);

  // 스케줄의 오늘 기준 다음 실행 시각(분) 계산
  const getNextRunMin = (s: DBSchedule): number => {
    const mode = getMode(s);
    if (mode === "once") {
      const d = new Date(s.StartDate);
      return d.getHours() * 60 + d.getMinutes();
    }
    if (mode === "weekly" && s.ExecutionTime) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const times = s.ExecutionTime.split(",").map((t) => {
        const [h, m] = t.trim().split(":").map(Number);
        return h * 60 + m;
      }).sort((a, b) => a - b);
      // 아직 안 지난 시각 중 가장 빠른 것 (현재 분 포함)
      const next = times.find((t) => t >= nowMin);
      return next ?? times[times.length - 1];
    }
    if (isActiveWindowMode(mode)) {
      // 활성 시간대 내이면 현재 시각을 반환 (항상 upcoming 조건 통과)
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (s.ActiveStartTime && s.ActiveEndTime) {
        const [sh, sm] = s.ActiveStartTime.split(":").map(Number);
        const [eh, em] = s.ActiveEndTime.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        if (nowMin >= startMin && nowMin <= endMin) return nowMin;
        if (nowMin < startMin) return startMin;
        return endMin;
      }
      if (s.ActiveStartTime) {
        const [h, m] = s.ActiveStartTime.split(":").map(Number);
        return h * 60 + m;
      }
    }
    const d = new Date(s.StartDate);
    return d.getHours() * 60 + d.getMinutes();
  };

  // 완료 제외 + 모드 필터 + 현재 시간 기준 가까운 순 정렬
  const activeSchedules = useMemo(() => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    return todaySchedules
      .filter((s) => s.TaskStatus !== "완료" && s.TaskStatus !== "취소")
      .filter((s) => modeFilter === "all" || getMode(s) === modeFilter)
      .sort((a, b) => {
        // 진행중인 작업은 항상 최상단
        const aActive = a.TaskStatus === "진행중" || a.TaskStatus === "진행";
        const bActive = b.TaskStatus === "진행중" || b.TaskStatus === "진행";
        if (aActive !== bActive) return aActive ? -1 : 1;

        const aMin = getNextRunMin(a);
        const bMin = getNextRunMin(b);
        // 아직 안 지난 작업 우선, 그 안에서 가까운 순
        const aFuture = aMin >= nowMin;
        const bFuture = bMin >= nowMin;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        return aMin - bMin;
      });
  }, [todaySchedules, modeFilter]);

  // 금일 실행된 적 있는 스케줄.
  // 반복 작업은 원본 한 줄이 여러 회차를 낳으므로, 오늘 회차의 결과를 원본 상태로 대신 보여주면
  // 어긋난다 — 취소된 날 원본은 다음 회차를 위해 '대기'로 돌아가기 때문이다(cancel_occurrence).
  // 그래서 오늘이 취소된 시리즈는 원본을 빼고, 그날 하루짜리로 생성된 '취소' row 를 대신 쓴다.
  const todayExecuted = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const runAt = (s: DBSchedule) => new Date(s.LastRunDate ?? s.StartDate).getTime();

    return schedules
      .filter((s) => {
        const skipped = (s.SeriesExceptions || "")
          .split(",").map((x) => x.trim()).includes(todayStr);
        if (skipped) return false;

        // 취소 회차 row 는 실행된 적이 없어 LastRunDate 가 없다 — 날짜로 오늘 것인지 본다
        if (s.TaskStatus === "취소" && !s.LastRunDate) {
          return (s.SeriesStartDate || s.StartDate.slice(0, 10)) === todayStr;
        }

        return !!s.LastRunDate
          && s.LastRunDate.slice(0, 10) === todayStr
          && ((s.RunCount ?? 0) > 0 || s.TaskStatus === "취소");
      })
      .sort((a, b) => runAt(b) - runAt(a));
  }, [schedules]);

  // 분(number) → "HH:MM" 문자열
  const minToTimeStr = (min: number): string =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  // 현재/다음 스케줄
  const currentOrNext = useMemo(() => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const active = todaySchedules.find((s) =>
      s.TaskStatus === "진행중" || s.TaskStatus === "진행"
    );
    if (active) {
      // 진행 중인 요일반복 다중시각: 현재 실행 중인 시각을 표시
      const activeMin = getNextRunMin(active);
      const mode = getMode(active);
      if (mode === "weekly" && active.ExecutionTime) {
        const times = active.ExecutionTime.split(",").map((t) => {
          const [h, m] = t.trim().split(":").map(Number);
          return h * 60 + m;
        }).sort((a, b) => a - b);
        // 현재 시각 이하 중 가장 마지막 = 지금 실행 중인 시각
        let currentRunMin = times[0];
        for (let i = times.length - 1; i >= 0; i--) {
          if (times[i] <= nowMin) { currentRunMin = times[i]; break; }
        }
        return { schedule: active, label: "현재", displayTime: minToTimeStr(currentRunMin) };
      }
      return { schedule: active, label: "현재", displayTime: null };
    }

    const upcoming = todaySchedules
      .filter((s) => s.TaskStatus === "대기" && getNextRunMin(s) >= nowMin)
      .sort((a, b) => getNextRunMin(a) - getNextRunMin(b));
    if (upcoming.length > 0) {
      const nextMin = getNextRunMin(upcoming[0]);
      return { schedule: upcoming[0], label: "다음", displayTime: minToTimeStr(nextMin) };
    }

    return null;
  }, [todaySchedules]);

  // 클릭 바깥 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // 삭제
  // 작업 취소 — 삭제가 아니다. 일정은 남기고 이 회차만 실행하지 않는다.
  // (반복 작업이면 다음 회차는 그대로 실행된다)
  const handleCancelWork = async (id: number) => {
    setCancelling(true);
    try {
      const res = await apiFetch(`/DB/schedule/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let msg = "작업 취소에 실패했습니다.";
        try { msg = (await res.json())?.detail || msg; } catch { /* 본문 없음 */ }
        throw new Error(msg);
      }
      // 목록에서 지우지 않는다 — 상태만 '취소'로 바뀌고 일정은 그대로 남아야 한다.
      // 5초 폴링이 곧 갱신하지만, 누른 즉시 반영돼야 사용자가 먹혔는지 안다.
      const fresh = await apiFetch(`/DB/schedule`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (fresh) setSchedules(fresh);
    } catch (e) {
      console.error("작업 취소 실패", e);
      setCancelError(e instanceof Error ? e.message : "작업 취소에 실패했습니다.");
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  };

  return (
    <div ref={wrapperRef} className={`${styles.wrapper} ${isOpen ? styles.wrapperOpen : ""}`}>
      {/* 접힌 카드 */}
      <div className={styles.collapsedCard} onClick={() => setIsOpen(!isOpen)}>
        <div className={styles.cardTop}>
          <span className={styles.cardLabel}>작업 일정</span>
          <img
          src={isOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
          alt=""
          className={styles.expandIcon}
        />
        </div>
        {currentOrNext ? (
          <div className={styles.cardBottom}>
            <span className={`${styles.statusBadge} ${getStatusClass(currentOrNext.schedule.TaskStatus)}`}>
              {currentOrNext.schedule.TaskStatus}
            </span>
            <span className={styles.scheduleTime}>
              {currentOrNext.displayTime
                ? currentOrNext.displayTime
                : isActiveWindowMode(getMode(currentOrNext.schedule))
                  ? `${currentOrNext.schedule.ActiveStartTime || formatTime(currentOrNext.schedule.StartDate)}~${currentOrNext.schedule.ActiveEndTime || formatTime(currentOrNext.schedule.EndDate)}`
                  : formatTime(currentOrNext.schedule.StartDate)}
            </span>
            <span className={styles.scheduleName}>{currentOrNext.schedule.WorkName}</span>
            <span className={styles.cardSep}>·</span>
            <img src="/icon/robot_w.png" alt="" className={styles.cardRobotIcon} />
            <span className={styles.cardRobotName}>{currentOrNext.schedule.RobotName}</span>
          </div>
        ) : (
          <span className={styles.emptyText}>업무 없음</span>
        )}
      </div>

      {/* 드롭다운 */}
      {isOpen && (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdown}>
            <div className={styles.dropdownHeader}>
              <span className={styles.dropdownTitle}>금일 예정 작업</span>
              <span className={styles.dropdownCount}>{activeSchedules.length}건</span>
              <select
                className={styles.modeFilterSelect}
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)}
              >
                <option value="all">전체</option>
                <option value="once">단일</option>
                <option value="weekly">요일반복</option>
                <option value="interval">주기반복</option>
                <option value="standby">상시대기</option>
              </select>
            </div>

            <div className={styles.dropdownScroll}>
              {activeSchedules.length === 0 ? (
                <div className={styles.emptyState}>금일 예정된 작업이 없습니다</div>
              ) : (
                activeSchedules.map((s) => {
                  const isActive = s.TaskStatus === "진행중" || s.TaskStatus === "진행";
                  const mode = getMode(s);

                  // 모드별 부가 정보 + 표시 시각 계산
                  let modeInfo = "";
                  let displayTime = "";
                  const nowForCard = new Date();
                  const nowMinForCard = nowForCard.getHours() * 60 + nowForCard.getMinutes();

                  if (mode === "weekly") {
                    const days = s.Repeat_Day;
                    const dayText = days === "월,화,수,목,금,토,일" ? "매일" : days ? `매주 ${days}` : "";
                    if (s.ExecutionTime) {
                      const timeParts = s.ExecutionTime.split(",").map((t: string) => {
                        const [h, m] = t.trim().split(":").map(Number);
                        return { min: h * 60 + m, str: t.trim() };
                      }).sort((a, b) => a.min - b.min);
                      // 다음 실행 시각 (현재 시각 이후)
                      const nextSlot = timeParts.find((t) => t.min > nowMinForCard);
                      // 현재 실행 중인 시각 (현재 시각 이하 중 마지막)
                      let currentSlot = timeParts[0];
                      for (let i = timeParts.length - 1; i >= 0; i--) {
                        if (timeParts[i].min <= nowMinForCard) { currentSlot = timeParts[i]; break; }
                      }
                      displayTime = isActive ? currentSlot.str : (nextSlot?.str || currentSlot.str);
                      modeInfo = `${dayText} · ${timeParts.map((t) => t.str).join(", ")}`;
                    } else {
                      displayTime = formatTime(s.StartDate);
                      modeInfo = dayText;
                    }
                  } else if (mode === "interval") {
                    const days = s.Repeat_Day;
                    const dayText = days ? (days === "월,화,수,목,금,토,일" ? "매일" : `매주 ${days}`) : "";
                    displayTime = `${s.ActiveStartTime || formatTime(s.StartDate)} ~ ${s.ActiveEndTime || formatTime(s.EndDate)}`;
                    modeInfo = `${dayText} ${s.IntervalMinutes ?? 0}분 간격`.trim();
                  } else if (mode === "standby") {
                    // 상시대기는 실행 시각이 아니라 운영 시간대가 수명이다
                    const days = s.Repeat_Day;
                    const dayText = days ? (days === "월,화,수,목,금,토,일" ? "매일" : `매주 ${days}`) : "";
                    displayTime = `${s.ActiveStartTime || formatTime(s.StartDate)} ~ ${s.ActiveEndTime || formatTime(s.EndDate)}`;
                    modeInfo = `${dayText} 호출 대기`.trim();
                  } else {
                    displayTime = formatTime(s.StartDate);
                  }

                  return (
                    <div
                      key={s.id}
                      className={`${styles.scheduleCard} ${isActive ? styles.scheduleCardActive : ""}`}
                    >
                      <div className={styles.cardRow}>
                        <span className={styles.cardTimeRange}>
                          {displayTime}
                        </span>
                        <span className={`${styles.statusBadge} ${getStatusClass(s.TaskStatus)}`}>
                          {s.TaskStatus}
                        </span>
                      </div>
                      <div className={styles.cardRobotRow}>
                        <img src="/icon/robot_w.png" alt="" className={styles.cardRobotIcon} />
                        <span className={styles.cardRobotName}>{s.RobotName}</span>
                      </div>
                      <div className={styles.cardRow}>
                        <span className={styles.cardTaskName}>{s.WorkName}</span>
                        <span className={styles.cardBadges}>
                          <span className={`${styles.modeBadge} ${styles[`mode_${mode}`]}`}>{getModeLabel(mode)}</span>
                          <span className={styles.typeBadge}>{resolveTaskTypeLabel(s.TaskType)}</span>
                        </span>
                      </div>
                      {modeInfo && (
                        <div className={styles.cardRow}>
                          <span className={styles.cardModeInfo}>{modeInfo}</span>
                        </div>
                      )}
                      <div className={styles.cardRow}>
                        <span className={styles.cardLocation}>{s.WayName}</span>
                        <span className={styles.cardActions}>
                          {/* 완료·취소된 작업에는 띄우지 않는다.
                              라벨은 동작에 맞춘다 — 돌고 있는 걸 멈추는 것과 아직 오지 않은 회차를
                              건너뛰는 것은 다른 일이라, 한 이름으로 묶으면 둘 중 하나가 거짓이 된다. */}
                          {(s.TaskStatus === "대기" || isActive) && (
                            <button
                              className={styles.actionBtn}
                              onClick={(e) => { e.stopPropagation(); setCancelTarget(s); }}
                            >
                              {isActive ? "작업 중단" : "회차 취소"}
                            </button>
                          )}
                          <button className={styles.actionBtn} onClick={() => router.push(`/scheduleManagement?id=${s.id}`)}>상세보기</button>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              <div className={styles.dropdownFooter}>
                <button className={styles.historyBtn} onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? '작업 실행 이력 ▲' : '작업 실행 이력 ▼'}
                </button>
              </div>
              {showHistory && (
                <div className={styles.historySection}>
                  <div className={styles.historySectionTitle}>
                    <span className={styles.historySectionTitleDot} />
                    금일 작업 실행 이력
                  </div>
                  {todayExecuted.length === 0 ? (
                    <div className={styles.emptyState}>금일 실행 이력이 없습니다</div>
                  ) : (
                    todayExecuted.map((s) => {
                      const runCount = s.RunCount ?? 0;
                      const maxCount = s.MaxRunCount;
                      const countText = maxCount ? `${runCount}/${maxCount}` : `${runCount}회`;
                      const lastTime = s.LastRunDate ? formatTime(s.LastRunDate) : "";

                      return (
                        <div key={s.id} className={`${styles.historyCard}`}>
                          <div className={styles.cardRobotRow}>
                            <img src="/icon/robot_w.png" alt="" className={styles.cardRobotIcon} />
                            <span className={styles.cardRobotName}>{s.RobotName}</span>
                          </div>
                          <div className={styles.cardRow}>
                            <span className={styles.cardTaskName}>{s.WorkName}</span>
                            <span className={`${styles.statusBadge} ${getStatusClass(s.TaskStatus)}`}>
                              {s.TaskStatus}
                            </span>
                          </div>
                          <div className={styles.cardRow}>
                            <span className={styles.historyCount}>{countText} 실행</span>
                            <span className={styles.historyLastTime}>최근 {lastTime}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 확인 문구도 버튼 라벨과 같은 말을 쓴다 — 삭제와 헷갈리지 않게 "일정은 남는다"를 명시 */}
      {cancelTarget !== null && (
        <BatteryPathModal
          isOpen={true}
          message={
            (cancelTarget.TaskStatus === "진행중" || cancelTarget.TaskStatus === "진행")
              ? "진행 중인 작업을 중단하시겠습니까? 로봇이 즉시 정지하며, 일정은 삭제되지 않습니다."
              : getMode(cancelTarget) === "once"
                ? "이 작업을 취소하시겠습니까? 일정은 삭제되지 않습니다."
                : "오늘 회차를 취소하시겠습니까? 일정은 삭제되지 않고 다음 회차는 그대로 실행됩니다."
          }
          onConfirm={() => { if (!cancelling) handleCancelWork(cancelTarget.id); }}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {cancelError && (
        <BatteryPathModal
          isOpen={true}
          message={cancelError}
          onConfirm={() => setCancelError(null)}
          onCancel={() => setCancelError(null)}
        />
      )}
    </div>
  );
}
