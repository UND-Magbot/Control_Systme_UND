'use client';

import React from 'react';
import styles from '@/app/components/modal/Modal.module.css';
import { resolveTaskTypeLabel } from '@/app/lib/taskType';
import { resolveScheduleMode, getScheduleModeLabel } from '@/app/lib/scheduleMode';

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
  /** 외부 요인(서버 재기동 등)으로 '오류'가 되어 멈춘 작업. 진행 중과 섞지 않는다 */
  erroredSchedule?: ActiveScheduleInfo | null;
  isOffline: boolean;
  /** 재개 요청 — 확인 모달은 호출부가 띄운다(로봇이 실제로 움직인다) */
  onResume?: () => void;
  /**
   * 작업명과 **같은 줄**에 붙일 것 — 상시 대기 응대 상태가 여기 들어간다.
   * 작업명과 상태를 두 줄로 떼면 "이 작업이 지금 어떤 상태인가"를 조합해서 읽어야 한다.
   */
  headerExtra?: React.ReactNode;
  /** 작업 카드 안에 덧붙일 것 — 요청 내용·경유지 진행처럼 한 줄에 담기 어려운 상세 */
  children?: React.ReactNode;
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

export default function RobotActiveScheduleSection({
  activeSchedule, erroredSchedule = null, isOffline, onResume, headerExtra, children,
}: Props) {
  if (isOffline) {
    return (
      <div className={styles.detailTaskSection}>
        <h3 className={styles.detailSectionTitle}>현재 작업</h3>
        <div className={styles.detailTaskEmpty}>오프라인 — 작업 할당 불가</div>
        {children}
      </div>
    );
  }

  // 진행 중인 게 없어도 '오류'로 멈춘 작업이 있으면 그걸 보여주고 재개 경로를 연다.
  // 여기서 안 보여주면 운영자가 로봇 화면에서 원인을 보고도 작업관리로 건너가야 한다.
  if (!activeSchedule && erroredSchedule) {
    const es = erroredSchedule;
    return (
      <div className={styles.detailTaskSection}>
        <h3 className={styles.detailSectionTitle}>현재 작업</h3>
        <div className={styles.detailTaskCard}>
          <div className={styles.detailTaskHeader}>
            <span className={styles.detailTaskName}>{es.WorkName}</span>
            <span className={styles.detailTaskType}>{resolveTaskTypeLabel(es.TaskType)}</span>
            <span className={styles.detailTaskMode} data-mode={resolveScheduleMode(es)}>
              {getScheduleModeLabel(resolveScheduleMode(es))}
            </span>
            <span className={styles.detailTaskStatus} data-status="오류" title="작업 상태">오류</span>
          </div>
          <div className={styles.detailTaskInfo}>
            <span className={styles.detailTaskInfoItem}>
              외부 요인으로 멈췄습니다. 재개하기 전까지 자동으로 실행되지 않습니다.
            </span>
          </div>
          {onResume && (
            <div className={styles.detailTaskActions}>
              <button type="button" className={styles.detailTaskResumeBtn} onClick={onResume}>
                작업 재개
              </button>
            </div>
          )}
        </div>
        {children}
      </div>
    );
  }

  if (!activeSchedule) {
    return (
      <div className={styles.detailTaskSection}>
        <h3 className={styles.detailSectionTitle}>현재 작업</h3>
        <div className={styles.detailTaskEmpty}>진행 중인 작업 없음</div>
        {children}
      </div>
    );
  }

  const as = activeSchedule;
  const mode = resolveScheduleMode(as);
  const modeLabel = getScheduleModeLabel(mode);

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
          <span className={styles.detailTaskType}>{resolveTaskTypeLabel(as.TaskType)}</span>
          <span className={styles.detailTaskMode} data-mode={mode}>{modeLabel}</span>
          {/* 실시간 현황의 '로봇 상태'와 층위가 다르다 — 여기는 작업의 상태다 */}
          <span className={styles.detailTaskStatus} data-status={as.TaskStatus} title="작업 상태">
            {as.TaskStatus}
          </span>
          {/* 상시 대기면 응대 상태가 같은 줄에 이어 붙는다 */}
          {headerExtra}
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
        {children}
      </div>
    </div>
  );
}
