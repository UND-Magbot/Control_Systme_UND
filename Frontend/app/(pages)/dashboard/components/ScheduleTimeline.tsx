"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./ScheduleTimeline.module.css";
import { API_BASE } from "@/app/config";
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
};

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
    default: return styles.statusWaiting;
  }
}

const KOREAN_DAY_TO_JS: Record<string, number> = {
  "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6,
};

export default function ScheduleTimeline({ robotName }: ScheduleTimelineProps) {
  const [schedules, setSchedules] = useState<DBSchedule[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"onetime" | "repeat">("onetime");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // 데이터 fetch
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const mockData: DBSchedule[] = [
      { id: 901, RobotName: "TestRobot-01", WorkName: "1F 순찰", TaskType: "순찰", StartDate: `${today}T09:00:00`, EndDate: `${today}T09:30:00`, TaskStatus: "완료", WayName: "A구역", Repeat: "N", Repeat_Day: null, Repeat_End: null },
      { id: 902, RobotName: "TestRobot-01", WorkName: "B구역 점검", TaskType: "점검", StartDate: `${today}T10:30:00`, EndDate: `${today}T11:00:00`, TaskStatus: "진행중", WayName: "B구역", Repeat: "N", Repeat_Day: null, Repeat_End: null },
      { id: 903, RobotName: "TestRobot-01", WorkName: "C구역 보안", TaskType: "보안", StartDate: `${today}T14:00:00`, EndDate: `${today}T14:30:00`, TaskStatus: "대기", WayName: "C구역", Repeat: "Y", Repeat_Day: "월,화,수,목,금", Repeat_End: "2026-12-31T23:59:59" },
      { id: 904, RobotName: "TestRobot-01", WorkName: "D구역 순찰", TaskType: "순찰", StartDate: `${today}T16:00:00`, EndDate: `${today}T16:30:00`, TaskStatus: "대기", WayName: "D구역", Repeat: "Y", Repeat_Day: "월,수,금", Repeat_End: "2026-12-31T23:59:59" },
    ];

    fetch(`${API_BASE}/DB/schedule`)
      .then((res) => { if (!res.ok) throw new Error("fail"); return res.json(); })
      .then((data: DBSchedule[]) => setSchedules(data.length > 0 ? data : mockData))
      .catch(() => setSchedules(mockData));
  }, []);

  // 오늘 스케줄 필터
  const todaySchedules = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayDow = new Date().getDay();

    return schedules
      .filter((s) => {
        if (robotName && s.RobotName !== robotName) return false;
        if (s.Repeat === "Y" && s.Repeat_Day) {
          const days = s.Repeat_Day.split(",").map((d) => KOREAN_DAY_TO_JS[d.trim()]);
          return days.includes(todayDow);
        }
        return s.StartDate.slice(0, 10) <= todayStr && todayStr <= s.EndDate.slice(0, 10);
      })
      .sort((a, b) => new Date(a.StartDate).getTime() - new Date(b.StartDate).getTime());
  }, [schedules, robotName]);

  const onetimeSchedules = useMemo(() => todaySchedules.filter((s) => s.Repeat !== "Y"), [todaySchedules]);
  const repeatSchedules = useMemo(() => todaySchedules.filter((s) => s.Repeat === "Y"), [todaySchedules]);

  // 현재/다음 스케줄
  const currentOrNext = useMemo(() => {
    const now = new Date();
    const active = todaySchedules.find((s) =>
      s.TaskStatus === "진행중" || s.TaskStatus === "진행" ||
      (s.TaskStatus === "대기" && new Date(s.StartDate) <= now && now <= new Date(s.EndDate))
    );
    if (active) return { schedule: active, label: "현재" };

    const upcoming = todaySchedules.find((s) => s.TaskStatus === "대기" && new Date(s.StartDate) > now);
    if (upcoming) return { schedule: upcoming, label: "다음" };

    const last = todaySchedules[todaySchedules.length - 1];
    return last ? { schedule: last, label: "마지막" } : null;
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
      const res = await fetch(`${API_BASE}/DB/schedule/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("삭제 실패");
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("스케줄 삭제 실패", e);
    }
    setDeleteTarget(null);
  };

  const displayList = activeTab === "onetime" ? onetimeSchedules : repeatSchedules;

  return (
    <div ref={wrapperRef} className={`${styles.wrapper} ${isOpen ? styles.wrapperOpen : ""}`}>
      {/* 접힌 카드 */}
      <div className={styles.collapsedCard} onClick={() => setIsOpen(!isOpen)}>
        <div className={styles.cardTop}>
          <span className={styles.cardLabel}>일정</span>
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
            <span className={styles.scheduleTime}>{formatTime(currentOrNext.schedule.StartDate)}</span>
            <span className={styles.scheduleName}>{currentOrNext.schedule.WorkName}</span>
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
            <div className={styles.sectionTab}>
              <button
                className={`${styles.tab} ${activeTab === "onetime" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("onetime")}
              >
                당일 ({onetimeSchedules.length})
              </button>
              <button
                className={`${styles.tab} ${activeTab === "repeat" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("repeat")}
              >
                반복 ({repeatSchedules.length})
              </button>
            </div>

            {displayList.length === 0 ? (
              <div className={styles.emptyState}>
                {activeTab === "onetime" ? "당일 업무가 없습니다" : "반복 업무가 없습니다"}
              </div>
            ) : (
              displayList.map((s) => {
                const isActive = s.TaskStatus === "진행중" || s.TaskStatus === "진행";
                const isDone = s.TaskStatus === "완료";

                return (
                  <div
                    key={s.id}
                    className={`${styles.scheduleCard} ${isActive ? styles.scheduleCardActive : ""} ${isDone ? styles.scheduleCardDone : ""}`}
                  >
                    <div className={styles.cardRow}>
                      <span className={styles.cardTimeRange}>
                        {formatTime(s.StartDate)} ~ {formatTime(s.EndDate)}
                      </span>
                      <span className={`${styles.statusBadge} ${getStatusClass(s.TaskStatus)}`}>
                        {s.TaskStatus === "완료" ? "✓ 완료" : s.TaskStatus}
                      </span>
                    </div>
                    <div className={styles.cardRow}>
                      <span className={styles.cardTaskName}>
                        {s.WorkName}
                        {s.Repeat === "Y" && <span className={styles.repeatBadge}>반복</span>}
                      </span>
                    </div>
                    <div className={styles.cardRow}>
                      <span className={styles.cardLocation}>{s.WayName}</span>
                      {!isDone && (
                        <div className={styles.actionBtns}>
                          <button className={styles.actionBtn} onClick={() => router.push(`/schedules?id=${s.id}`)}>수정</button>
                          <button className={`${styles.actionBtn} ${styles.actionBtnCancel}`} onClick={() => setDeleteTarget(s.id)}>취소</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
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
