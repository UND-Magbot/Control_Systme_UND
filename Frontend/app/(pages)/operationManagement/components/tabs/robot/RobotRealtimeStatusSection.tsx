'use client';

import React from 'react';
import styles from '@/app/components/modal/Modal.module.css';
import type { RobotRowData } from '@/app/types';
import { getBatteryColor } from '@/app/constants/robotIcons';

type Props = {
  robot: RobotRowData;
  hasActiveSchedule: boolean;
};

export default function RobotRealtimeStatusSection({ robot: r, hasActiveSchedule }: Props) {
  const isOffline = r.power === 'Off';
  const isNetworkDown = r.network === 'Offline' && !isOffline;

  // 상태 계산
  let statusLabel = '대기';
  let statusClass = styles.detailBadgeStandby;
  if (isOffline) {
    statusLabel = '오프라인';
    statusClass = styles.detailBadgeOffline;
  } else if (r.isCharging) {
    statusLabel = '충전';
    statusClass = styles.detailBadgeCharging;
  } else if (hasActiveSchedule || (r.tasks.length > 0 && r.waitingTime === 0)) {
    statusLabel = '운영';
    statusClass = styles.detailBadgeOperating;
  }

  // 배터리 색상
  const bat = r.battery ?? 0;
  const limitBat = r.return ?? 30;

  return (
    <div className={`${styles.detailStatusSection} ${isOffline ? styles.detailStatusOffline : ''}`}>
      <h3 className={styles.detailSectionTitle}>실시간 현황</h3>
      {isNetworkDown && (
        <div className={styles.detailNetworkWarning}>통신 끊김 — 마지막 수신 데이터 기준</div>
      )}
      <div className={styles.detailStatusGrid}>
        <div className={styles.detailStatusItem}>
          <span className={styles.detailStatusLabel}>상태</span>
          <span className={`${styles.detailStatusValue} ${statusClass}`}>{statusLabel}</span>
        </div>
        <div className={styles.detailStatusItem}>
          <span className={styles.detailStatusLabel}>전원</span>
          <span className={styles.detailStatusValue}>{r.power ?? '-'}</span>
        </div>
        <div className={styles.detailStatusItem}>
          <span className={styles.detailStatusLabel}>네트워크</span>
          <span className={styles.detailStatusValue}>{r.network ?? '-'}</span>
        </div>
        <div className={styles.detailStatusItem}>
          <span className={styles.detailStatusLabel}>배터리</span>
          <span className={styles.detailStatusValue}>
            {isOffline ? '-' : (
              r.type === 'QUADRUPED' ? (
                <>
                  L {r.batteryLeft != null ? (
                    <span style={{ color: getBatteryColor(r.batteryLeft, limitBat) }}>{r.batteryLeft}%</span>
                  ) : <span>-</span>}
                  <span style={{ color: 'var(--text-muted)' }}> / </span>
                  R {r.batteryRight != null ? (
                    <span style={{ color: getBatteryColor(r.batteryRight, limitBat) }}>{r.batteryRight}%</span>
                  ) : <span>-</span>}
                </>
              ) : (
                <span style={{ color: getBatteryColor(bat, limitBat) }}>{bat}%</span>
              )
            )}
          </span>
        </div>
        <div className={styles.detailStatusItem}>
          <span className={styles.detailStatusLabel}>현재 위치</span>
          <span className={styles.detailStatusValue}>
            {isOffline ? '-' : (r.site || '-')}
          </span>
        </div>
      </div>
    </div>
  );
}
