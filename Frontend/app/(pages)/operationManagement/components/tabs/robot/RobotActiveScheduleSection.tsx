'use client';

import React from 'react';
import styles from '@/app/components/modal/Modal.module.css';

export type ActiveScheduleInfo = {
  id: number;
  RobotName: string;
  WorkName: string;
  TaskType: string;
  TaskStatus: string;
  WayName: string;
  StartDate: string;
  EndDate: string;
  Repeat: string;
  Repeat_Day: string | null;
  ScheduleMode?: string;
  ExecutionTime?: string | null;
  ActiveStartTime?: string | null;
  ActiveEndTime?: string | null;
  IntervalMinutes?: number | null;
};

type Props = {
  activeSchedule: ActiveScheduleInfo | null;
  isOffline: boolean;
};

type TimeSlot = { str: string; min: number; status: 'done' | 'active' | 'waiting' };

function fmtHHMM(d: string): string {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function daysLabel(repeatDay: string | null): string {
  if (!repeatDay) return '';
  if (repeatDay === '월,화,수,목,금,토,일') return '매일';
  return `매주 ${repeatDay}`;
}

/** 다중 실행 시각(weekly)을 현재 시각 기준으로 done/active/waiting 분류 */
function buildTimeSlots(executionTime: string): TimeSlot[] {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const timeMins = executionTime
    .split(',')
    .map((t) => {
      const [h, m] = t.trim().split(':').map(Number);
      return { min: h * 60 + m, str: t.trim() };
    })
    .sort((a, b) => a.min - b.min);

  let currentIdx = -1;
  for (let i = timeMins.length - 1; i >= 0; i--) {
    if (timeMins[i].min <= nowMin) {
      currentIdx = i;
      break;
    }
  }

  return timeMins.map((t, i) => ({
    ...t,
    status: i < currentIdx ? ('done' as const)
      : i === currentIdx ? ('active' as const)
      : ('waiting' as const),
  }));
}

export default function RobotActiveScheduleSection({ activeSchedule, isOffline }: Props) {
  if (isOffline) {
    return (
      <div className={styles.detailTaskSection}>
        <h3 className={styles.detailSectionTitle}>현재 작업</h3>
        <div className={styles.detailTaskEmpty}>오프라인 — 작업 할당 불가</div>
      </div>
    );
  }

  if (!activeSchedule) {
    return (
      <div className={styles.detailTaskSection}>
        <h3 className={styles.detailSectionTitle}>현재 작업</h3>
        <div className={styles.detailTaskEmpty}>진행 중인 작업 없음</div>
      </div>
    );
  }

  const as = activeSchedule;
  const mode = as.ScheduleMode || (as.Repeat === 'Y' ? 'weekly' : 'once');
  const modeLabel = mode === 'weekly' ? '요일반복' : mode === 'interval' ? '주기반복' : '단일';

  let timeText = '';
  let modeInfo = '';
  let timeSlots: TimeSlot[] | null = null;

  if (mode === 'interval') {
    timeText = `${as.ActiveStartTime || fmtHHMM(as.StartDate)} ~ ${as.ActiveEndTime || fmtHHMM(as.EndDate)}`;
    modeInfo = `${daysLabel(as.Repeat_Day)} ${as.IntervalMinutes ?? 0}분 간격`.trim();
  } else if (mode === 'weekly') {
    const days = daysLabel(as.Repeat_Day);
    if (as.ExecutionTime) {
      timeSlots = buildTimeSlots(as.ExecutionTime);
      modeInfo = days;
    } else {
      timeText = fmtHHMM(as.StartDate);
      modeInfo = days;
    }
  } else {
    timeText = fmtHHMM(as.StartDate);
  }

  return (
    <div className={styles.detailTaskSection}>
      <h3 className={styles.detailSectionTitle}>현재 작업</h3>
      <div className={styles.detailTaskCard}>
        <div className={styles.detailTaskHeader}>
          <span className={styles.detailTaskName}>{as.WorkName}</span>
          <span className={styles.detailTaskType}>{as.TaskType}</span>
          <span className={styles.detailTaskMode} data-mode={mode}>{modeLabel}</span>
          <span className={styles.detailTaskStatus}>{as.TaskStatus}</span>
        </div>
        {timeSlots ? (
          <>
            <div className={styles.detailTimeSlots}>
              {timeSlots.map((slot, i) => (
                <span key={i} className={`${styles.detailTimeSlot} ${styles[`detailTimeSlot_${slot.status}`]}`}>
                  <span className={styles.detailTimeSlotIcon}>
                    {slot.status === 'done' ? '✓' : slot.status === 'active' ? '▶' : '·'}
                  </span>
                  {slot.str}
                </span>
              ))}
            </div>
            {modeInfo && (
              <div className={styles.detailTaskInfo}>
                <span className={styles.detailTaskInfoItem}>{modeInfo}</span>
              </div>
            )}
          </>
        ) : (
          <div className={styles.detailTaskInfo}>
            <span className={styles.detailTaskInfoItem}>{timeText}</span>
            {modeInfo && <span className={styles.detailTaskInfoItem}>{modeInfo}</span>}
          </div>
        )}
        <div className={styles.detailTaskInfo}>
          <span className={styles.detailTaskInfoItem}>작업 경로: {as.WayName}</span>
        </div>
      </div>
    </div>
  );
}
