"use client";

import React, { useRef, useMemo } from "react";
import { CanvasMap } from "@/app/components/map";
import type { CanvasMapHandle, POIItem, NavPath, NavPathSegment } from "@/app/components/map";
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
  mapId?: number | null;
};

type PathRow = {
  id: number;
  robotNo: string;
  workType: string;
  pathName: string;
  pathOrder: string;
  updatedAt: string;
};

type Props = {
  /** 목록에서 선택된 경로 (pathOrder 문자열로 장소 매칭) */
  selectedPath?: PathRow | null;
  /** 전체 장소 목록 (좌표 매칭용) */
  placeRows?: PlaceRow[];
  /** 맵 목록 (동적 MapConfig 생성용) */
  mapRows?: FloorMapRow[];
  /** 모달 내 실시간 미리보기용: selectedOrder 직접 전달 */
  orderPlaces?: PlaceRow[];
  /** compact 모드 (모달 내부에서 작게 표시) */
  compact?: boolean;
};

export default function PathMapView({
  selectedPath = null,
  placeRows = [],
  mapRows = [],
  orderPlaces,
  compact = false,
}: Props) {
  const mapRef = useRef<CanvasMapHandle>(null);
  const { position: robotPos, hasError, isReady } = useRobotPosition(true);
  const { robots } = useRobotStatusContext();

  // 경로에 포함된 장소들 (순서대로)
  const routePlaces: PlaceRow[] = useMemo(() => {
    // 모달에서 직접 전달받은 경우
    if (orderPlaces && orderPlaces.length > 0) return orderPlaces;

    // 목록에서 선택된 경로의 pathOrder 문자열로 매칭
    if (!selectedPath) return [];
    const names = (selectedPath.pathOrder ?? "")
      .split(" - ")
      .map((s) => s.trim())
      .filter(Boolean);

    return names
      .map((nm) => placeRows.find((p) => p.placeName === nm))
      .filter((p): p is PlaceRow => p != null);
  }, [selectedPath, placeRows, orderPlaces]);

  // 첫 번째 장소의 층을 기준으로 표시
  const activeFloor = routePlaces[0]?.floor ?? "1F";
  const activeMapId = routePlaces[0]?.mapId ?? null;
  const mapConfig = useFloorMapConfig(activeMapId, mapRows);

  // 로봇이 현재 표시 중인 맵(층)에 있을 때만 로봇 마커 노출
  const robotOnThisMap = useMemo(
    () =>
      activeMapId != null &&
      robots.some((r) => r.currentMapId === activeMapId && r.power === "On"),
    [robots, activeMapId]
  );
  const showRobotOnMap = isReady && !hasError && robotOnThisMap;

  // POI 변환 (경로에 포함된 장소만)
  const routePois: POIItem[] = useMemo(
    () =>
      routePlaces.map((p, idx) => ({
        id: p.id * 1000 + idx, // 같은 장소가 여러번 올 수 있으므로 고유 id
        name: `${idx + 1}. ${p.placeName}`,
        x: p.x,
        y: p.y,
        floor: p.floor,
        isSelected: false,
      })),
    [routePlaces]
  );

  // NavPath 생성 (장소를 순서대로 연결, 중복 쌍은 양방향선으로 합침)
  const navPath: NavPath | null = useMemo(() => {
    if (routePlaces.length < 2) return null;

    const pairKey = (a: PlaceRow, b: PlaceRow) =>
      a.id < b.id ? `${a.id}_${b.id}` : `${b.id}_${a.id}`;

    const pairCount = new Map<string, number>();
    for (let i = 0; i < routePlaces.length - 1; i++) {
      const k = pairKey(routePlaces[i], routePlaces[i + 1]);
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    }

    const emitted = new Set<string>();
    const segments: NavPathSegment[] = [];
    for (let i = 0; i < routePlaces.length - 1; i++) {
      const from = routePlaces[i];
      const to = routePlaces[i + 1];
      const k = pairKey(from, to);
      if (emitted.has(k)) continue;
      emitted.add(k);

      const isDup = (pairCount.get(k) ?? 0) > 1;
      segments.push({
        from: { x: from.x, y: from.y, name: from.placeName },
        to: { x: to.x, y: to.y, name: to.placeName },
        direction: isDup ? "two-way" : "one-way",
      });
    }

    return { segments };
  }, [routePlaces]);

  return (
    <>
      {!compact && <div className={styles.floorBox}>{activeFloor}</div>}
      {mapConfig ? (
        <CanvasMap
          ref={mapRef}
          config={mapConfig}
          pois={routePois}
          navPath={navPath}
          showPois
          showPath
          showLabels
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

      {/* Zoom Buttons */}
      {!compact && (
        <div className={styles.zoomPosition}>
          <ZoomControl onClick={(action) => mapRef.current?.handleZoom(action)} />
        </div>
      )}
    </>
  );
}
