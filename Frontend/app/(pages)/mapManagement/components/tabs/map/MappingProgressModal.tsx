"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";

type Props = {
  isOpen: boolean;
  isMappingRunning: boolean;
  isMappingStarting: boolean;
  isMappingEnding: boolean;
  saveMapName: string;
  mappingCanvasRef: React.RefObject<HTMLCanvasElement>;
  onStart: () => void;
  onEnd: () => void;
  onCancel: () => void;
};

/**
 * 맵핑 진행 모달 — 좌측에 실시간 PointCloud Canvas,
 * 우측에 상태/컨트롤 버튼(시작/종료/취소)을 표시한다.
 */
export default function MappingProgressModal({
  isOpen,
  isMappingRunning,
  isMappingStarting,
  isMappingEnding,
  saveMapName,
  mappingCanvasRef,
  onStart,
  onEnd,
  onCancel,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.mappingModal}>
        {/* 로딩 오버레이 */}
        {(isMappingStarting || isMappingEnding) && (
          <div className={styles.mappingLoadingOverlay}>
            <div className={styles.mappingLoadingSpinner} />
            <span className={styles.mappingLoadingText}>
              {isMappingStarting ? "맵핑 준비 중..." : "맵 생성 중..."}
            </span>
          </div>
        )}

        {/* 좌측: 맵 시각화 */}
        <div className={styles.mappingModalLeft}>
          <div className={styles.mappingModalCanvas}>
            <canvas ref={mappingCanvasRef} className={styles.mappingCanvasEl} />
          </div>
        </div>

        {/* 우측: 정보 + 컨트롤 */}
        <div className={styles.mappingModalRight}>
          <div className={styles.mappingModalTitle}>맵핑</div>

          {/* 상태 표시 */}
          <div className={styles.mappingStatusSection}>
            <div className={styles.mappingStatusRow}>
              <span className={styles.mappingStatusLabel}>상태</span>
              <span
                className={`${styles.mappingStatusValue} ${
                  isMappingRunning ? styles.statusRunning : styles.statusStopped
                }`}
              >
                {isMappingRunning ? "진행 중" : "대기"}
              </span>
            </div>
            <div className={styles.mappingStatusRow}>
              <span className={styles.mappingStatusLabel}>영역</span>
              <span className={styles.mappingStatusValue}>{saveMapName}</span>
            </div>
          </div>

          {/* 맵핑 인디케이터 */}
          {isMappingRunning && (
            <div className={styles.mappingIndicator}>
              <div className={styles.mappingPulse} />
              <span>맵핑 데이터 수집 중...</span>
            </div>
          )}

          {/* 컨트롤 버튼 */}
          <div className={styles.mappingControls}>
            <button
              className={`${styles.mappingCtrlBtn} ${styles.mappingCtrlStart}`}
              onClick={onStart}
              disabled={isMappingRunning}
            >
              시작
            </button>
            <button
              className={`${styles.mappingCtrlBtn} ${styles.mappingCtrlEnd}`}
              onClick={onEnd}
              disabled={isMappingEnding}
            >
              종료
            </button>
          </div>

          <button className={styles.mappingCancelBtn} onClick={onCancel}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
