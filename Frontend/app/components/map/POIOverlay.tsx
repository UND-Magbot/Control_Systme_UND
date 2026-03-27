"use client";

import { MapPin, BatteryCharging, Home, Navigation, AlertTriangle } from "lucide-react";
import type { POIItem, POICategory } from "./types";
import styles from "./POIOverlay.module.css";

/* ── 카테고리별 설정 ── */
const CATEGORY_CONFIG: Record<POICategory, { icon: typeof MapPin; color: string }> = {
  work:    { icon: MapPin,           color: "#ff6b6b" },
  charge:  { icon: BatteryCharging,  color: "#4caf50" },
  standby: { icon: Home,             color: "#9c7cfa" },
  waypoint:{ icon: Navigation,       color: "#64b4ff" },
  danger:  { icon: AlertTriangle,    color: "#ff9800" },
};

const DEFAULT_CONFIG = CATEGORY_CONFIG.work;

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
}: POIOverlayProps) {
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
            {/* 라벨: hover 시 표시, 선택된 항목은 항상 표시 */}
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
