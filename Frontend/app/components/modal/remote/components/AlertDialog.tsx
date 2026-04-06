'use client';

import React from 'react';
import styles from './AlertDialog.module.css';

type AlertDialogProps = {
  message: string;
  onClose: () => void;
};

export default function AlertDialog({ message, onClose }: AlertDialogProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <div className={styles.message}>{message}</div>
        <button type="button" className={styles.confirmBtn} onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  );
}
