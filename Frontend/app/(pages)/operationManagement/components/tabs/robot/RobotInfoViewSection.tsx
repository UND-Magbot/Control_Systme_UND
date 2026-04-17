'use client';

import React from 'react';
import { MapPin, Route } from 'lucide-react';
import styles from '@/app/components/modal/Modal.module.css';
import type { RobotRowData } from '@/app/types';

type Props = {
  robot: RobotRowData;
  returnBattery: number;
  onWorkScheduleOpen: () => void;
  onPlacePathOpen: () => void;
  onPathMoveOpen: () => void;
  onChargeMoveOpen: () => void;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detailInfoRow}>
      <span className={styles.detailInfoLabel}>{label}</span>
      <span className={styles.detailInfoValue}>{value}</span>
    </div>
  );
}

export default function RobotInfoViewSection({
  robot: r,
  returnBattery,
  onWorkScheduleOpen,
  onPlacePathOpen,
  onPathMoveOpen,
  onChargeMoveOpen,
}: Props) {
  const isRobotOffline = r.power !== 'On';

  return (
    <div className={styles.detailInfoSection}>
      <h3 className={styles.detailSectionTitle}>기본 정보</h3>
      <div className={styles.detailInfoGrid}>
        <InfoRow label="로봇명" value={r.no ?? '-'} />
        <InfoRow label="모델" value={r.model ?? '-'} />
        <InfoRow label="시리얼 번호" value={r.serialNumber ?? '-'} />
        <InfoRow label="운영사" value={r.operator ?? '-'} />
        <InfoRow label="로봇 타입" value={r.type ?? '-'} />
        <InfoRow label="사이트" value={r.site ?? '-'} />
        <InfoRow label="S/W 버전" value={r.softwareVersion ?? '-'} />

        {/* 복귀 배터리 (좌) / 등록일시 (우) */}
        <div className={styles.detailInfoRow}>
          <span className={styles.detailInfoLabel}>복귀 배터리</span>
          <span className={styles.detailInfoValue}>
            <div className={styles.detailBatteryView}>
              <span className={styles.detailBatteryBar}>
                <span
                  className={styles.detailBatteryFill}
                  style={{ width: `${Math.min(returnBattery, 100)}%` }}
                />
              </span>
              <span>{returnBattery}%</span>
            </div>
          </span>
        </div>
        <InfoRow label="등록일시" value={r.registrationDateTime?.replace('T', ' ') ?? '-'} />
      </div>

      {/* 액션 버튼 */}
      <div className={styles.detailActionBar}>
        <button
          type="button"
          className={`${styles.btnItemCommon} ${styles.btnBgGray} ${isRobotOffline ? styles.btnDisabled : ''}`}
          onClick={isRobotOffline ? undefined : onWorkScheduleOpen}
          disabled={isRobotOffline}
        >
          <img src="/icon/robot_schedule_w.png" alt="" style={{ height: 13 }} />
          <span>작업 복귀</span>
        </button>
        <button
          type="button"
          className={`${styles.btnItemCommon} ${styles.btnBgGray} ${isRobotOffline ? styles.btnDisabled : ''}`}
          onClick={isRobotOffline ? undefined : onPlacePathOpen}
          disabled={isRobotOffline}
        >
          <MapPin size={14} />
          <span>장소 이동</span>
        </button>
        <button
          type="button"
          className={`${styles.btnItemCommon} ${styles.btnBgGray} ${isRobotOffline ? styles.btnDisabled : ''}`}
          onClick={isRobotOffline ? undefined : onPathMoveOpen}
          disabled={isRobotOffline}
        >
          <Route size={14} />
          <span>경로 이동</span>
        </button>
        <button
          type="button"
          className={`${styles.btnItemCommon} ${styles.btnBgGray} ${isRobotOffline ? styles.btnDisabled : ''}`}
          onClick={isRobotOffline ? undefined : onChargeMoveOpen}
          disabled={isRobotOffline}
        >
          <img src="/icon/robot_battery_place_w.png" alt="" style={{ height: 13 }} />
          <span>충전소 이동</span>
        </button>
      </div>
    </div>
  );
}
