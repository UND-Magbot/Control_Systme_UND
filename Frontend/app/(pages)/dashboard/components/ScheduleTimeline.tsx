"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./ScheduleTimeline.module.css";
import { apiFetch } from "@/app/lib/api";
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
};

function getMode(s: DBSchedule): string {
  return s.ScheduleMode || (s.Repeat === "Y" ? "weekly" : "once");
}

function getModeLabel(mode: string): string {
  switch (mode) {
    case "once": return "단일";
    case "weekly": return "요일반복";
    case "interval": return "주기반복";
    default: return "단일";
  }
}

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

export default function ScheduleTimeline({ robotName }: ScheduleTimelineProps) {
  const [schedules, setSchedules] = useState<DBSchedule[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [modeFilter, setModeFilter] = useState<"all" | "once" | "weekly" | "interval">("all");
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
          if (s.SeriesEndDate && s.SeriesEndDate < todayStr) return false;
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

        // 주기반복: 시리즈 종료일 + 활성 시간 범위 내인지 + 오늘 요일
        if (mode === "interval") {
          // 시리즈 종료일이 지났으면 표시하지 않음 (SeriesEndDate 기준)
          if (s.SeriesEndDate && s.SeriesEndDate < todayStr) return false;
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
    if (mode === "interval") {
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

  // 금일 실행된 적 있는 스케줄 (LastRunDate가 오늘)
  const todayExecuted = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return schedules
      .filter((s) => s.LastRunDate && s.LastRunDate.slice(0, 10) === todayStr && ((s.RunCount ?? 0) > 0 || s.TaskStatus === "취소"))
      .sort((a, b) => new Date(b.LastRunDate!).getTime() - new Date(a.LastRunDate!).getTime());
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
  const handleDelete = async (id: number) => {
    try {
      const res = await apiFetch(`/DB/schedule/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("삭제 실패");
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("스케줄 삭제 실패", e);
    }
    setDeleteTarget(null);
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
                : getMode(currentOrNext.schedule) === "interval"
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
                          <span className={styles.typeBadge}>{s.TaskType}</span>
                        </span>
                      </div>
                      {modeInfo && (
                        <div className={styles.cardRow}>
                          <span className={styles.cardModeInfo}>{modeInfo}</span>
                        </div>
                      )}
                      <div className={styles.cardRow}>
                        <span className={styles.cardLocation}>{s.WayName}</span>
                        <button className={styles.actionBtn} onClick={() => router.push(`/schedules?id=${s.id}`)}>상세보기</button>
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

      {/* 삭제 확인 모달 */}
      {deleteTarget !== null && (
        <BatteryPathModal
          isOpen={true}
          message="이 스케줄을 취소하시겠습니까?"
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
