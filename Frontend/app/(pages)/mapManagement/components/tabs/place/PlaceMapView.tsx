"use client";

import React, { useRef, useMemo } from "react";
import { CanvasMap } from "@/app/components/map";
import type { CanvasMapHandle, POIItem, POICategory } from "@/app/components/map";
import { useRobotPosition } from "@/app/hooks/useRobotPosition";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import ZoomControl from "@/app/components/button/ZoomControl";
import { useFloorMapConfig, type FloorMapRow } from "@/app/(pages)/mapManagement/hooks/useFloorMapConfig";
import styles from "../../PlacePathList.module.css";

type PlaceRow = {
  id: number;
  robotNo: string;
  floor: string;
  placeName: string;
  x: number;
  y: number;
  category?: POICategory;
  mapId?: number | null;
};

type Props = {
  selectedPlaceId?: number | null;
  selectedPlace?: PlaceRow | null;
  placeRows?: PlaceRow[];
  mapRows?: FloorMapRow[];
  defaultFloor?: string;
};

export default function PlaceMapView({
  selectedPlaceId = null,
  selectedPlace = null,
  placeRows = [],
  mapRows = [],
  defaultFloor = "1F",
}: Props) {
  const mapRef = useRef<CanvasMapHandle>(null);
  const { position: robotPos, hasError, isReady } = useRobotPosition(true);
  const { robots } = useRobotStatusContext();

  const effectiveSelected = useMemo(() => {
    if (selectedPlace) return selectedPlace;
    if (selectedPlaceId == null) return null;
    return placeRows.find((p) => p.id === selectedPlaceId) ?? null;
  }, [selectedPlace, selectedPlaceId, placeRows]);

  const activeFloor = effectiveSelected?.floor ?? defaultFloor;
  const activeMapId = effectiveSelected?.mapId ?? null;
  const mapConfig = useFloorMapConfig(activeMapId, mapRows);

  // 로봇이 현재 표시 중인 맵(층)에 있을 때만 로봇 마커 노출
  const robotOnThisMap = useMemo(
    () =>
      activeMapId != null &&
      robots.some((r) => r.currentMapId === activeMapId && r.power === "On"),
    [robots, activeMapId]
  );
  const showRobotOnMap = isReady && !hasError && robotOnThisMap;

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
      {mapConfig ? (
        <CanvasMap
          ref={mapRef}
          config={mapConfig}
          pois={floorPois}
          showPois
          showLabels
          selectedPoiId={selectedPlaceId}
          showRobot={showRobotOnMap}
          robotPos={showRobotOnMap ? robotPos : undefined}
          robotMarkerSize={14}
        />
      ) : (
        <div className={styles.monitoringLoading}>
          <div className={styles.monitoringLoadingSpinner} />
          <span>지도를 불러오는 중...</span>
        </div>
      )}

      <div className={styles.zoomPosition}>
        <ZoomControl onClick={(action) => mapRef.current?.handleZoom(action)} />
      </div>
    </>
  );
}
