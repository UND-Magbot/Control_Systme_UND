"use client";

import React from "react";
import styles from "./CameraExpandModal.module.css";
import type { Camera } from "@/app/type";
import CameraSlot from "./CameraSlot";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  camera: Camera | null;
  robotName: string;
  onViewAll?: () => void;
};

export default function CameraExpandModal({ isOpen, onClose, camera, robotName, onViewAll }: Props) {
  if (!isOpen || !camera) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{camera.label}</span>
          <div className={styles.headerRight}>
            {onViewAll && (
              <button className={styles.viewAllBtn} onClick={onViewAll}>
                전체 보기
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className={styles.content}>
          <CameraSlot camera={camera} robotName={robotName} />
        </div>
      </div>
    </div>
  );
}
