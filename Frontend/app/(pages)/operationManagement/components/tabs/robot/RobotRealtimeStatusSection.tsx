'use client';

import React from 'react';
import styles from '@/app/components/modal/Modal.module.css';
import type { RobotRowData } from '@/app/types';
import { getBatteryColor } from '@/app/constants/robotIcons';

import { isDualBatteryType } from '@/app/constants/robotCapabilities';

type Props = {
  robot: RobotRowData;
  hasActiveSchedule: boolean;
};

export default function RobotRealtimeStatusSection({ robot: r, hasActiveSchedule }: Props) {
  const isUnknown = r.power === '-';
  const isOffline = r.power === 'Off';
  const isNetworkDown = r.network === 'Offline' && !isOffline;
  const isRobotOnline = !isOffline && !isUnknown && r.network !== 'Offline' && r.network !== 'Error';

  // 상태 계산 (테이블과 동일 로직)
  let statusLabel = '대기 중';
  let statusClass = styles.detailBadgeStandby;
  if (isUnknown) {
    statusLabel = '오프라인';
    statusClass = styles.detailBadgeOffline;
  } else if (r.network === 'Offline' || isOffline) {
    statusLabel = '오프라인';
    statusClass = styles.detailBadgeOffline;
  } else if (r.network === 'Error') {
    statusLabel = '오류';
    statusClass = styles.detailBadgeOffline;
  } else if (r.chargeState === 4) {
    statusLabel = '충전 오류';
    statusClass = styles.detailBadgeOffline;
  } else if (r.chargeState === 5) {
    statusLabel = '전류 없음';
    statusClass = styles.detailBadgeOffline;
  } else if (r.chargeState === 1) {
    statusLabel = '부두로 이동';
    statusClass = styles.detailBadgeCharging;
  } else if (r.chargeState === 2) {
    statusLabel = '충전 중';
    statusClass = styles.detailBadgeCharging;
  } else if (r.chargeState === 3) {
    statusLabel = '부두에서 나가기';
    statusClass = styles.detailBadgeCharging;
  } else if (r.dockingTime > 0) {
    statusLabel = '도킹 중';
    statusClass = styles.detailBadgeCharging;
  } else if (hasActiveSchedule || r.tasks.length > 0 || r.isNavigating) {
    statusLabel = '작업 중';
    statusClass = styles.detailBadgeOperating;
  }

  // 배터리 색상
  const bat = r.battery ?? 0;
  const limitBat = r.return ?? 30;

  return (
    <div className={`${styles.detailStatusSection} ${(isOffline || isUnknown) ? styles.detailStatusOffline : ''}`}>
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
          <span className={styles.detailStatusValue}>{isUnknown ? 'Off' : r.power}</span>
        </div>
        <div className={styles.detailStatusItem}>
          <span className={styles.detailStatusLabel}>네트워크</span>
          <span className={styles.detailStatusValue}>{isUnknown ? 'Offline' : r.network}</span>
        </div>
        <div className={styles.detailStatusItem}>
          <span className={styles.detailStatusLabel}>배터리</span>
          <span className={styles.detailStatusValue}>
            {isDualBatteryType(r.type) ? (() => {
                const singleMode = r.powerManagement === 1;
                return (
                  <>
                    L {r.batteryLeft != null ? (
                      <span style={{ color: getBatteryColor(r.batteryLeft, limitBat, isRobotOnline) }}>{r.batteryLeft}%</span>
                    ) : singleMode ? <span>-</span> : <span style={{ color: getBatteryColor(0, limitBat, isRobotOnline) }}>0%</span>}
                    <span style={{ color: 'var(--text-muted)' }}> / </span>
                    R {r.batteryRight != null ? (
                      <span style={{ color: getBatteryColor(r.batteryRight, limitBat, isRobotOnline) }}>{r.batteryRight}%</span>
                    ) : singleMode ? <span>-</span> : <span style={{ color: getBatteryColor(0, limitBat, isRobotOnline) }}>0%</span>}
                  </>
                );
              })() : (
                <span style={{ color: getBatteryColor(bat, limitBat, isRobotOnline) }}>{bat}%</span>
              )}
          </span>
        </div>
        <div className={styles.detailStatusItem}>
          <span className={styles.detailStatusLabel}>현재 위치</span>
          <span className={styles.detailStatusValue}>
            {isUnknown ? '-' : (r.site || '-')}
          </span>
        </div>
      </div>
    </div>
  );
}
