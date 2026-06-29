"use client";

import type { POIItem } from "./types";
import { CATEGORY_CONFIG, DEFAULT_CATEGORY_STYLE as DEFAULT_CONFIG } from "./poiStyle";
import styles from "./POIOverlay.module.css";

type POIOverlayProps = {
  items: { poi: POIItem; screenX: number; screenY: number }[];
  showLabels?: boolean;
  selectedId?: number | null;
  onItemClick?: (poi: POIItem) => void;
  scale?: number;
};

export default function POIOverlay({
  items,
  showLabels = true,
  selectedId,
  onItemClick,
  scale = 1,
}: POIOverlayProps) {
  const inverseScale = 1 / scale;

  return (
    <>
      {items.map(({ poi, screenX, screenY }) => {
        const isSelected = poi.id === selectedId;
        const cfg = poi.category ? CATEGORY_CONFIG[poi.category] : DEFAULT_CONFIG;
        const Icon = cfg.icon;

        return (
          <div
            key={poi.id}
            className={styles.poiItem}
            style={{
              left: screenX,
              top: screenY,
              transform: `translate(-50%, -50%) scale(${inverseScale})`,
              cursor: onItemClick ? "pointer" : "default",
            }}
            onClick={() => onItemClick?.(poi)}
          >
            {/* 마커 */}
            <Icon
              size={18}
              fill={isSelected ? "#64b4ff" : cfg.color}
              color="#fff"
              strokeWidth={1.5}
              style={{
                filter: isSelected
                  ? "drop-shadow(0 0 4px rgba(100,180,255,0.8))"
                  : "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
              }}
            />
            {/* 라벨 */}
            {showLabels && (
              <span className={`${styles.label} ${isSelected ? styles.labelAlwaysVisible : ""}`}>
                {poi.name}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
