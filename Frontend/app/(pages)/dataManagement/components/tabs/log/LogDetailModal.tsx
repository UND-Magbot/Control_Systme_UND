"use client";

import React from "react";
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import styles from "./LogDetailModal.module.css";
import type { LogItem } from "@/app/types";

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
    Category: logItem.Category,
    Action: logItem.Action,
    Message: logItem.Message,
    Detail: logItem.Detail,
    RobotId: logItem.RobotId,
    RobotName: logItem.RobotName,
    CreatedAt: logItem.CreatedAt,
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
