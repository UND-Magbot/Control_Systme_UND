"use client";

import React, { useEffect } from "react";
import styles from "./PathAlertsModal.module.css";

type Props = {
  isOpen: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function PathDeleteConfirmModal({ isOpen, message, onCancel, onConfirm }: Props) {
  
  useEffect(() => {
    if (!isOpen) return;

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onCancel]);
  
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onCancel} aria-label="close">
          <img src="/icon/close_btn.png" alt="" />
        </button>

        <div className={styles.message}>{message}</div>

        <div className={styles.footer}>
          <button className={`${styles.btnItemCommon} ${styles.btnBgBlue}`} onClick={onConfirm}>
            <img src="/icon/check.png" alt="" />
            확인
          </button>
        </div>
      </div>
    </div>
  );
}