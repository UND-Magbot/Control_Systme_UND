'use client';

import React from 'react';
import type { RobotRowData } from '@/app/type';
import { getRobotCapabilities } from '@/app/constants/robotCapabilities';
import styles from './StatusBar.module.css';

type StatusBarProps = {
  selectedRobot: RobotRowData | null;
  onClose: () => void;
  controlledBy?: string | null;
};

/** 배터리 값 → 색상 (로봇 목록과 동일 기준) */
function batColor(level: number): string {
  if (level > 25) return '#22c55e';
  if (level > 10) return '#f59e0b';
  return '#ef4444';
}

export default function StatusBar({
  selectedRobot,
  onClose,
  controlledBy,
}: StatusBarProps) {
  const robot = selectedRobot;
  const caps = getRobotCapabilities(robot?.type ?? '');
  const power = robot?.power ?? '-';
  const network = robot?.network ?? '-';
  const isDual = caps.hasDualBattery;

  return (
    <div className={styles.statusBar}>
      <div className={styles.left}>
        <span className={styles.title}>{robot?.no ?? 'Robot'} 원격제어</span>
        <span className={styles.divider} />
        <span className={styles.floorBadge}>1F</span>

        {/* 전원 */}
        <span className={styles.statusBadge}>
          <span className={styles.badgeLabel}>전원</span>
          <span>{power}</span>
        </span>

        {/* 상태 */}
        <span className={styles.statusBadge}>
          <span className={styles.badgeLabel}>상태</span>
          <span>{network}</span>
        </span>

        {/* 배터리 */}
        <span className={styles.statusBadge}>
          <span className={styles.badgeLabel}>배터리</span>
          {isDual ? (
            <>
              <span className={styles.batLabel}>L</span>
              {robot?.batteryLeft != null ? (
                <span style={{ color: batColor(robot.batteryLeft) }}>{robot.batteryLeft}%</span>
              ) : <span>-</span>}
              <span className={styles.batSep}>/</span>
              <span className={styles.batLabel}>R</span>
              {robot?.batteryRight != null ? (
                <span style={{ color: batColor(robot.batteryRight) }}>{robot.batteryRight}%</span>
              ) : <span>-</span>}
            </>
          ) : (
            <span style={{ color: batColor(robot?.battery ?? 0) }}>{robot?.battery ?? '-'}%</span>
          )}
        </span>
      </div>

      {controlledBy && (
        <div className={styles.observerBanner}>
          현재 {controlledBy}님이 제어 중 (관찰 모드)
        </div>
      )}

      <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="닫기">
        ✕
      </button>
    </div>
  );
}
