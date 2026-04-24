"use client";

import { useState } from "react";
import type { POIItem } from "./types";
import styles from "./POIOverlay.module.css";
import { getCategoryMeta } from "./categoryMeta";
import PoiDisambiguationPopup, { type DisambiguationCandidate } from "./PoiDisambiguationPopup";

type POIOverlayProps = {
  items: { poi: POIItem; screenX: number; screenY: number }[];
  showLabels?: boolean;
  selectedId?: number | null;
  onItemClick?: (poi: POIItem) => void;
  scale?: number;
};

// POI 아이콘의 가시 영역(~12px)에 맞춘 겹침 판정 반경.
// 아이콘 렌더 크기(20px)의 투명 패딩을 제외한 실제 점 크기 기준.
const POI_HIT_PX = 12;

export default function POIOverlay({
  items,
  showLabels = true,
  selectedId,
  onItemClick,
  scale = 1,
}: POIOverlayProps) {
  const inverseScale = 1 / scale;

  // 겹친 POI 선택 팝업 상태
  const [pendingPick, setPendingPick] = useState<{
    screenX: number;
    screenY: number;
    candidates: DisambiguationCandidate[];
  } | null>(null);

  const handleItemClick = (
    clicked: { poi: POIItem; screenX: number; screenY: number },
    e: React.MouseEvent,
  ) => {
    if (!onItemClick) return;

    const overlapping = items.filter(
      (it) =>
        Math.hypot(it.screenX - clicked.screenX, it.screenY - clicked.screenY) <=
        POI_HIT_PX,
    );

    if (overlapping.length <= 1) {
      onItemClick(clicked.poi);
      return;
    }

    setPendingPick({
      screenX: e.clientX,
      screenY: e.clientY,
      candidates: overlapping.map(({ poi }) => ({
        key: String(poi.id),
        name: poi.name,
        category: poi.category,
      })),
    });
  };

  const handlePick = (key: string) => {
    if (!pendingPick || !onItemClick) {
      setPendingPick(null);
      return;
    }
    const picked = items.find(({ poi }) => String(poi.id) === key);
    setPendingPick(null);
    if (picked) onItemClick(picked.poi);
  };

  return (
    <>
      {items.map((item) => {
        const { poi, screenX, screenY } = item;
        const isSelected = poi.id === selectedId;
        const cfg = getCategoryMeta(poi.category);
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
            onClick={(e) => handleItemClick(item, e)}
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

      <PoiDisambiguationPopup
        open={pendingPick !== null}
        screenX={pendingPick?.screenX ?? 0}
        screenY={pendingPick?.screenY ?? 0}
        candidates={pendingPick?.candidates ?? []}
        onPick={handlePick}
        onCancel={() => setPendingPick(null)}
      />
    </>
  );
}
