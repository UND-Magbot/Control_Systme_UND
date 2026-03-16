"use client";

import React, { useState } from 'react';
import type { Camera } from '@/app/type'
import styles from './Button.module.css';

type CameraSelectorProps = {
  cameras: Camera[];
  activeIndex: number;
  onSelect: (index: number, camId: Camera) => void;
};

export default function CameraSelector({
  cameras,
  activeIndex,
  onSelect,
}: CameraSelectorProps) {
  
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className={styles.viewBtn}>
      {cameras.map((cam, idx) => (
        <button key={cam.id} type="button"
          className={`${styles.camerabtn} ${activeIndex === idx ? styles["active"] : ""}`}
          onClick={() => onSelect(idx, cam)}
          aria-pressed={activeIndex === idx}
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <img src={ hoveredIndex === idx || activeIndex === idx ? "/icon/cam_w.png" : "/icon/cam_b.png"} alt="cam" />
          <span>{cam.label}</span>
        </button>
      ))}
    </div>
  );
}
