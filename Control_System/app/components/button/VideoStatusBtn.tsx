"use client";

import React, { useState } from 'react';
import type { Video, PrimaryViewType } from '@/app/type';
import styles from './Button.module.css';

type VideoStatusProps = { 
  video: Video[];
  className?: string;
  primaryView: PrimaryViewType;
};

export default function VideoSelector ({
  video,
  className,
  primaryView
  }: VideoStatusProps) {

  const isMap = primaryView === "map"; 
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [statusActiveIndex, setStatusActiveIndex] = useState<number>(0);

  return (
    <div className={`${styles.videoStatusBox} ${className}`}>
      {video.map((item, idx) => (
        <button key={item.id} type="button"
          className={`${styles.videoStatusBtn} ${statusActiveIndex === idx ? styles["active"] : ""}`}
          onClick={() => setStatusActiveIndex(idx)}
          aria-pressed={statusActiveIndex === idx}
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <div className={styles.roundIcon}></div>
          <div>{item.label}</div>
        </button>
      ))}
    </div> 
  );
}
