'use client';

import React from 'react';
import styles from './ControlPanel.module.css';

type WorkAutomationPanelProps = {
  isWorking: boolean;
  isPending: boolean;
  loopCount: number | string;
  disabled?: boolean;
  onStartWork: (loop: number) => void;
  onStopWork: () => void;
  onLoopCountChange: (value: string) => void;
  onLoopCountBlur: () => void;
};

export default function WorkAutomationPanel({
  isWorking,
  isPending,
  loopCount,
  disabled = false,
  onStartWork,
  onStopWork,
  onLoopCountChange,
  onLoopCountBlur,
}: WorkAutomationPanelProps) {
  const isDisabled = disabled || isPending;

  if (isWorking) {
    return (
      <div className={styles.workPanel}>
        <div className={styles.workStatusBanner}>
          <span className={styles.workingDot} />
          <span>작업 진행 중</span>
        </div>
        <button
          type="button"
          className={styles.stopWorkBtn}
          onClick={onStopWork}
          disabled={isPending}
        >
          {isPending ? '중지 중...' : '작업 중지'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.workPanel}>
      <div className={styles.workStatusBanner}>
        <span className={styles.idleDot} />
        <span>대기 중</span>
      </div>

      {/* 단일 실행 */}
      <div className={styles.workRow}>
        <span className={styles.workRowLabel}>단일 실행</span>
        <button
          type="button"
          className={styles.workStartBtn}
          onClick={() => onStartWork(1)}
          disabled={isDisabled}
        >
          시작
        </button>
      </div>

      <div className={styles.workDivider} />

      {/* 반복 실행 */}
      <div className={styles.workRow}>
        <span className={styles.workRowLabel}>반복 실행</span>
        <div className={styles.loopInputRow}>
          <input
            type="number"
            min={1}
            max={999}
            value={loopCount}
            onChange={(e) => onLoopCountChange(e.target.value)}
            onBlur={onLoopCountBlur}
            className={styles.loopInput}
            disabled={isDisabled}
          />
          <span className={styles.loopUnit}>회</span>
          <button
            type="button"
            className={styles.workStartBtn}
            onClick={() => onStartWork(Number(loopCount) || 1)}
            disabled={isDisabled}
          >
            시작
          </button>
        </div>
      </div>
    </div>
  );
}
