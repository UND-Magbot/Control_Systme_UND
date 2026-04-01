"use client";

import { MapPin, BatteryCharging, Home, Navigation, AlertTriangle, Crosshair, Layers } from "lucide-react";
import type { POIItem, POICategory } from "./types";
import styles from "./POIDetailCard.module.css";

const CATEGORY_META: Record<POICategory, { label: string; color: string; icon: typeof MapPin }> = {
  work:     { label: "작업지",   color: "#ff6b6b", icon: MapPin },
  charge:   { label: "충전소",   color: "#4caf50", icon: BatteryCharging },
  standby:  { label: "대기소",   color: "#9c7cfa", icon: Home },
  waypoint: { label: "경유지",   color: "#64b4ff", icon: Navigation },
  danger:   { label: "위험구역", color: "#ff9800", icon: AlertTriangle },
};

type Props = {
  poi: POIItem;
  screenX: number;
  screenY: number;
  onClose: () => void;
  onNavigate?: (poi: POIItem) => void;
};

export default function POIDetailCard({ poi, screenX, screenY, onClose, onNavigate }: Props) {
  const cat = poi.category ?? "work";
  const meta = CATEGORY_META[cat];

  return (
    <div className={styles.card} style={{ left: screenX, top: screenY }}>
      <button className={styles.closeBtn} onClick={onClose}>✕</button>

      <div className={styles.header}>
        <span className={styles.name}>{poi.name}</span>
        <span className={styles.badge} style={{ background: meta.color }}>
          {meta.label}
        </span>
      </div>

      <div className={styles.infoRow}>
        <Crosshair size={12} />
        X: {poi.x.toFixed(2)}, Y: {poi.y.toFixed(2)}
      </div>

      <div className={styles.infoRow}>
        <Layers size={12} />
        {poi.floor}
      </div>

      {onNavigate && (
        <button
          className={styles.navigateBtn}
          onClick={() => onNavigate(poi)}
        >
          장소 이동
        </button>
      )}
    </div>
  );
}
