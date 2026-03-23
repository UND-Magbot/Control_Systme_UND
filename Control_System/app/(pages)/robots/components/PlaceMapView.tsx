"use client";

import React, { useRef, useMemo } from "react";
import { CanvasMap } from "@/app/components/map";
import type { CanvasMapHandle, POIItem } from "@/app/components/map";
import { TEST_MAP_CONFIG } from "@/app/components/map/mapConfigs";
import type { ZoomAction } from "@/app/utils/zoom";
import styles from "./RobotList.module.css";

type PlaceRow = {
  id: number;
  robotNo: string;
  floor: string;
  placeName: string;
  x: number;
  y: number;
};

type Props = {
  selectedPlaceId?: number | null;
  selectedPlace?: PlaceRow | null;
  placeRows?: PlaceRow[];
  defaultFloor?: string;
};

export default function CameraView({
  selectedPlaceId = null,
  selectedPlace = null,
  placeRows = [],
  defaultFloor = "1F",
}: Props) {
  const mapRef = useRef<CanvasMapHandle>(null);

  const optionItems = [
    { icon: "zoom-in", label: "Zoom In", action: "in" as ZoomAction },
    { icon: "zoom-out", label: "Zoom Out", action: "out" as ZoomAction },
  ];

  // 선택 장소 확정
  const effectiveSelected = useMemo(() => {
    if (selectedPlace) return selectedPlace;
    if (selectedPlaceId == null) return null;
    return placeRows.find((p) => p.id === selectedPlaceId) ?? null;
  }, [selectedPlace, selectedPlaceId, placeRows]);

  const activeFloor = effectiveSelected?.floor ?? defaultFloor;

  // 층별 필터 → POIItem 변환
  const floorPois: POIItem[] = useMemo(
    () =>
      placeRows
        .filter((p) => p.floor === activeFloor)
        .map((p) => ({
          id: p.id,
          name: p.placeName,
          x: p.x,
          y: p.y,
          floor: p.floor,
          isSelected: p.id === selectedPlaceId,
        })),
    [placeRows, activeFloor, selectedPlaceId]
  );

  return (
    <>
      <div className={styles.floorBox}>{activeFloor}</div>
      <CanvasMap
        ref={mapRef}
        config={TEST_MAP_CONFIG}
        pois={floorPois}
        showPois
        showLabels
        selectedPoiId={selectedPlaceId}
      />

      {/* Zoom Buttons */}
      <div className={styles.zoomPosition}>
        <div className={styles.zoomFlex}>
          {optionItems.map((item, idx) => (
            <div
              key={idx}
              className={styles.zoomBox}
              onClick={() => mapRef.current?.handleZoom(item.action)}
            >
              <img src={`/icon/${item.icon}-w.png`} alt={item.label} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
