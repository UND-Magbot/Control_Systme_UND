"use client";

import React from 'react';
import styles from './Button.module.css'
import { ZoomAction } from '@/app/utils/zoom';

export default function ZoomControl({
  onClick
}: { onClick: (action: ZoomAction) => void; }) {
    return (
      <div className={styles.mapButton}>
        <button type="button" className={styles.zoomIcon} onClick={() => onClick("in")}>
          <img src="/icon/zoom_in_w.png" alt="Zoom In" />
        </button>
        <button type="button" className={styles.zoomIcon} onClick={() => onClick("out")}>
          <img src="/icon/zoom_out_w.png" alt="Zoom Out" />
        </button>
        <button type="button" className={styles.zoomIcon} onClick={() => onClick("reset")} title="되돌리기">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 1 3 6.75" />
            <polyline points="3 7 3 13 9 13" />
          </svg>
        </button>
      </div>
    );
}
