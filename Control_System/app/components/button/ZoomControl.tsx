"use client";

import React, { useState } from 'react';
import styles from './Button.module.css'
import { ZoomAction } from '@/app/utils/zoom';

export default function ZoomControl({ 
  onClick
}: { onClick: (action: ZoomAction) => void; }) {
    
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
    const optionItems = [
      { icon: "zoom_in", label: "Zoom In", action: "in" },
      { icon: "zoom_out", label: "Zoom Out", action: "out" },
    ];
  
    return (

      <div className={styles.mapButton}>
        {optionItems.map((item, idx) => (
          <button
            type="button"
            key={idx}
            className={styles.zoomIcon}
            onMouseEnter={() => setHoveredIndex(idx)}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={() => onClick(item.action as ZoomAction)}
          >
            <img src={`/icon/${item.icon}_w.png`} />
          </button>
        ))}
      </div>

    );
}
