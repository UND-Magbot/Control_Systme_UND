"use client";

import styles from "./MapSection.module.css";
import { ZoomControl } from "@/app/components/button";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Floor, RobotRowData, Video, Camera } from "@/app/type";
import type { MapConfig, POIItem, RobotOnMap, NavPath, NavPathSegment } from "@/app/components/map/types";
import type { CanvasMapHandle } from "@/app/components/map/CanvasMap";
import CanvasMap from "@/app/components/map/CanvasMap";
import { apiFetch } from "@/app/lib/api";

// ── 모듈 레벨 캐시 — 탭 전환해도 유지, npm run dev 재시작 시 초기화 ──
const _cache: {
  mapConfigs: Record<number, { mapId: number; config: MapConfig } | null>;  // floorId → config
  places: POIItem[] | null;
  navPaths: Record<number, NavPath | null>;  // mapId → navPath
  loaded: boolean;
} = { mapConfigs: {}, places: null, navPaths: {}, loaded: false };

type MapSectionProps = {
  floors: Floor[];
  robots: RobotRowData[];
  video: Video[];
  cameras: Camera[];
  selectedRobotId?: number | null;
  selectedRobotName?: string;
  robotFloorId?: number | null;
};

export default function MapSection({ floors, robots, video, cameras, selectedRobotId, selectedRobotName, robotFloorId = null }: MapSectionProps) {
  // 초기 층을 동기적으로 결정
  const getInitialFloor = (): { idx: number; floor: Floor | null } => {
    if (!floors.length) return { idx: 0, floor: null };
    if (robotFloorId != null) {
      const idx = floors.findIndex((f) => f.id === robotFloorId);
      if (idx >= 0) return { idx, floor: floors[idx] };
    }
    return { idx: 0, floor: floors[0] };
  };
  const initial = getInitialFloor();

  const [floorActiveIndex, setFloorActiveIndex] = useState<number>(initial.idx);
  const [selectedFloor, setSelectedFloor] = useState<Floor | null>(initial.floor);
  const [places, setPlaces] = useState<POIItem[]>(_cache.places ?? []);
  const [activeMapId, setActiveMapId] = useState<number | null>(null);
  const [navPath, setNavPath] = useState<NavPath | null>(null);

  // 캐시에서 즉시 mapConfig 복원
  const cachedEntry = selectedFloor ? _cache.mapConfigs[selectedFloor.id] : undefined;
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(cachedEntry?.config ?? null);
  const [mapLoading, setMapLoading] = useState(!cachedEntry);

  const mapRef = useRef<CanvasMapHandle>(null);

  const hasFloors = floors.length > 0;
  const hasRobots = robots.length > 0;
  const hasRunningTask = robots.some(r => r.tasks.length > 0);

  // 캐시된 mapId도 즉시 복원
  useEffect(() => {
    if (cachedEntry) {
      setActiveMapId(cachedEntry.mapId);
    }
  }, []);

  const handleStopAll = useCallback(() => {
    console.log("전체 정지 클릭");
  }, []);

  // 현재 선택된 층에 있는 로봇들
  const floorRobots: RobotOnMap[] = useMemo(() => {
    if (!selectedFloor) return [];
    return robots
      .filter((r) => r.currentFloorId === selectedFloor.id && r.position?.timestamp > 0)
      .map((r) => ({
        id: r.id,
        name: r.no,
        position: { x: r.position.x, y: r.position.y, yaw: r.position.yaw },
      }));
  }, [robots, selectedFloor?.id]);

  // robotFloorId가 나중에 도착하면 최초 1회만 반영
  const initialFloorSet = useRef(initial.floor !== null);
  useEffect(() => {
    if (!hasFloors || initialFloorSet.current) return;
    if (robotFloorId == null) return;
    const idx = floors.findIndex((f) => f.id === robotFloorId);
    if (idx >= 0) {
      setFloorActiveIndex(idx);
      setSelectedFloor(floors[idx]);
      initialFloorSet.current = true;
    }
  }, [robotFloorId]);

  // 선택된 층의 맵 로드 (캐시 있으면 스킵)
  useEffect(() => {
    if (!selectedFloor) { setMapLoading(false); return; }

    // 캐시 히트 → fetch 불필요
    const cached = _cache.mapConfigs[selectedFloor.id];
    if (cached !== undefined) {
      setMapConfig(cached?.config ?? null);
      setActiveMapId(cached?.mapId ?? null);
      setMapLoading(false);
      return;
    }

    // 캐시 미스 → fetch
    let cancelled = false;
    setMapLoading(true);

    (async () => {
      try {
        const mapsRes = await apiFetch(`/map/maps?floor_id=${selectedFloor.id}`);
        const maps = await mapsRes.json();
        if (cancelled) return;
        if (!maps.length) {
          _cache.mapConfigs[selectedFloor.id] = null;
          setMapConfig(null);
          setMapLoading(false);
          return;
        }

        const map = maps[0];
        const imgPath = map.ImgFilePath?.replace("./", "/") || map.PgmFilePath?.replace("./", "/");

        const metaRes = await apiFetch(`/map/maps/${map.id}/meta`);
        const meta = await metaRes.json();
        if (cancelled) return;

        // 이미지 프리로드
        const img = new Image();
        img.src = imgPath;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
        if (cancelled) return;

        const config: MapConfig = {
          imageSrc: imgPath,
          resolution: meta.resolution ?? 0.1,
          originX: meta.originX ?? 0,
          originY: meta.originY ?? 0,
          pixelWidth: img.naturalWidth || 335,
          pixelHeight: img.naturalHeight || 450,
        };

        // 캐시에 저장
        _cache.mapConfigs[selectedFloor.id] = { mapId: map.id, config };

        setActiveMapId(map.id);
        setMapConfig(config);
        setMapLoading(false);
      } catch {
        if (!cancelled) setMapLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedFloor?.id]);

  // 장소 데이터 (캐시 있으면 스킵)
  useEffect(() => {
    if (_cache.places) return;
    apiFetch(`/DB/places`)
      .then((res) => res.ok ? res.json() : [])
      .then((data: any[]) => {
        const mapped: POIItem[] = data.map((p) => ({
          id: p.id,
          name: p.LacationName ?? "",
          x: p.LocationX ?? 0,
          y: p.LocationY ?? 0,
          floor: p.Floor ?? "",
          floorId: p.FloorId ?? null,
          category: p.Category === "charge" ? "charge" as const : "work" as const,
        }));
        _cache.places = mapped;
        setPlaces(mapped);
      })
      .catch(() => setPlaces([]));
  }, []);

  // 구간(경로) 데이터 (캐시 있으면 스킵)
  useEffect(() => {
    if (!activeMapId) { setNavPath(null); return; }

    const cached = _cache.navPaths[activeMapId];
    if (cached !== undefined) {
      setNavPath(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/DB/routes?map_id=${activeMapId}`);
        const routes: { StartPlaceName: string; EndPlaceName: string; Direction: string }[] = await res.json();
        if (cancelled || !routes.length) {
          _cache.navPaths[activeMapId] = null;
          setNavPath(null);
          return;
        }

        const segments: NavPathSegment[] = routes
          .map((r) => {
            const from = places.find((p) => p.name === r.StartPlaceName);
            const to = places.find((p) => p.name === r.EndPlaceName);
            if (!from || !to) return null;
            return {
              from: { x: from.x, y: from.y, name: from.name },
              to: { x: to.x, y: to.y, name: to.name },
              direction: r.Direction === "bidirectional" ? "two-way" as const : "one-way" as const,
            };
          })
          .filter((s): s is NavPathSegment => s !== null);

        const path = segments.length > 0 ? { segments } : null;
        _cache.navPaths[activeMapId] = path;
        if (!cancelled) setNavPath(path);
      } catch {
        if (!cancelled) setNavPath(null);
      }
    })();
    return () => { cancelled = true; };
  }, [activeMapId, places]);

  // 선택된 층의 장소만 필터
  const floorPois = selectedFloor
    ? places.filter((p) => p.floorId === selectedFloor.id)
    : [];

  const handleFloorSelect = (idx: number, floor: Floor) => {
    setFloorActiveIndex(idx);
    setSelectedFloor(floor);
    mapRef.current?.handleZoom("reset");
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

        {hasRobots && hasFloors && !mapConfig && !mapLoading && (
          <div className={styles.emptyOverlay}>
            <span>해당 층에 등록된 맵이 없습니다.</span>
          </div>
        )}

        <button
          type="button"
          className={`${styles.stopAllBtn} ${!hasRunningTask ? styles.stopAllBtnDisabled : ""}`}
          onClick={handleStopAll}
          disabled={!hasRunningTask}
        >
          로봇 전체 정지
        </button>

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

        {mapConfig && (
          <CanvasMap
            ref={mapRef}
            config={mapConfig}
            robots={floorRobots}
            pois={floorPois}
            navPath={navPath}
            showPois
            showPath
            showLabels
            onPoiNavigate={handlePoiNavigate}
          />
        )}
        {hasRobots && hasFloors && <ZoomControl onClick={handleZoomFromChild} />}
      </div>
    </div>
  );
}
