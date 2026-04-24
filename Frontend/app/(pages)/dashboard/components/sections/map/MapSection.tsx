"use client";

import styles from "./MapSection.module.css";
import { ZoomControl } from "@/app/components/button";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Floor, RobotRowData, Video, Camera } from "@/app/types";
import type { MapConfig, POIItem, RobotOnMap, MapView, DangerZone } from "@/app/components/map/types";
import type { CanvasMapHandle } from "@/app/components/map/CanvasMap";
import CanvasMap from "@/app/components/map/CanvasMap";
import { apiFetch } from "@/app/lib/api";
import { getApiBase } from "@/app/config";
import { useModalAlert } from "@/app/hooks/useModalAlert";
import { useActiveRouteForRobot } from "@/app/hooks/useActiveRouteForRobot";
import AlertModal from "@/app/components/modal/AlertModal";
import dynamic from "next/dynamic";

const StopAllConfirmModal = dynamic(() => import("@/app/components/modal/BatteryChargeModal"), { ssr: false });

// ── 모듈 레벨 캐시 — 탭 전환해도 유지, npm run dev 재시작 시 초기화 ──
const _cache: {
  mapConfigs: Record<number, { mapId: number; config: MapConfig } | null>;  // floorId → config
  places: POIItem[] | null;
  dangerZones: Record<number, DangerZone[]>;  // mapId → zones
  loaded: boolean;
} = { mapConfigs: {}, places: null, dangerZones: {}, loaded: false };

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
    // 기본 층: "1F" 라벨이 있으면 해당 층, 없으면 첫 번째 층
    const f1Idx = floors.findIndex((f) => f.label === "1F");
    if (f1Idx >= 0) return { idx: f1Idx, floor: floors[f1Idx] };
    return { idx: 0, floor: floors[0] };
  };
  const initial = getInitialFloor();

  const [floorActiveIndex, setFloorActiveIndex] = useState<number>(initial.idx);
  const [selectedFloor, setSelectedFloor] = useState<Floor | null>(initial.floor);
  const [places, setPlaces] = useState<POIItem[]>(_cache.places ?? []);
  const [activeMapId, setActiveMapId] = useState<number | null>(null);
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const [mapView, setMapView] = useState<MapView>("2d");

  // 캐시에서 즉시 mapConfig 복원
  const cachedEntry = selectedFloor ? _cache.mapConfigs[selectedFloor.id] : undefined;
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(cachedEntry?.config ?? null);
  const [mapLoading, setMapLoading] = useState(!cachedEntry);

  const mapRef = useRef<CanvasMapHandle>(null);

  const hasFloors = floors.length > 0;
  const hasRobots = robots.length > 0;
  const hasOnlineRobot = robots.some(r => r.network === "Online");
  const hasWorkingRobot = robots.some(r => r.network === "Online" && r.isNavigating);

  const { modal, modalAlert, closeModal } = useModalAlert();
  const [stopAllConfirmOpen, setStopAllConfirmOpen] = useState(false);

  // 캐시된 mapId도 즉시 복원
  useEffect(() => {
    if (cachedEntry) {
      setActiveMapId(cachedEntry.mapId);
    }
  }, []);

  const handleStopAll = useCallback(() => {
    setStopAllConfirmOpen(true);
  }, []);

  const handleStopAllConfirm = useCallback(() => {
    setStopAllConfirmOpen(false);
    apiFetch(`/nav/stopmove`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) { modalAlert("전체 정지 요청이 실패했습니다."); return; }
        const data = await res.json().catch(() => null);
        modalAlert(data?.was_active ? "모든 로봇의 작업이 중지되었습니다." : "진행 중인 작업이 없습니다.");
      })
      .catch((err) => {
        console.error("전체 정지 실패", err);
        modalAlert("전체 정지 요청이 실패했습니다.");
      });
  }, [modalAlert]);

  // 현재 선택된 층에 있는 로봇들 — 전원이 On인 경우만 표시
  const floorRobots: RobotOnMap[] = useMemo(() => {
    if (!selectedFloor) return [];
    return robots
      .filter((r) =>
        r.currentFloorId === selectedFloor.id
        && r.position?.timestamp > 0
        && r.power === "On"
      )
      .map((r) => ({
        id: r.id,
        name: r.no,
        position: { x: r.position.x, y: r.position.y, yaw: r.position.yaw },
      }));
  }, [robots, selectedFloor?.id]);

  // robotFloorId가 나중에 도착하면 최초 1회 반영.
  // 초기 마운트 때 robotFloorId가 실제로 적용됐는지를 기준으로 판단해야 하며
  // 단순히 initial.floor가 truthy한지로 판단하면 안 됨 (빈 로봇 상태에서 floors[0]
  // 폴백이 이미 들어가 있어 false positive 발생).
  const robotFloorApplied = useRef(robotFloorId != null);
  useEffect(() => {
    if (!hasFloors || robotFloorApplied.current) return;
    if (robotFloorId == null) return;
    const idx = floors.findIndex((f) => f.id === robotFloorId);
    if (idx >= 0) {
      setFloorActiveIndex(idx);
      setSelectedFloor(floors[idx]);
      robotFloorApplied.current = true;
    }
  }, [robotFloorId, hasFloors]);

  // 선택된 층의 맵 로드 (캐시 있으면 스킵)
  useEffect(() => {
    if (!selectedFloor) { setMapLoading(false); return; }

    // 층 이동 시 이전 canvas를 완전히 언마운트하고 로딩 오버레이로 가린 뒤
    // 새 맵을 마운트한다. React의 commit/paint 타이밍상 key 리마운트만으로는
    // 이전 프레임이 몇 ms 남아 보일 수 있어, 명시적으로 mapConfig=null 경유.
    setMapConfig(null);
    setActiveMapId(null);
    setMapLoading(true);

    // 캐시 히트 → 다음 tick에 새 config 세팅 (이 사이 오버레이가 캔버스 전환을 가림)
    const cached = _cache.mapConfigs[selectedFloor.id];
    if (cached !== undefined) {
      const t = setTimeout(() => {
        setMapConfig(cached?.config ?? null);
        setActiveMapId(cached?.mapId ?? null);
        setMapLoading(false);
      }, 80);
      return () => clearTimeout(t);
    }

    // 캐시 미스 → fetch
    let cancelled = false;

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
        img.crossOrigin = "anonymous";
        img.src = `${getApiBase()}${imgPath}`;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
        if (cancelled) return;

        const config: MapConfig = {
          imageSrc: `${getApiBase()}${imgPath}`,
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

  // 위험구간 데이터 — 맵 단위로 캐시
  useEffect(() => {
    if (!activeMapId) { setDangerZones([]); return; }
    const cached = _cache.dangerZones[activeMapId];
    if (cached !== undefined) {
      setDangerZones(cached);
      return;
    }
    let cancelled = false;
    apiFetch(`/DB/danger-zones?map_id=${activeMapId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { ZoneName: string; Description?: string | null; points: { x: number; y: number }[] }[]) => {
        if (cancelled) return;
        const zones: DangerZone[] = data.map((z) => ({
          name: z.ZoneName,
          description: z.Description ?? null,
          points: z.points ?? [],
        }));
        _cache.dangerZones[activeMapId] = zones;
        setDangerZones(zones);
      })
      .catch(() => {
        if (!cancelled) setDangerZones([]);
      });
    return () => { cancelled = true; };
  }, [activeMapId]);

  // 선택된 로봇의 실시간 작업 경로 (정적 /DB/routes 폴링 대체)
  const selectedRobotForRoute = useMemo(
    () => robots.find((r) => r.id === selectedRobotId) ?? null,
    [robots, selectedRobotId]
  );
  const robotPositionForRoute = useMemo(
    () =>
      selectedRobotForRoute?.position?.timestamp
        ? { x: selectedRobotForRoute.position.x, y: selectedRobotForRoute.position.y }
        : null,
    [selectedRobotForRoute?.position?.x, selectedRobotForRoute?.position?.y, selectedRobotForRoute?.position?.timestamp]
  );
  const { navPath, guideLine, activeFloorId } = useActiveRouteForRobot({
    robotName: selectedRobotName ?? selectedRobotForRoute?.no ?? null,
    robotPosition: robotPositionForRoute,
    selectedFloorId: selectedFloor?.id ?? null,
    isNavigating: selectedRobotForRoute?.isNavigating ?? false,
  });

  // 선택된 층의 장소만 필터 — useMemo로 레퍼런스 안정화
  // (매 렌더마다 새 배열이 만들어지면 CanvasMap/Map3DCanvas의 POI effect가
  //  불필요하게 재실행되어 씬이 깜빡이는 원인이 됨)
  const floorPois = useMemo(
    () => (selectedFloor ? places.filter((p) => p.floorId === selectedFloor.id) : []),
    [places, selectedFloor?.id]
  );

  const handleFloorSelect = (idx: number, floor: Floor) => {
    // 층 변경 시 mapConfig/activeMapId를 즉시 null 로 만들어
    // CanvasMap을 곧바로 언마운트시킨다. 이렇게 하지 않으면
    // (setSelectedFloor만 먼저 반영되는) 한 프레임 동안
    // selectedFloor=새 층 + mapConfig=이전 층 상태가 되어,
    // floorPois는 새 층의 POI인데 좌표 변환은 이전 층 config로 계산되어
    // POI가 엉뚱한 위치에 잠깐 보이는 잔상이 생긴다.
    setMapConfig(null);
    setActiveMapId(null);
    setMapLoading(true);
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

        {hasRobots && hasFloors && mapLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner} />
            <span>지도를 불러오는 중...</span>
          </div>
        )}

        <button
          type="button"
          className={`${styles.stopAllBtn} ${!hasWorkingRobot ? styles.stopAllBtnDisabled : ""}`}
          onClick={handleStopAll}
          disabled={!hasWorkingRobot}
        >
          로봇 전체 정지
        </button>

        {hasFloors && (
          <div className={styles.floorList}>
            {[...floors].reverse().map((floor) => {
              const originalIdx = floors.indexOf(floor);
              const isActiveFloor = originalIdx === floorActiveIndex;
              const hasActiveTask = activeFloorId === floor.id && !isActiveFloor;
              return (
                <button
                  key={floor.id}
                  className={`${styles.floorBtn} ${isActiveFloor ? styles.floorBtnActive : ""}`}
                  onClick={() => handleFloorSelect(originalIdx, floor)}
                >
                  {floor.label}
                  {isActiveFloor && <span className={styles.floorIndicator} />}
                  {hasActiveTask && <span className={styles.floorActiveTaskBadge} />}
                </button>
              );
            })}
          </div>
        )}

        {mapConfig && (
          // key로 mapId + view를 합친 값을 사용 → 층 이동 또는 2D↔3D 전환 시
          // CanvasMap 전체가 언마운트/리마운트되어 이전 씬 잔상이 남지 않음
          <CanvasMap
            key={`map-${activeMapId ?? 0}-${mapView}`}
            ref={mapRef}
            config={mapConfig}
            view={mapView}
            robots={floorRobots}
            pois={floorPois}
            navPath={navPath}
            guideLine={guideLine}
            dangerZones={dangerZones}
            showDangerZones
            showPois
            showPath
            showLabels
            onPoiNavigate={handlePoiNavigate}
          />
        )}
        {hasRobots && hasFloors && (
          <ZoomControl
            onClick={handleZoomFromChild}
            mapView={mapView}
            onToggleView={() => setMapView((v) => (v === "2d" ? "3d" : "2d"))}
          />
        )}
      </div>

      {stopAllConfirmOpen && (
        <StopAllConfirmModal
          isOpen={stopAllConfirmOpen}
          message={"연결된 모든 로봇의 작업을 긴급 정지합니다.\n정말 진행하시겠습니까?"}
          onConfirm={handleStopAllConfirm}
          onCancel={() => setStopAllConfirmOpen(false)}
        />
      )}

      <AlertModal
        open={modal.open}
        message={modal.message}
        mode={modal.mode}
        onConfirm={closeModal}
        onClose={closeModal}
      />
    </div>
  );
}
