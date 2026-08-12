"use client";

import React, { useRef, useMemo, useState, useEffect } from "react";
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
  // C-03: compact(모달 미리보기)에서는 실시간 위치 폴링 불필요 → 비활성화로 부하 절감
  const { position: robotPos, hasError, isReady } = useRobotPosition(!compact);
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
  // 경로에 등장하는 맵(층)을 최초 등장 순서로 목록화 (다층 경로 대응)
  const routeMaps = useMemo(() => {
    const seen = new Set<number>();
    const list: { mapId: number; floor: string }[] = [];
    for (const p of routePlaces) {
      if (p.mapId != null && !seen.has(p.mapId)) {
        seen.add(p.mapId);
        list.push({ mapId: p.mapId, floor: p.floor });
      }
    }
    return list;
  }, [routePlaces]);
  const isMultiFloor = routeMaps.length > 1;

  // 현재 미리보기로 볼 맵(층). 다층이면 스위처로 전환, 기본=첫 층.
  const [viewMapId, setViewMapId] = useState<number | null>(null);
  useEffect(() => {
    setViewMapId(routeMaps[0]?.mapId ?? null);
  }, [routeMaps]);

  const activeMapId = viewMapId ?? routeMaps[0]?.mapId ?? routePlaces[0]?.mapId ?? null;
  const activeFloor =
    routeMaps.find((m) => m.mapId === activeMapId)?.floor ?? routePlaces[0]?.floor ?? "1F";
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
      routePlaces
        .map((p, idx) => ({ p, idx }))
        // 다층 경로: 현재 보고 있는 층(맵)의 POI만 그린다(타 층 좌표를 이 맵에 찍어 꼬이는 문제 방지)
        .filter(({ p }) => !isMultiFloor || p.mapId === activeMapId)
        .map(({ p, idx }) => ({
          id: p.id * 1000 + idx, // 같은 장소가 여러번 올 수 있으므로 고유 id
          name: `${idx + 1}. ${p.placeName}`,
          x: p.x,
          y: p.y,
          floor: p.floor,
          isSelected: false,
        })),
    [routePlaces, isMultiFloor, activeMapId]
  );

  // NavPath 생성 (장소를 순서대로 연결, 중복 쌍은 양방향선으로 합침)
  const navPath: NavPath | null = useMemo(() => {
    if (routePlaces.length < 2) return null;

    const pairKey = (a: PlaceRow, b: PlaceRow) =>
      a.id < b.id ? `${a.id}_${b.id}` : `${b.id}_${a.id}`;

    // 다층 경로: 현재 층(맵) 내부 구간만 그린다. 층을 넘나드는 구간(EV 전환)은 좌표계가 달라 생략.
    const onActiveMap = (p: PlaceRow) => !isMultiFloor || p.mapId === activeMapId;

    const pairCount = new Map<string, number>();
    for (let i = 0; i < routePlaces.length - 1; i++) {
      const a = routePlaces[i];
      const b = routePlaces[i + 1];
      if (!onActiveMap(a) || !onActiveMap(b)) continue;
      const k = pairKey(a, b);
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    }

    const emitted = new Set<string>();
    const segments: NavPathSegment[] = [];
    for (let i = 0; i < routePlaces.length - 1; i++) {
      const from = routePlaces[i];
      const to = routePlaces[i + 1];
      if (!onActiveMap(from) || !onActiveMap(to)) continue;
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
  }, [routePlaces, isMultiFloor, activeMapId]);

  return (
    <>
      {!compact && (
        isMultiFloor ? (
          <div className={styles.floorSwitch}>
            {routeMaps.map((m) => (
              <button
                key={m.mapId}
                type="button"
                onClick={() => setViewMapId(m.mapId)}
                className={`${styles.floorSwitchBtn} ${m.mapId === activeMapId ? styles.floorSwitchBtnActive : ""}`}
              >
                {m.floor}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.floorBox}>{activeFloor}</div>
        )
      )}
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
