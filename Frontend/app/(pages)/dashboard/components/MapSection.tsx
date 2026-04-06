"use client";

import styles from "./MapSection.module.css";
import { ZoomControl } from "@/app/components/button";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Floor, RobotRowData, Video, Camera } from "@/app/type";
import type { POIItem } from "@/app/components/map/types";
import type { CanvasMapHandle } from "@/app/components/map/CanvasMap";
import CanvasMap from "@/app/components/map/CanvasMap";
import { OCC_GRID_CONFIG } from "@/app/components/map/mapConfigs";
import { useRobotPosition } from "@/app/hooks/useRobotPosition";
import { apiFetch } from "@/app/lib/api";

type MapSectionProps = {
  floors: Floor[];
  robots: RobotRowData[];
  video: Video[];
  cameras: Camera[];
  selectedRobotId?: number | null;
  selectedRobotName?: string;
  robotFloor?: string;
};

export default function MapSection({ floors, robots, video, cameras, selectedRobotId, selectedRobotName, robotFloor = "1F" }: MapSectionProps) {
  const [floorActiveIndex, setFloorActiveIndex] = useState<number>(0);
  const [selectedFloor, setSelectedFloor] = useState<Floor | null>(null);
  const [places, setPlaces] = useState<POIItem[]>([]);

  const mapRef = useRef<CanvasMapHandle>(null);
  const { position: robotPos, hasError: robotPosError, isReady: robotPosReady } = useRobotPosition(true);

  const hasFloors = floors.length > 0;
  const hasRobots = robots.length > 0;

  const isRobotOnCurrentFloor = selectedFloor?.label === robotFloor;

  // 초기 마운트 시 로봇 층으로 자동 선택
  useEffect(() => {
    if (!hasFloors) return;
    const idx = floors.findIndex((f) => f.label === robotFloor);
    if (idx >= 0) {
      setFloorActiveIndex(idx);
      setSelectedFloor(floors[idx]);
    } else if (!selectedFloor) {
      setSelectedFloor(floors[0]);
    }
  }, [floors, robotFloor]);

  // 장소 데이터 fetch
  useEffect(() => {
    apiFetch(`/DB/places`)
      .then((res) => res.ok ? res.json() : [])
      .then((data: any[]) => {
        const mapped: POIItem[] = data.map((p) => ({
          id: p.id,
          name: p.LacationName ?? "",
          x: p.LocationX ?? 0,
          y: p.LocationY ?? 0,
          floor: p.Floor ?? "",
          category: "work" as const,
        }));
        setPlaces(mapped);
      })
      .catch(() => setPlaces([]));
  }, []);

  // 선택된 층의 장소만 필터
  const floorPois = selectedFloor
    ? places.filter((p) => p.floor === selectedFloor.label)
    : [];

  const handleFloorSelect = (idx: number, floor: Floor) => {
    setFloorActiveIndex(idx);
    setSelectedFloor(floor);
  };

  const handleZoomFromChild = (action: string) => {
    mapRef.current?.handleZoom(action as "in" | "out" | "reset");
  };

  const handlePoiNavigate = useCallback(async (poi: POIItem) => {
    try {
      const res = await apiFetch(`/nav/placemove/${poi.id}`, { method: "POST" });
      const data = await res.json();
      console.log("장소 이동 명령 전송:", data.msg ?? data.status);
    } catch (err) {
      console.error("장소 이동 실패:", err);
    }
  }, []);

  return (
    <div className={styles["middle-div"]}>
      <div className={styles["view-div"]}>
        {!hasRobots && (
          <div className={styles.emptyOverlay}>
            <span>등록된 로봇이 없습니다.</span>
            <span className={styles.emptySubText}>로봇을 등록하면 위치를 확인할 수 있습니다.</span>
          </div>
        )}

        {hasRobots && !hasFloors && (
          <div className={styles.emptyOverlay}>
            <span>등록된 층이 없습니다.</span>
            <span className={styles.emptySubText}>층 정보를 등록하면 맵을 확인할 수 있습니다.</span>
          </div>
        )}

        {hasRobots && hasFloors && robotPosError && (
          <div className={styles.posErrorBadge}>위치 수신 불가</div>
        )}

        {/* 층 선택 세로 버튼 리스트 (높은 층 → 낮은 층) */}
        {hasFloors && (
          <div className={styles.floorList}>
            {[...floors].reverse().map((floor) => {
              const originalIdx = floors.indexOf(floor);
              return (
                <button
                  key={floor.id}
                  className={`${styles.floorBtn} ${originalIdx === floorActiveIndex ? styles.floorBtnActive : ""}`}
                  onClick={() => handleFloorSelect(originalIdx, floor)}
                >
                  {floor.label}
                  {originalIdx === floorActiveIndex && <span className={styles.floorIndicator} />}
                </button>
              );
            })}
          </div>
        )}

        <CanvasMap
          ref={mapRef}
          config={OCC_GRID_CONFIG}
          robotPos={hasRobots && robotPosReady && !robotPosError && isRobotOnCurrentFloor ? robotPos : null}
          robotName={selectedRobotName}
          showRobot={isRobotOnCurrentFloor}
          pois={floorPois}
          showPois
          showLabels
          onPoiNavigate={handlePoiNavigate}
        />
        {hasRobots && hasFloors && <ZoomControl onClick={handleZoomFromChild} />}
      </div>
    </div>
  );
}
