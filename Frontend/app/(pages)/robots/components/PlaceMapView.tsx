"use client";

import React, { useRef, useMemo } from "react";
import { CanvasMap } from "@/app/components/map";
import type { CanvasMapHandle, POIItem, POICategory } from "@/app/components/map";
import { TEST_MAP_CONFIG } from "@/app/components/map/mapConfigs";
import { useRobotPosition } from "@/app/hooks/useRobotPosition";
import ZoomControl from "@/app/components/button/ZoomControl";
import styles from "./RobotList.module.css";

type PlaceRow = {
  id: number;
  robotNo: string;
  floor: string;
  placeName: string;
  x: number;
  y: number;
  category?: POICategory;
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
  const { position: robotPos, hasError, isReady } = useRobotPosition(true);
  const showRobotOnMap = isReady && !hasError;

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
          category: p.category,
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
        showRobot={showRobotOnMap}
        robotPos={showRobotOnMap ? robotPos : undefined}
        robotMarkerSize={14}
      />

      {/* Zoom Buttons */}
      <div className={styles.zoomPosition}>
        <ZoomControl onClick={(action) => mapRef.current?.handleZoom(action)} />
      </div>
    </>
  );
}
