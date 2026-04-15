"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";

type Props = {
  isOpen: boolean;
  onConfirm: () => void;
};

/**
 * 맵핑 완료 팝업 — 저장 성공 메시지 + 확인 버튼.
 */
export default function MappingSuccessModal({ isOpen, onConfirm }: Props) {
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.successPopup}>
        <div className={styles.successIcon}>&#10003;</div>
        <div className={styles.successText}>
          성공적으로 맵이 저장되었습니다.
        </div>
        <button className={styles.btnConfirm} onClick={onConfirm}>
          확인
        </button>
      </div>
    </div>
  );
}
