"use client";

import React from "react";
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import styles from "./LogDetailModal.module.css";
import type { LogItem } from "@/app/type";

type LogDetailModalProps = {
  isOpen: boolean;
  onClose: () => void;
  logItem: LogItem | null;
};

export default function LogDetailModal({ isOpen, onClose, logItem }: LogDetailModalProps) {
  useModalBehavior({ isOpen, onClose });

  if (!isOpen || !logItem) return null;

  const jsonData = {
    id: logItem.id,
    category: logItem.category,
    category_name: logItem.category_name,
    action: logItem.action,
    message: logItem.message,
    detail: logItem.detail,
    robot_id: logItem.robot_id,
    robot_name: logItem.robot_name,
    source: logItem.source,
    created_at: logItem.created_at,
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>Data</h3>
          <button className={styles.closeButton} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.jsonBlock}>
            {JSON.stringify(jsonData, null, 4)}
          </div>
        </div>
      </div>
    </div>
  );
}
