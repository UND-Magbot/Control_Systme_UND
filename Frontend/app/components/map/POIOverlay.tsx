"use client";

import type { POIItem } from "./types";

type POIOverlayProps = {
  items: { poi: POIItem; screenX: number; screenY: number }[];
  showLabels?: boolean;
  selectedId?: number | null;
  onItemClick?: (poi: POIItem) => void;
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
        return (
          <div
            key={poi.id}
            style={{
              position: "absolute",
              left: screenX,
              top: screenY,
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              cursor: onItemClick ? "pointer" : "default",
              zIndex: 15,
            }}
            onClick={() => onItemClick?.(poi)}
          >
            {/* 마커 */}
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: isSelected ? "#64b4ff" : "#ff6b6b",
                border: "2px solid #fff",
                boxShadow: isSelected
                  ? "0 0 6px 2px rgba(100,180,255,0.8)"
                  : "0 1px 3px rgba(0,0,0,0.4)",
              }}
            />
            {/* 라벨 */}
            {showLabels && (
              <span
                style={{
                  marginTop: 2,
                  fontSize: 10,
                  color: "#fff",
                  whiteSpace: "nowrap",
                  textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                  pointerEvents: "none",
                }}
              >
                {poi.name}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
