"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";
import { useModalBehavior } from "@/app/hooks/useModalBehavior";

type Props = {
  isOpen: boolean;
  isMappingRunning: boolean;
  isMappingStarting: boolean;
  isMappingEnding: boolean;
  isMappingCanceling: boolean;
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
  isMappingCanceling,
  saveMapName,
  mappingCanvasRef,
  onStart,
  onEnd,
  onCancel,
}: Props) {
  // ESC 로는 닫지 않는다(취소는 맵 데이터 삭제) — body 스크롤 잠금만 사용.
  useModalBehavior({ isOpen, onClose: onCancel, disabled: true });

  const busy = isMappingStarting || isMappingEnding || isMappingCanceling;

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div
        className={styles.mappingModal}
        role="dialog"
        aria-modal="true"
        aria-label="맵핑 진행"
      >
        {/* 로딩 오버레이 */}
        {busy && (
          <div className={styles.mappingLoadingOverlay}>
            <div className={styles.mappingLoadingSpinner} />
            <span className={styles.mappingLoadingText}>
              {isMappingStarting
                ? "맵핑 준비 중..."
                : isMappingEnding
                  ? "맵 생성 중..."
                  : "맵핑 취소 중..."}
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
          <h2 className={styles.mappingModalTitle}>맵핑</h2>

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
              <span className={styles.mappingStatusValue} title={saveMapName}>
                {saveMapName}
              </span>
            </div>
          </div>

          {/* 맵핑 인디케이터 */}
          {isMappingRunning && (
            <div className={styles.mappingIndicator}>
              <div className={styles.mappingPulse} />
              <span>맵핑 데이터 수집 중...</span>
            </div>
          )}

          {/* 컨트롤 버튼 — 진행 중이 아니면 시작만, 진행 중이면 종료만 누를 수 있다 */}
          <div className={styles.mappingControls}>
            <button
              className={`${styles.mappingCtrlBtn} ${styles.mappingCtrlStart}`}
              onClick={onStart}
              disabled={isMappingRunning || busy}
              title={isMappingRunning ? "이미 맵핑이 진행 중입니다" : undefined}
            >
              시작
            </button>
            <button
              className={`${styles.mappingCtrlBtn} ${styles.mappingCtrlEnd}`}
              onClick={onEnd}
              disabled={!isMappingRunning || busy}
              title={!isMappingRunning ? "맵핑을 시작한 뒤 사용할 수 있습니다" : undefined}
            >
              종료
            </button>
          </div>

          <button
            className={styles.mappingCancelBtn}
            onClick={onCancel}
            disabled={busy}
            title={isMappingRunning ? "수집한 맵 데이터를 삭제하고 종료합니다" : undefined}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
