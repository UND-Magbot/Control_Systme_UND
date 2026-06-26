"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import PermissionGuard from "@/app/components/common/PermissionGuard";
import styles from "./mapManagement.module.css";
import PlaceList from "./components/tabs/place/PlaceManageTab";
import PathList from "./components/tabs/path/PathManageTab";
import MapPlaceCreateModal from "./components/tabs/map/MapPlaceCreateModal";
import type { PendingPlace } from "./components/tabs/map/MapPlaceCreateModal";
import type { RobotRowData, Floor } from "@/app/types";
import { apiFetch } from "@/app/lib/api";
import { API_BASE } from "@/app/config";
import { usePageReady } from "@/app/context/PageLoadingContext";
import { useModalAlert } from "@/app/hooks/useModalAlert";
import { useAuth } from "@/app/context/AuthContext";
import MapAlertModal from "@/app/components/modal/AlertModal";
import InitPoseConfirmModal from "@/app/components/modal/InitPoseConfirmModal";
import type {
  MapTab,
  MappingState,
  Business,
  FloorItem,
  RobotMap,
  Robot,
  RouteDirection,
  RouteSegment,
  DbRoute,
  UndoAction,
} from "./types/map";
import { useRobotPolling } from "./hooks/useRobotPolling";
import { useMapMeta } from "./hooks/useMapMeta";
import { useSvgPanZoom } from "./hooks/useSvgPanZoom";
import { useMappingWebSocket } from "./hooks/useMappingWebSocket";
import { usePlaceDelete } from "./hooks/usePlaceDelete";
import { usePathBuilding } from "./hooks/usePathBuilding";
import { useRouteCreation } from "./hooks/useRouteCreation";
import { processMapImage } from "./utils/processMapImage";
import RobotConnectModal from "./components/tabs/map/RobotConnectModal";
import MapSyncModal from "./components/tabs/map/MapSyncModal";
import MapSyncProgressModal from "./components/tabs/map/MapSyncProgressModal";
import type { RobotSyncState } from "./components/tabs/map/MapSyncProgressModal";
import MappingStartModal from "./components/tabs/map/MappingStartModal";
import MappingProgressModal from "./components/tabs/map/MappingProgressModal";
import MappingSuccessModal from "./components/tabs/map/MappingSuccessModal";
import PathBuildPanel from "./components/tabs/map/PathBuildPanel";
import MapToolbar from "./components/tabs/map/MapToolbar";
import ImportMapModal from "./components/tabs/map/ImportMapModal";
import MapRightPanel from "./components/tabs/map/MapRightPanel";
// 위험구역 기능 비활성화 (요청에 의해 OFF — 에러 상황 방지)
// import DangerZoneLayer from "./components/tabs/map/DangerZoneLayer";
// import DangerZoneSaveModal from "./components/tabs/map/DangerZoneSaveModal";
import { useDangerZoneDraw } from "./hooks/useDangerZoneDraw";
import { polygonCentroid } from "./dangerZone/geometry";
import { validateDangerZone } from "./dangerZone/validation";
import type { ZonePoint, SvgMetaLike, DangerZone } from "./dangerZone/types";

export default function MapManagementPage() {
  const setPageReady = usePageReady();
  const { modal, modalAlert, modalConfirm, closeModal, handleConfirm } = useModalAlert();
  const readyFlags = useRef({ robots: false, maps: false });
  const checkReady = () => {
    if (readyFlags.current.robots && readyFlags.current.maps) setPageReady();
  };
  // ── URL query에서 초기 탭 결정 ──
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as MapTab) || "map";
  const [activeTab, setActiveTab] = useState<MapTab>(
    ["map", "place", "path"].includes(initialTab) ? initialTab : "map"
  );

  // ── 탭 권한 필터 (DB menu_info 기반) ──
  const { hasPermission, isMenuVisible, menuIndex } = useAuth();
  const mapTabs = useMemo(() => {
    const all: { id: MapTab; menuKey: string; fallback: string }[] = [
      { id: "map",   menuKey: "map-edit",   fallback: "맵 편집" },
      { id: "place", menuKey: "place-list", fallback: "장소 목록" },
      { id: "path",  menuKey: "path-list",  fallback: "경로 목록" },
    ];
    return all
      .filter((t) => hasPermission(t.menuKey) && isMenuVisible(t.menuKey))
      .map((t) => ({
        id: t.id,
        label: menuIndex.get(t.menuKey)?.label ?? t.fallback,
      }));
  }, [hasPermission, isMenuVisible, menuIndex]);

  // 권한 필터링으로 현재 탭이 사라지면 첫 탭으로 복귀
  useEffect(() => {
    if (mapTabs.length > 0 && !mapTabs.some((t) => t.id === activeTab)) {
      setActiveTab(mapTabs[0].id);
    }
  }, [mapTabs, activeTab]);

  // ── PlaceList / PathList 용 데이터 ──
  const [tabRobots, setTabRobots] = useState<RobotRowData[]>([]);
  const [tabFloors, setTabFloors] = useState<Floor[]>([]);

  useEffect(() => {
    const fetchTabRobots = async () => {
      try {
        const res = await apiFetch(`/DB/robots`);
        if (!res.ok) return;
        const raw = await res.json();
        const mapped: RobotRowData[] = raw.map((item: any) => ({
          id: item.id,
          no: item.RobotName ?? "",
          type: item.robot_type ?? "",
          info: item.RobotName ?? "",
          battery: item.battery ?? 0,
          batteryLeft: item.BatteryLeft ?? undefined,
          batteryRight: item.BatteryRight ?? undefined,
          return: item.LimitBattery ?? 30,
          isCharging: item.is_charging ?? false,
          network: item.network ?? "Online",
          power: item.power ?? "On",
          mark: item.mark ?? "No",
          tasks: Array.isArray(item.tasks) ? item.tasks : [],
          errors: Array.isArray(item.errors) ? item.errors : [],
          chargingTime: item.charging_time ?? 0,
          waitingTime: item.waiting_time ?? 0,
          dockingTime: item.docking_time ?? 0,
          operator: item.ProductCompany ?? "",
          serialNumber: item.SerialNumber ?? "",
          model: item.ModelName ?? "",
          group: item.Group ?? "",
          softwareVersion: item.SWversion ?? "",
          site: item.Site ?? "",
          registrationDateTime: item.CreatedAt ?? "",
        }));
        setTabRobots(mapped);
      } catch (e) {
        console.error("로봇 데이터 로드 실패:", e);
      } finally {
        readyFlags.current.robots = true;
        checkReady();
      }
    };
    fetchTabRobots();
  }, []);

  // tabFloors를 floor_info에서 로드
  useEffect(() => {
    apiFetch(`/map/floors`)
      .then((res) => res.ok ? res.json() : [])
      .then((data: { id: number; FloorName: string }[]) => {
        setTabFloors(data.map((a) => ({ id: a.id, label: a.FloorName })));
      })
      .catch(() => {});
  }, []);

  // ── 사업장 / 층 / 영역(맵) 데이터 ──
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [floors, setFloors] = useState<FloorItem[]>([]);
  const [maps, setMaps] = useState<RobotMap[]>([]);
  const [selectedBiz, setSelectedBiz] = useState<number | "">("");
  const [selectedFloor, setSelectedFloor] = useState<number | "">("");
  const [selectedMap, setSelectedMap] = useState<number | "">("");

  // ── 맵핑 상태 ──
  const [mappingState, setMappingState] = useState<MappingState>("idle");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  // ── 로봇 연결 ──
  const [showRobotModal, setShowRobotModal] = useState(false);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [connectedRobots, setConnectedRobots] = useState<Robot[]>([]);
  const [selectedInitPoseRobot, setSelectedInitPoseRobot] = useState<Robot | null>(null);
  const [selectedConnectIds, setSelectedConnectIds] = useState<number[]>([]);
  const [robotListLoading, setRobotListLoading] = useState(false);

  // ── 가져오기 (로봇 내부 맵 → 관제 등록) ──
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRobots, setImportRobots] = useState<Robot[]>([]);

  // ── 동기화 (맵 적용) ──
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncRobots, setSyncRobots] = useState<Robot[]>([]);
  const [selectedSyncIds, setSelectedSyncIds] = useState<number[]>([]);
  const [syncProgressStates, setSyncProgressStates] = useState<RobotSyncState[]>([]);
  const [showSyncProgressModal, setShowSyncProgressModal] = useState(false);
  const [robotPos, setRobotPos] = useState<{ x: number; y: number; yaw: number } | null>(null);

  // ── 맵 메타 (origin, resolution) — 훅으로 분리 ──
  const mapMeta = useMapMeta(selectedMap);

  // ── 맵 위 장소 목록 ──
  const [mapPlaces, setMapPlaces] = useState<
    { id: number; LacationName: string; LocationX: number; LocationY: number; Yaw: number;
      RobotName?: string; Floor?: string; FloorId?: number; MapId?: number; Category?: string; Imformation?: string;
      Polygon?: number[][] | null }[]
  >([]);

  const loadMapPlaces = useCallback(async (mapId: number) => {
    try {
      const res = await apiFetch(`/DB/places?map_id=${mapId}`);
      const data = await res.json();
      setMapPlaces(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("장소 로드 실패:", e);
      setMapPlaces([]);
    }
  }, []);

  useEffect(() => {
    if (selectedMap === "") {
      setMapPlaces([]);
      return;
    }
    loadMapPlaces(selectedMap as number);
  }, [selectedMap, loadMapPlaces]);

  // ── 미저장 장소 (맵 위 임시) ──
  const [pendingPlaces, setPendingPlaces] = useState<PendingPlace[]>([]);

  // ── 되돌리기 스택 ──
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);

  // ── 위험구역(폴리곤) 그리기 ──
  const danger = useDangerZoneDraw();
  const [isDangerMode, setIsDangerMode] = useState(false);
  const [dangerCursor, setDangerCursor] = useState<ZonePoint | null>(null);
  const [dangerSave, setDangerSave] = useState<{ points: ZonePoint[]; centroid: ZonePoint } | null>(null);

  const resetDangerMode = useCallback(() => {
    setIsDangerMode(false);
    setDangerCursor(null);
    danger.reset();
  }, [danger]);

  const clearAllModes = () => {
    setIsPlaceMode(false);
    resetDeleteMode();
    resetRouteMode();
    resetPathBuild();
    resetDangerMode();
  };

  const handleUndo = () => {
    clearAllModes();

    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      switch (action.type) {
        case "addPlace":
          setPendingPlaces((pp) => pp.filter((p) => p.tempId !== action.tempId));
          break;
        case "deletePendingPlace":
          setPendingPlaces((pp) => [...pp, action.place]);
          if (action.cascadedDbRoutes.length > 0)
            setDeletedRouteDbIds((ids) => { const next = new Set(ids); action.cascadedDbRoutes.forEach((id) => next.delete(id)); return next; });
          if (action.cascadedPendingRoutes.length > 0)
            setPendingRoutes((pr) => [...pr, ...action.cascadedPendingRoutes]);
          break;
        case "deleteDbPlace":
          setDeletedDbIds((ids) => { const next = new Set(ids); next.delete(action.id); return next; });
          if (action.cascadedDbRoutes.length > 0)
            setDeletedRouteDbIds((ids) => { const next = new Set(ids); action.cascadedDbRoutes.forEach((id) => next.delete(id)); return next; });
          if (action.cascadedPendingRoutes.length > 0)
            setPendingRoutes((pr) => [...pr, ...action.cascadedPendingRoutes]);
          break;
        case "addRoute":
          setPendingRoutes((pr) => pr.filter((r) => r.tempId !== action.tempId));
          break;
        case "deletePendingRoute":
          setPendingRoutes((pr) => [...pr, action.route]);
          break;
        case "deleteDbRoute":
          setDeletedRouteDbIds((ids) => { const next = new Set(ids); next.delete(action.id); return next; });
          break;
        case "mapReset":
          setPendingPlaces(action.prevPendingPlaces);
          setPendingRoutes(action.prevPendingRoutes);
          setDeletedDbIds(action.prevDeletedDbIds);
          setDeletedRouteDbIds(action.prevDeletedRouteDbIds);
          setMovedPlaces(action.prevMovedPlaces);
          setModifiedDbIds(action.prevModifiedDbIds);
          break;
      }
      return prev.slice(0, -1);
    });
  };

  // ── 상단 저장 버튼: 장소+구간 삭제/신규 일괄 DB 저장 ──
  const handleSaveAll = async () => {
    clearAllModes();
    const hasChanges = pendingPlaces.length > 0 || deletedDbIds.size > 0
      || pendingRoutes.length > 0 || deletedRouteDbIds.size > 0
      || movedPlaces.size > 0;
    if (!hasChanges) {
      modalAlert("저장할 변경사항이 없습니다.");
      return;
    }

    try {
      // 삭제된 장소명 수집 (경로 정리용)
      const deletedPlaceNames = new Set(
        mapPlaces.filter((p) => deletedDbIds.has(p.id)).map((p) => p.LacationName)
      );

      // 장소 삭제
      for (const id of deletedDbIds) {
        const res = await apiFetch(`/DB/places/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`장소 ID ${id} 삭제 실패`);
      }
      // 구간 삭제
      for (const id of deletedRouteDbIds) {
        const res = await apiFetch(`/DB/routes/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`구간 ID ${id} 삭제 실패`);
      }
      // 삭제된 장소를 참조하는 경로(WayInfo) 삭제
      if (deletedPlaceNames.size > 0) {
        try {
          const wayRes = await apiFetch(`/DB/getpath`);
          if (wayRes.ok) {
            const ways: { id: number; WayPoints: string }[] = await wayRes.json();
            for (const way of ways) {
              const wpNames = (way.WayPoints || "").split(" - ").map((n: string) => n.trim());
              if (wpNames.some((n: string) => deletedPlaceNames.has(n))) {
                await apiFetch(`/DB/path/${way.id}`, { method: "DELETE" });
              }
            }
          }
        } catch (e) {
          console.error("경로 정리 실패:", e);
        }
      }
      // 이동된 DB 장소 업데이트
      for (const [name, coords] of movedPlaces) {
        const dbPlace = mapPlaces.find((p) => p.LacationName === name);
        if (dbPlace && !deletedDbIds.has(dbPlace.id)) {
          const res = await apiFetch(`/DB/places/${dbPlace.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              RobotName: dbPlace.RobotName ?? "",
              LacationName: dbPlace.LacationName,
              FloorId: dbPlace.FloorId ?? null,
              LocationX: Number(coords.x.toFixed(3)),
              LocationY: Number(coords.y.toFixed(3)),
              Yaw: Number((dbPlace.Yaw ?? 0).toFixed(3)),
              MapId: dbPlace.MapId ?? null,
              Category: dbPlace.Category ?? "waypoint",
              Imformation: dbPlace.Imformation ?? null,
            }),
          });
          if (!res.ok) throw new Error(`장소 "${name}" 위치 업데이트 실패`);
        }
      }
      // 장소 신규 저장 (이동된 pending 장소는 좌표 반영)
      for (const p of pendingPlaces) {
        const { tempId, ...payload } = p;
        const moved = movedPlaces.get(p.LacationName);
        if (moved) {
          payload.LocationX = Number(moved.x.toFixed(3));
          payload.LocationY = Number(moved.y.toFixed(3));
        }
        const res = await apiFetch(`/DB/places`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`장소 "${p.LacationName}" 저장 실패`);
      }
      // 경로 신규 저장
      const mapId = selectedMap as number;
      for (const r of pendingRoutes) {
        const res = await apiFetch(`/DB/routes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            MapId: mapId,
            StartPlaceName: r.startName,
            EndPlaceName: r.endName,
            Direction: r.direction,
          }),
        });
        if (!res.ok) throw new Error(`구간 "${r.startName}→${r.endName}" 저장 실패`);
      }

      modalAlert("저장되었습니다.");
      setPendingPlaces([]);
      setDeletedDbIds(new Set());
      setPendingRoutes([]);
      setDeletedRouteDbIds(new Set());
      setMovedPlaces(new Map());
      setModifiedDbIds(new Set());
      setUndoStack([]);
      if (selectedMap !== "") {
        loadMapPlaces(selectedMap as number);
        loadMapRoutes(selectedMap as number);
      }
    } catch (e) {
      console.error(e);
      modalAlert(e instanceof Error ? e.message : "저장 중 오류 발생");
    }
  };

  // ── 장소 생성 모드 ──
  const [isPlaceMode, setIsPlaceMode] = useState(false);
  const [showInitPoseTargetModal, setShowInitPoseTargetModal] = useState(false);
  const [showInitPoseManualModal, setShowInitPoseManualModal] = useState(false);

  const [showGrid, setShowGrid] = useState(false);
  const [showPlaceModal, setShowPlaceModal] = useState(false);
  const [placeClickCoords, setPlaceClickCoords] = useState<{
    worldX: number; worldY: number; pixelX: number; pixelY: number;
  } | null>(null);
  const [isFromRobotPos, setIsFromRobotPos] = useState(false);
  const [isChargeCreate, setIsChargeCreate] = useState(false);
  const [chargeDockingPlace, setChargeDockingPlace] = useState<PendingPlace | null>(null);

  // ── 장소 인라인 수정 ──
  const [editingPlace, setEditingPlace] = useState<{
    key: string; name: string; svgX: number; svgY: number;
    x: number; y: number; yaw: number; desc: string;
  } | null>(null);
  const [editValues, setEditValues] = useState({ name: "", x: "", y: "", dir: "", desc: "" });
  const [modifiedDbIds, setModifiedDbIds] = useState<Set<number>>(new Set());

  // ── 장소 삭제 모드 (훅으로 분리) ──
  const {
    isDeleteMode, setIsDeleteMode,
    deletedDbIds, setDeletedDbIds,
    deleteConfirmTarget, setDeleteConfirmTarget,
    reset: resetDeleteMode,
  } = usePlaceDelete();

  // ── 경로 생성 모드 (way_info) — 훅으로 분리 ──
  const {
    isPathBuildMode, setIsPathBuildMode,
    pathBuildOrder, setPathBuildOrder,
    pathBuildWaits, setPathBuildWaits,
    pathBuildName, setPathBuildName,
    pathBuildWorkType, setPathBuildWorkType,
    reset: resetPathBuild,
  } = usePathBuilding();

  // ── 구간 생성 모드 (훅으로 분리) ──
  const {
    isRouteMode, setIsRouteMode,
    routeStartName, setRouteStartName,
    routeEndName, setRouteEndName,
    routeDirection, setRouteDirection,
    pendingRoutes, setPendingRoutes,
    dbRoutes, setDbRoutes,
    deletedRouteDbIds, setDeletedRouteDbIds,
    reset: resetRouteMode,
  } = useRouteCreation();

  // 경로 빌드: 현재 마지막 장소에서 갈 수 있는 장소 이름 Set
  const pathReachable = useMemo(() => {
    if (!isPathBuildMode || pathBuildOrder.length === 0) return null;
    const last = pathBuildOrder[pathBuildOrder.length - 1];
    const allRoutes = [
      ...dbRoutes.filter((r) => !deletedRouteDbIds.has(r.id)),
      ...pendingRoutes.map((r) => ({ id: 0, MapId: 0, StartPlaceName: r.startName, EndPlaceName: r.endName, Direction: r.direction })),
    ];
    const names = new Set<string>();
    for (const r of allRoutes) {
      if (r.Direction === "forward" && r.StartPlaceName === last) names.add(r.EndPlaceName);
      if (r.Direction === "reverse" && r.EndPlaceName === last) names.add(r.StartPlaceName);
      if (r.Direction === "bidirectional") {
        if (r.StartPlaceName === last) names.add(r.EndPlaceName);
        if (r.EndPlaceName === last) names.add(r.StartPlaceName);
      }
    }
    return names;
  }, [isPathBuildMode, pathBuildOrder, dbRoutes, pendingRoutes, deletedRouteDbIds]);

  // 경로 저장
  const handleSavePath = async () => {
    if (!pathBuildName.trim()) { modalAlert("경로명을 입력해주세요."); return; }
    if (pathBuildOrder.length < 2) { modalAlert("장소를 2개 이상 선택해주세요."); return; }

    // RobotName: 연결된 로봇 > 첫 번째 장소의 RobotName > 빈 문자열
    const robotName =
      connectedRobots[0]?.RobotName
      ?? mapPlaces.find((p) => p.LacationName === pathBuildOrder[0])?.RobotName
      ?? pendingPlaces.find((p) => p.LacationName === pathBuildOrder[0])?.RobotName
      ?? "";

    if (!robotName) { modalAlert("로봇 정보를 확인할 수 없습니다. 로봇을 연결하거나 장소에 로봇을 지정해주세요."); return; }

    try {
      const waits = pathBuildOrder.map((_, i) =>
        Math.max(0, Math.floor(pathBuildWaits[i] ?? 0))
      );
      const hasWait = waits.some((w) => w > 0);
      const res = await apiFetch(`/DB/path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RobotName: robotName,
          TaskType: pathBuildWorkType,
          WayName: pathBuildName.trim(),
          WayPoints: pathBuildOrder.join(" - "),
          WaitSeconds: hasWait ? JSON.stringify(waits) : null,
        }),
      });
      if (!res.ok) throw new Error("경로 저장 실패");
      modalAlert("경로가 저장되었습니다.");
      setIsPathBuildMode(false);
      setPathBuildOrder([]);
      setPathBuildWaits([]);
      setPathBuildName("");
      setRightPanelOpen(true);
    } catch (e) {
      console.error(e);
      modalAlert(e instanceof Error ? e.message : "저장 중 오류 발생");
    }
  };

  // ── 경로 DB 로드 ──
  const loadMapRoutes = useCallback(async (mapId: number) => {
    try {
      const res = await apiFetch(`/DB/routes?map_id=${mapId}`);
      const data = await res.json();
      setDbRoutes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("경로 로드 실패:", e);
      setDbRoutes([]);
    }
  }, []);

  useEffect(() => {
    if (selectedMap === "") {
      setDbRoutes([]);
      return;
    }
    loadMapRoutes(selectedMap as number);
  }, [selectedMap, loadMapRoutes]);

  // ── 장소 드래그 ──
  const [draggingPlace, setDraggingPlace] = useState<{ key: string; name: string } | null>(null);
  const [dragWorldPos, setDragWorldPos] = useState<{ x: number; y: number } | null>(null);
  const [movedPlaces, setMovedPlaces] = useState<Map<string, { x: number; y: number }>>(new Map());
  const dragStartMouse = useRef<{ x: number; y: number } | null>(null);
  const dragPending = useRef<{ key: string; name: string; wx: number; wy: number; mx: number; my: number } | null>(null);
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 모든 장소(DB+pending) name→좌표 맵 (드래그 오버라이드 포함)
  const placeCoordMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const p of mapPlaces) {
      if (!deletedDbIds.has(p.id)) {
        const moved = movedPlaces.get(p.LacationName);
        map.set(p.LacationName, moved ?? { x: p.LocationX, y: p.LocationY });
      }
    }
    for (const p of pendingPlaces) {
      const moved = movedPlaces.get(p.LacationName);
      map.set(p.LacationName, moved ?? { x: p.LocationX, y: p.LocationY });
    }
    // 드래그 중인 장소는 실시간 좌표로 덮어쓰기
    if (draggingPlace && dragWorldPos) {
      map.set(draggingPlace.name, { x: dragWorldPos.x, y: dragWorldPos.y });
    }
    return map;
  }, [mapPlaces, pendingPlaces, deletedDbIds, movedPlaces, draggingPlace, dragWorldPos]);

  // ── ESC 키로 모드 취소 ──
  useEffect(() => {
    if (!isPlaceMode && !isDeleteMode && !isRouteMode && !isPathBuildMode && !isDangerMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsPlaceMode(false);
        setIsDeleteMode(false);
        setIsRouteMode(false);
        setRouteStartName(null);
        setRouteEndName(null);
        setIsPathBuildMode(false);
        setPathBuildOrder([]);
        setPathBuildWaits([]);
        resetDangerMode();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPlaceMode, isDeleteMode, isRouteMode, isPathBuildMode, isDangerMode, resetDangerMode]);

  // ── SVG 맵 뷰 상태 ──
  const [processedImg, setProcessedImg] = useState<{ url: string; w: number; h: number; mask?: Uint8Array } | null>(null);

  const { zoom, setZoom, rotation, setRotation, offset, setOffset, svgRef } =
    useSvgPanZoom(processedImg !== null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  /** 맵을 SVG 컨테이너 중앙에 맞춤 (로드 시 & 초기화 버튼) */
  const centerMapView = useCallback((img?: { w: number; h: number }) => {
    const target = img ?? processedImg;
    if (!target) return;
    const svgEl = svgRef.current;
    if (!svgEl || svgEl.getBoundingClientRect().width === 0) return;
    const rect = svgEl.getBoundingClientRect();
    const scaleX = rect.width / target.w;
    const scaleY = rect.height / target.h;
    const fitZoom = Math.min(scaleX, scaleY) * 0.75;
    setZoom(fitZoom);
    setRotation(0);
    setOffset({ x: rect.width / 2, y: rect.height / 2 });
  }, [processedImg, svgRef, setZoom, setRotation, setOffset]);

  // ── 저장 모달 폼 ──
  const [saveBizId, setSaveBizId] = useState<number | "">("");
  const [saveFloorId, setSaveFloorId] = useState<number | "">("");
  const [saveMapName, setSaveMapName] = useState("");

  // ── 맵핑 시작 모달 폼 ──
  const [startBizId, setStartBizId] = useState<number | "">("");
  const [startBizNew, setStartBizNew] = useState("");
  const [startBizMode, setStartBizMode] = useState<"select" | "new">("select");
  const [startFloorId, setStartFloorId] = useState<number | "">("");
  const [startFloorNew, setStartFloorNew] = useState("");
  const [startFloorMode, setStartFloorMode] = useState<"select" | "new">("select");
  const [startFloors, setStartFloors] = useState<FloorItem[]>([]);
  const [startMapName, setStartMapName] = useState("");
  const [startMapNameChecked, setStartMapNameChecked] = useState<boolean | null>(null); // null=미확인, true=사용가능, false=중복
  const [isMappingRunning, setIsMappingRunning] = useState(false); // 맵핑 진행 중 여부
  const [isMappingStarting, setIsMappingStarting] = useState(false); // 맵핑 시작 준비 중
  const [isMappingEnding, setIsMappingEnding] = useState(false); // 맵핑 종료(맵 생성) 중

  // ── 맵핑 실시간 시각화 (훅으로 분리) ──
  const { mappingCanvasRef } = useMappingWebSocket(mappingState);

  // ── 사업장 목록 로드 ──
  const loadBusinesses = useCallback(async () => {
    try {
      const res = await apiFetch(`/map/businesses`);
      const data = await res.json();
      setBusinesses(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("사업장 로드 실패:", e);
    }
  }, []);

  // ── 층 목록 로드 ──
  const loadFloors = useCallback(async (bizId: number) => {
    try {
      const res = await apiFetch(`/map/floors?business_id=${bizId}`);
      const data = await res.json();
      setFloors(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("층 로드 실패:", e);
    }
  }, []);

  // ── 영역(맵) 목록 로드 ──
  const loadMaps = useCallback(async (floorId: number) => {
    try {
      const res = await apiFetch(`/map/maps?floor_id=${floorId}`);
      const data = await res.json();
      setMaps(data);
    } catch (e) {
      console.error("영역 로드 실패:", e);
    }
  }, []);

  // ── 첫 번째 맵 자동 탐색 (초기 진입 / 탭 재진입 시 호출) ──
  const loadFirstMap = useCallback(async () => {
    try {
      const bizRes = await apiFetch(`/map/businesses`);
      const bizRaw = await bizRes.json();
      const bizList: Business[] = Array.isArray(bizRaw) ? bizRaw : [];
      setBusinesses(bizList);
      if (bizList.length === 0) return;

      for (const biz of bizList) {
        const floorRes = await apiFetch(`/map/floors?business_id=${biz.id}`);
        const floorRaw = await floorRes.json();
        const floorList: FloorItem[] = Array.isArray(floorRaw) ? floorRaw : [];

        for (const fl of floorList) {
          const mapRes = await apiFetch(`/map/maps?floor_id=${fl.id}`);
          const mapRaw = await mapRes.json();
          const mapList: RobotMap[] = Array.isArray(mapRaw) ? mapRaw : [];

          if (mapList.length > 0) {
            setSelectedBiz(biz.id);
            setFloors(floorList);
            setSelectedFloor(fl.id);
            setMaps(mapList);
            setSelectedMap(mapList[0].id);
            return;
          }
        }

        if (floorList.length > 0) {
          setSelectedBiz(biz.id);
          setFloors(floorList);
          setSelectedFloor(floorList[0].id);
        }
      }
    } catch (e) {
      console.error("초기 맵 로드 실패:", e);
    } finally {
      readyFlags.current.maps = true;
      checkReady();
    }
  }, []);

  // ── 초기 진입 시 호출 ──
  useEffect(() => {
    loadFirstMap();
  }, [loadFirstMap]);

  // ── 맵 편집 탭 재진입 시 필터 초기화 후 재로드 ──
  const prevTabRef = useRef<MapTab>(activeTab);
  useEffect(() => {
    const wasNotMap = prevTabRef.current !== "map";
    prevTabRef.current = activeTab;
    if (wasNotMap && activeTab === "map") {
      setSelectedBiz("");
      setSelectedFloor("");
      setSelectedMap("");
      setFloors([]);
      setMaps([]);
      loadFirstMap();
    }
  }, [activeTab, loadFirstMap]);

  useEffect(() => {
    if (saveBizId !== "") {
      loadFloors(saveBizId as number);
    }
  }, [saveBizId, loadFloors]);


  // ── 맵 이미지 로드 & 회색 제거 ──
  useEffect(() => {
    if (selectedMap === "") {
      setProcessedImg(null);
      return;
    }
    const mapData = maps.find((m) => m.id === selectedMap);
    if (!mapData) return;

    const imgUrl = `${API_BASE}/${(mapData.ImgFilePath || mapData.PgmFilePath).replace("./", "")}`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const processed = processMapImage(img);
      setProcessedImg(processed);

      // SVG가 렌더된 후 중앙 배치 (마운트 대기)
      const waitAndCenter = () => {
        const svgEl = svgRef.current;
        if (svgEl && svgEl.getBoundingClientRect().width > 0) {
          centerMapView(processed);
        } else {
          requestAnimationFrame(waitAndCenter);
        }
      };
      requestAnimationFrame(waitAndCenter);
    };
    img.src = imgUrl;
  }, [selectedMap, maps]);

  // ── SVG 드래그 팬 ──
  const panDragged = useRef(false);
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsPanning(true);
    panDragged.current = false;
    panStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    // 드래그 대기 중 → 5px 이상 이동하면 드래그 시작
    if (dragPending.current && !draggingPlace) {
      const dp = dragPending.current;
      const dist = Math.sqrt((e.clientX - dp.mx) ** 2 + (e.clientY - dp.my) ** 2);
      if (dist >= 5) {
        dragStartMouse.current = { x: dp.mx, y: dp.my };
        setDraggingPlace({ key: dp.key, name: dp.name });
        setDragWorldPos({ x: dp.wx, y: dp.wy });
        dragPending.current = null;
      }
      return;
    }
    // 장소 드래그 처리
    if (draggingPlace) {
      const coords = svgEventToWorld(e);
      if (coords) setDragWorldPos({ x: coords.worldX, y: coords.worldY });
      return;
    }
    // 위험구역 그리기 중 — 커서까지 미리보기 선
    if (isDangerMode && danger.isDrawing && danger.points.length > 0) {
      const coords = svgEventToWorld(e);
      setDangerCursor(coords ? { x: coords.worldX, y: coords.worldY } : null);
    }
    if (!isPanning) return;
    // 5px 이상 이동해야 팬으로 인정 (클릭과 구분)
    const dx = e.clientX - (panStart.current.x + offset.x);
    const dy = e.clientY - (panStart.current.y + offset.y);
    if (!panDragged.current && Math.sqrt(dx * dx + dy * dy) < 5) return;
    panDragged.current = true;
    setOffset({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  };
  const handleMouseUp = () => {
    // 드래그 대기 중이었으면 클리어 (클릭으로 끝남)
    dragPending.current = null;

    if (draggingPlace && dragWorldPos) {
      const start = dragStartMouse.current;
      const dist = start ? Math.sqrt(
        (dragWorldPos.x - (movedPlaces.get(draggingPlace.name)?.x ?? 0)) ** 2 +
        (dragWorldPos.y - (movedPlaces.get(draggingPlace.name)?.y ?? 0)) ** 2
      ) : 999;
      dragStartMouse.current = null;

      // 실제 이동이 있었으면 위치 확정 + Yaw 자동 재계산
      if (dist > 0.001) {
        const placeName = draggingPlace.name;
        // DB 장소면 수정 추적
        if (draggingPlace.key.startsWith("db_")) {
          setModifiedDbIds((prev) => new Set(prev).add(Number(draggingPlace.key.replace("db_", ""))));
        }
        setMovedPlaces((prev) => {
          const next = new Map(prev);
          next.set(placeName, { x: dragWorldPos.x, y: dragWorldPos.y });
          return next;
        });

        // 경로 연결된 장소 → 다음 장소를 향하는 Yaw 자동 계산
        autoRecalcYaw(placeName, { x: dragWorldPos.x, y: dragWorldPos.y });
      }

      setDraggingPlace(null);
      setDragWorldPos(null);
      return;
    }
    setIsPanning(false);
  };

  // ── 경로 연결된 장소의 Yaw 자동 재계산 ──
  const autoRecalcYaw = (placeName: string, newCoord: { x: number; y: number }) => {
    // 이 장소에서 출발하는 forward/bidirectional 경로 찾기
    const allRoutes = [
      ...dbRoutes.filter((r) => !deletedRouteDbIds.has(r.id)).map((r) => ({ start: r.StartPlaceName, end: r.EndPlaceName, dir: r.Direction })),
      ...pendingRoutes.map((r) => ({ start: r.startName, end: r.endName, dir: r.direction })),
    ];

    // 출발 경로: forward/bidirectional에서 start가 이 장소
    let targetName: string | null = null;
    for (const r of allRoutes) {
      if (r.start === placeName && (r.dir === "forward" || r.dir === "bidirectional")) {
        targetName = r.end;
        break;
      }
      if (r.end === placeName && (r.dir === "reverse" || r.dir === "bidirectional")) {
        targetName = r.start;
        break;
      }
    }

    if (!targetName) return;
    const targetCoord = placeCoordMap.get(targetName);
    if (!targetCoord) return;

    const dx = targetCoord.x - newCoord.x;
    const dy = targetCoord.y - newCoord.y;
    const newYaw = Math.atan2(dy, dx); // 라디안

    // DB 장소 Yaw 업데이트
    const dbPlace = mapPlaces.find((p) => p.LacationName === placeName);
    if (dbPlace) {
      setMapPlaces((prev) => prev.map((p) =>
        p.LacationName === placeName ? { ...p, Yaw: Number(newYaw.toFixed(4)) } : p
      ));
    }
    // pending 장소 Yaw 업데이트
    setPendingPlaces((prev) => prev.map((p) =>
      p.LacationName === placeName ? { ...p, Yaw: Number(newYaw.toFixed(4)) } : p
    ));
  };

  // ── SVG → 월드 좌표 변환 유틸 ──
  const svgEventToWorld = (e: React.MouseEvent) => {
    if (!processedImg || !mapMeta) return null;
    const svgEl = svgRef.current;
    if (!svgEl) return null;

    const rect = svgEl.getBoundingClientRect();
    const tx = (e.clientX - rect.left) - offset.x;
    const ty = (e.clientY - rect.top) - offset.y;
    const sx = tx / zoom;
    const sy = ty / zoom;
    const rad = (-rotation * Math.PI) / 180;
    const rx = sx * Math.cos(rad) - sy * Math.sin(rad);
    const ry = sx * Math.sin(rad) + sy * Math.cos(rad);
    const imgPx = rx + processedImg.w / 2;
    const imgPy = ry + processedImg.h / 2;
    if (imgPx < 0 || imgPx > processedImg.w || imgPy < 0 || imgPy > processedImg.h) return null;
    // 맵 바깥(투명) 영역 체크
    if (processedImg.mask) {
      const px = Math.floor(imgPx);
      const py = Math.floor(imgPy);
      if (px >= 0 && px < processedImg.w && py >= 0 && py < processedImg.h) {
        if (processedImg.mask[py * processedImg.w + px] === 0) return null;
      }
    }
    const worldX = imgPx * mapMeta.resolution + mapMeta.originX;
    const worldY = (processedImg.h - imgPy) * mapMeta.resolution + mapMeta.originY;
    return { worldX, worldY, pixelX: imgPx, pixelY: imgPy };
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // 드래그 후 클릭 무시 (5px 이상 이동했으면 팬으로 간주)
    if (panDragged.current) {
      panDragged.current = false;
      return;
    }

    // 위험구역 그리기 모드: 클릭으로 폴리곤 꼭짓점 추가
    if (isDangerMode) {
      const coords = svgEventToWorld(e);
      if (!coords) { modalAlert("맵 범위를 벗어난 위치입니다."); return; }
      danger.addPoint({ x: coords.worldX, y: coords.worldY });
      return;
    }

    // 장소 생성 모드 (최우선)
    if (isPlaceMode) {
      const coords = svgEventToWorld(e);
      if (!coords) { modalAlert("맵 범위를 벗어난 위치입니다."); return; }
      setPlaceClickCoords(coords);
      setShowPlaceModal(true);
      setIsPlaceMode(false);
      return;
    }

    // 구간 모드: 빈 공간 클릭 → 시작점 선택된 상태에서만 새 장소 생성
    if (isRouteMode && routeStartName) {
      const coords = svgEventToWorld(e);
      if (!coords) { modalAlert("맵 범위를 벗어난 위치입니다."); return; }
      setPlaceClickCoords(coords);
      setShowPlaceModal(true);
      return;
    }
  };

  // ── 위험구역 그리기 완료 → 이름 입력 모달 ──
  const handleDangerFinish = () => {
    if (!danger.canFinish) {
      modalAlert("위험구역은 최소 3개의 점이 필요하며, 변이 서로 겹치지 않아야 합니다.");
      return;
    }
    const pts = [...danger.points];
    setDangerCursor(null);
    setDangerSave({ points: pts, centroid: polygonCentroid(pts) });
  };

  // ── 위험구역 이름 확정 → pending 장소(Category=danger)로 추가 (저장 시 일괄 POST /places) ──
  const handleDangerConfirm = (name: string) => {
    if (!dangerSave) return;
    const floorId = typeof selectedFloor === "number" ? selectedFloor : null;
    const mapId = typeof selectedMap === "number" ? selectedMap : null;
    const v = validateDangerZone({ name, points: dangerSave.points, floorId });
    if (!v.valid) {
      modalAlert(v.errors.join("\n"));
      return;
    }
    const polygon = dangerSave.points.map((p) => [
      Number(p.x.toFixed(3)),
      Number(p.y.toFixed(3)),
    ]);
    const place: PendingPlace = {
      tempId: `pending_danger_${Date.now()}`,
      RobotName: connectedRobots[0]?.RobotName ?? "",
      LacationName: name,
      FloorId: floorId,
      LocationX: Number(dangerSave.centroid.x.toFixed(3)),
      LocationY: Number(dangerSave.centroid.y.toFixed(3)),
      Yaw: 0,
      MapId: mapId,
      Category: "danger",
      Imformation: null,
      Polygon: polygon,
    };
    setPendingPlaces((prev) => [...prev, place]);
    setUndoStack((prev) => [...prev, { type: "addPlace", tempId: place.tempId }]);
    setDangerSave(null);
    resetDangerMode();
  };

  // ── 장소등록 모달에서 "위험구역" 선택 → 점 등록 취소하고 폴리곤 그리기로 전환 ──
  //    (모달이 열릴 때 클릭한 좌표를 폴리곤 1번 꼭짓점으로 시드)
  const handleStartDangerFromPlace = () => {
    const seed = placeClickCoords
      ? { x: placeClickCoords.worldX, y: placeClickCoords.worldY }
      : null;
    // 장소 모달 닫기
    setShowPlaceModal(false);
    setPlaceClickCoords(null);
    setIsFromRobotPos(false);
    setIsChargeCreate(false);
    setChargeDockingPlace(null);
    // 다른 모드 해제 후 위험구역 그리기 진입
    setIsPlaceMode(false);
    setIsDeleteMode(false);
    setIsRouteMode(false);
    setRouteStartName(null);
    setRouteEndName(null);
    setIsDangerMode(true);
    danger.start();
    if (seed) danger.addPoint(seed);
  };

  // ── 상단 사업장 선택 ──
  const handleBizChange = (bizId: number) => {
    setSelectedBiz(bizId);
    setSelectedFloor("");
    setSelectedMap("");
    setMaps([]);
    // 사업장(→층) 변경 시 연결된 로봇 상태 전체 초기화
    setConnectedRobots([]);
    setSelectedConnectIds([]);
    loadFloors(bizId);
  };

  // ── 상단 층 선택 ──
  const handleFloorChange = async (floorId: number) => {
    setSelectedFloor(floorId);
    setSelectedMap("");
    // 층 변경 시 이전 층에서 연결한 로봇 상태 전체 초기화
    // (connectedRobots=[] → useRobotPolling이 robotPos/마커/폴링을 자동 정리)
    setConnectedRobots([]);
    setSelectedConnectIds([]);
    try {
      const res = await apiFetch(`/map/maps?floor_id=${floorId}`);
      const data = await res.json();
      const list: RobotMap[] = Array.isArray(data) ? data : [];
      setMaps(list);
      if (list.length > 0) {
        const latest = list.reduce((a, b) => (b.id > a.id ? b : a));
        setSelectedMap(latest.id);
      }
    } catch (e) {
      console.error("영역 로드 실패:", e);
    }
  };

  // ── 맵핑 시작 모달 열기 ──
  const handleMappingStart = () => {
    clearAllModes();
    if (connectedRobots.length === 0) {
      modalAlert("로봇이 연결되어 있지 않습니다. 먼저 로봇을 연결해주세요.");
      return;
    }
    setStartBizId("");
    setStartBizNew("");
    setStartBizMode("select");
    setStartFloorId("");
    setStartFloorNew("");
    setStartFloorMode("select");
    setStartFloors([]);
    setStartMapName("");
    setStartMapNameChecked(null);
    setMappingState("startModal");
  };

  const handlePathBuildStart = () => {
    if (!processedImg || !mapMeta) { modalAlert("맵을 먼저 선택해주세요."); return; }
    clearAllModes();
    setIsPathBuildMode(true);
    setPathBuildName("");
    setRightPanelOpen(false);
  };

  const handleMapReset = () => {
    clearAllModes();
    if (!processedImg || !mapMeta) {
      modalAlert("맵을 먼저 선택해주세요.");
      return;
    }
    modalConfirm("맵 위의 모든 장소와 구간을 초기화하시겠습니까?\n저장 버튼을 눌러야 DB에 반영됩니다.", () => {
      setUndoStack((prev) => [...prev, {
        type: "mapReset" as const,
        prevPendingPlaces: [...pendingPlaces],
        prevPendingRoutes: [...pendingRoutes],
        prevDeletedDbIds: new Set(deletedDbIds),
        prevDeletedRouteDbIds: new Set(deletedRouteDbIds),
        prevMovedPlaces: new Map(movedPlaces),
        prevModifiedDbIds: new Set(modifiedDbIds),
      }]);
      setPendingPlaces([]);
      setPendingRoutes([]);
      setDeletedDbIds(new Set(mapPlaces.map((p) => p.id)));
      setDeletedRouteDbIds(new Set(dbRoutes.map((r) => r.id)));
      setMovedPlaces(new Map());
      setModifiedDbIds(new Set());
    });
  };

  // ── 시작 모달: 사업장 선택 시 층 로드 ──
  const handleStartBizChange = async (bizId: number) => {
    setStartBizId(bizId);
    setStartFloorId("");
    setStartFloorMode("select");
    try {
      const res = await apiFetch(`/map/floors?business_id=${bizId}`);
      const data = await res.json();
      setStartFloors(data);
    } catch (e) {
      setStartFloors([]);
    }
  };

  // ── 영역 이름 중복 체크 ──
  const handleCheckMapName = async () => {
    if (!startMapName.trim()) return;
    try {
      const res = await apiFetch(`/map/maps`);
      const data: RobotMap[] = await res.json();
      const exists = data.some((m) => m.MapName === startMapName.trim());
      setStartMapNameChecked(!exists);
    } catch (e) {
      console.error("중복 체크 실패:", e);
    }
  };

  // ── 맵핑 실제 시작 ──
  const handleConfirmMappingStart = async () => {
    if (startMapNameChecked !== true) {
      modalAlert("영역 이름 중복 체크를 해주세요.");
      return;
    }

    // 새 사업장 생성
    let bizId = startBizId as number;
    if (startBizMode === "new" && startBizNew.trim()) {
      try {
        const res = await apiFetch(`/map/businesses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ BusinessName: startBizNew.trim() }),
        });
        const biz = await res.json();
        bizId = biz.id;
        loadBusinesses();
      } catch (e) {
        modalAlert("사업장 생성 실패");
        return;
      }
    }

    // 새 층 생성
    let floorId = startFloorId as number;
    if (startFloorMode === "new" && startFloorNew.trim() && bizId) {
      try {
        const res = await apiFetch(`/map/floors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ BusinessId: bizId, FloorName: startFloorNew.trim() }),
        });
        const newFloor = await res.json();
        floorId = newFloor.id;
      } catch (e) {
        modalAlert("층 생성 실패");
        return;
      }
    }

    // 맵핑 시작 정보 임시 저장 (종료 시 사용)
    setSaveBizId(bizId);
    setSaveFloorId(floorId);
    setSaveMapName(startMapName.trim());
    setIsMappingRunning(false);
    setMappingState("mappingModal");
  };

  // ── 맵핑 시작 ──
  const handleMappingRun = async () => {
    if (isMappingStarting) return;
    setIsMappingStarting(true);
    try {
      const res = await apiFetch(`/map/mapping/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessId: saveBizId,
          FloorId: saveFloorId,
          MapName: saveMapName,
        }),
      });
      if (!res.ok) throw new Error("시작 실패");
      setIsMappingRunning(true);
    } catch (e) {
      console.error("맵핑 시작 실패:", e);
      modalAlert("맵핑 시작 실패");
    } finally {
      setIsMappingStarting(false);
    }
  };

  // ── 맵핑 종료 → SSH 파일 가져오기 → DB 저장 → 성공 팝업 ──
  // 종료 작업은 맵 디렉토리 대기(~60s) + zip(~120s) + SFTP + 변환 + DB 기록으로
  // 기본 30초 타임아웃을 쉽게 초과한다. 타임아웃으로 abort되면 백엔드는 계속 저장 중인데
  // 프론트는 실패로 오인해 경고창을 띄웠다(ERR-01). → 타임아웃을 충분히 늘려 실제 응답을
  // 끝까지 기다리고, "타임아웃 abort"와 "진짜 백엔드 실패 응답"을 구분해 경고를 노출한다.
  const handleMappingEnd = async () => {
    if (isMappingEnding) return;
    setIsMappingEnding(true);
    try {
      const res = await apiFetch(`/map/mapping/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 300_000, // 종료 작업은 길게 걸리므로 실제 응답을 끝까지 대기
        body: JSON.stringify({
          BusinessId: saveBizId,
          FloorId: saveFloorId,
          MapName: saveMapName,
        }),
      });
      if (res.ok) {
        setMappingState("success");
      } else {
        // 백엔드가 실제 실패 응답(4xx/5xx)을 준 경우에만 경고
        const err = await res.json().catch(() => null);
        modalAlert(err?.detail || "맵 저장 실패");
      }
    } catch (e) {
      // 타임아웃(TimeoutError/AbortError)은 실패로 단정하지 않는다.
      // 백엔드는 저장을 계속 진행 중일 수 있으므로 안내만 하고, 맵 목록에서 확인하도록 한다.
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        console.warn("맵핑 종료 응답 지연(타임아웃) — 백엔드 저장은 진행 중일 수 있음:", e);
        modalAlert(
          "맵 저장이 지연되고 있습니다. 잠시 후 맵 목록에서 생성 여부를 확인해주세요."
        );
      } else {
        // 진짜 네트워크 오류만 오류로 경고
        console.error("맵핑 종료 네트워크 오류:", e);
        modalAlert("네트워크 오류로 맵핑 종료 요청에 실패했습니다.");
      }
    } finally {
      setIsMappingEnding(false);
    }
  };

  // ── 성공 팝업 확인 → 새 맵 자동 선택 ──
  const handleSuccessConfirm = async () => {
    setMappingState("idle");

    // 사업장 목록 갱신
    await loadBusinesses();

    // 층 목록 갱신 & 선택
    const bizId = saveBizId as number;
    const floorId = saveFloorId as number;
    setSelectedBiz(bizId);
    await loadFloors(bizId);
    setSelectedFloor(floorId);

    // 영역(맵) 목록 갱신 & 새 맵 자동 선택
    const mapRes = await apiFetch(`/map/maps?floor_id=${floorId}`);
    const mapList: RobotMap[] = await mapRes.json();
    setMaps(mapList);

    const newMap = mapList.find((m) => m.MapName === saveMapName);
    if (newMap) {
      setSelectedMap(newMap.id);
    }
  };

  // ── 맵 저장 ──
  const handleSaveMap = async () => {
    if (saveBizId === "" || saveFloorId === "" || !saveMapName.trim()) {
      modalAlert("모든 항목을 입력해주세요.");
      return;
    }

    try {
      const res = await apiFetch(`/map/maps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessId: saveBizId,
          FloorId: saveFloorId,
          MapName: saveMapName.trim(),
        }),
      });

      if (res.ok) {
        modalAlert(
          "맵이 저장되었습니다.\n로봇을 해당 층으로 이동시켜 이 맵을 활성 맵으로 지정한 뒤, 충전소를 등록해 주세요. 충전소를 등록해야 전원 재기동 시 충전소 기준으로 위치가 자동 초기화됩니다."
        );
        setMappingState("idle");
      } else {
        modalAlert("저장 실패");
      }
    } catch (e) {
      console.error("맵 저장 실패:", e);
      modalAlert("저장 중 오류 발생");
    }
  };

  // ── 로봇 위치 폴링 + 현재 층 갱신 (훅으로 분리) ──
  // 통신이 끊긴(Offline) 로봇은 폴링이 연결 목록에서 자동 해제한다 → 운영자에게 안내.
  const handleCommsLost = useCallback(
    (robotNames: string[]) => {
      modalAlert(
        `다음 로봇과의 통신이 끊겨 연결이 해제되었습니다:\n${robotNames.join(", ")}`
      );
    },
    [modalAlert]
  );
  useRobotPolling(connectedRobots, setConnectedRobots, setRobotPos, handleCommsLost);

  // ── 매핑 중 새로고침/탭 닫기 안전장치 ──
  // 매핑은 "시작"하면 로봇 NOS 의 active 맵이 새(미완결) 맵으로 바뀐다.
  // 종료(/end) 없이 새로고침·탭닫기로 이탈하면 active 가 미완결 맵에 고착되므로,
  // 페이지 unload 직전에 /map/mapping/cancel 을 sendBeacon 으로 호출해
  // 백엔드가 이전 정상 맵으로 active 를 복원(초기화)하도록 한다.
  // (쿠키 인증이라 sendBeacon 이 access_token 쿠키를 함께 전송 → 인증 통과)
  useEffect(() => {
    if (!isMappingRunning) return;
    const cancelOnUnload = () => {
      try {
        navigator.sendBeacon(`${API_BASE}/map/mapping/cancel`);
      } catch {
        /* best-effort */
      }
    };
    window.addEventListener("beforeunload", cancelOnUnload);
    return () => window.removeEventListener("beforeunload", cancelOnUnload);
  }, [isMappingRunning]);

  // ── 저장 취소 ──
  const handleCancelSave = () => {
    setMappingState("idle");
  };

  // ── 로봇 연결 모달 ──
  // 온라인 로봇 목록 로드 (모달 오픈 / 새로고침 공용)
  // offline 로봇은 연결될 수 없으므로 목록에서 제외한다.
  const loadRobotList = async () => {
    setRobotListLoading(true);
    try {
      const [robotsRes, statusRes] = await Promise.all([
        apiFetch(`/DB/robots`),
        apiFetch(`/robot/status`),
      ]);
      const allRobots: Robot[] = await robotsRes.json();
      const statuses: { robot_id: number; network: string }[] = await statusRes.json();
      const onlineIds = new Set(
        statuses.filter((s) => s.network === "Online").map((s) => s.robot_id)
      );
      let list = allRobots.filter((r) => onlineIds.has(r.id)); // 오프라인 제외
      // 현재 선택된 맵을 사용 중인 로봇만 필터링
      if (selectedMap !== "") {
        list = list.filter((r) => r.CurrentMapId === selectedMap);
      }
      setRobots(list);
    } catch (e) {
      console.error("로봇 목록 로드 실패:", e);
      setRobots([]);
    } finally {
      setRobotListLoading(false);
    }
  };

  const handleOpenRobotModal = async () => {
    clearAllModes();
    await loadRobotList();
    // 체크박스 선택은 연결 상태와 분리된 "일괄 선택" 용도이므로 빈 상태로 시작
    setSelectedConnectIds([]);
    setShowRobotModal(true);
  };

  // 모달 내 "새로고침" — 열려 있는 동안 offline된 로봇을 실시간 반영
  const handleRefreshRobotList = () => loadRobotList();

  // ── 동기화 모달 열기 ──
  const handleOpenImportModal = async () => {
    clearAllModes();
    if (selectedBiz === "") {
      modalAlert("사업장을 먼저 선택해주세요.");
      return;
    }
    try {
      // 온라인 상태(network === "Online")인 실제 로봇만 가져오기 대상으로 노출.
      // (test123(127.0.0.1)·IP 미설정 등 더미/오프라인 로봇은 NOS 맵을 가질 수 없음)
      const [robotsRes, statusRes] = await Promise.all([
        apiFetch(`/DB/robots`),
        apiFetch(`/robot/status`),
      ]);
      const allRobots: Robot[] = await robotsRes.json();
      const statuses: { robot_name: string; network: string }[] = await statusRes.json();
      const onlineNames = new Set(
        statuses.filter((s) => s.network === "Online").map((s) => s.robot_name)
      );
      setImportRobots(allRobots.filter((r) => onlineNames.has(r.RobotName)));
    } catch (e) {
      console.error("로봇 목록 로드 실패:", e);
      setImportRobots([]);
    }
    setShowImportModal(true);
  };

  const handleOpenInitPoseModal = () => {
    clearAllModes();
    if (connectedRobots.length === 0) {
      modalAlert("위치 재조정할 로봇을 먼저 연결해주세요.");
      return;
    }
    if (connectedRobots.length === 1) {
      setSelectedInitPoseRobot(connectedRobots[0]);
      setShowInitPoseManualModal(true);
      return;
    }
    setShowInitPoseTargetModal(true);
  };

  const handleSelectInitPoseRobot = (robot: Robot) => {
    setSelectedInitPoseRobot(robot);
    setShowInitPoseTargetModal(false);
    setShowInitPoseManualModal(true);
  };

  const handleInitPoseResolved = async () => {
    setShowInitPoseManualModal(false);
    try {
      const target = selectedInitPoseRobot?.id
        ? `/robot/position?robot_id=${selectedInitPoseRobot.id}`
        : "/robot/position";
      const res = await apiFetch(target);
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.x === "number" && typeof data?.y === "number") {
          setRobotPos({ x: data.x, y: data.y, yaw: Number(data.yaw ?? 0) });
        }
      }
    } catch (e) {
      console.warn("위치 재조정 후 로봇 위치 재조회 실패:", e);
    }
    modalAlert("로봇 위치를 갱신했습니다.");
  };

  const handleImported = async ({ map_id, floor_id, map_name }: { map_id: number; floor_id: number; map_name: string }) => {
    setShowImportModal(false);
    modalAlert(`"${map_name}" 맵을 가져왔습니다.`);
    // 가져온 맵이 현재 보고 있는 층이면 목록 새로고침 + 선택
    if (floor_id === selectedFloor) {
      await loadMaps(floor_id);
      setSelectedMap(map_id);
    }
  };

  const handleOpenSyncModal = async () => {
    clearAllModes();
    if (selectedMap === "") {
      modalAlert("동기화할 맵을 먼저 선택해주세요.");
      return;
    }
    try {
      const res = await apiFetch(`/DB/robots`);
      const data = await res.json();
      setSyncRobots(data);
    } catch (e) {
      console.error("로봇 목록 로드 실패:", e);
    }
    setSelectedSyncIds([]);
    setShowSyncModal(true);
  };

  const handleSyncConfirm = async () => {
    const mapData = maps.find((m) => m.id === selectedMap);
    if (!mapData) return;
    const selected = syncRobots.filter((r) => selectedSyncIds.includes(r.id));
    if (selected.length === 0) { modalAlert("동기화할 로봇을 선택해주세요."); return; }

    const names = selected.map((r) => r.RobotName).join(", ");
    modalConfirm(`로봇 [${names}]에 맵 '${mapData.MapName}'을(를) 동기화하시겠습니까?`, async () => {
      setShowSyncModal(false);

      const initial: RobotSyncState[] = selected.map((robot) => ({
        robot,
        status: "waiting",
        step: 0,
        msg: "",
        retryCount: 0,
      }));
      setSyncProgressStates(initial);
      setShowSyncProgressModal(true);

      const updateRobot = (robotId: number, patch: Partial<RobotSyncState>) => {
        setSyncProgressStates((prev) =>
          prev.map((s) => (s.robot.id === robotId ? { ...s, ...patch } : s))
        );
      };

      const results: string[] = [];
      for (const robot of selected) {
        updateRobot(robot.id, { status: "in-progress", step: 1, msg: "맵 파일 전송 중", retryCount: 0 });

        try {
          const res = await fetch(`${API_BASE}/map/maps/sync`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify({ map_id: mapData.id, robot_id: robot.id }),
          });

          if (!res.ok || !res.body) {
            let detail = `HTTP ${res.status}`;
            try {
              const err = await res.json();
              detail = err.detail || detail;
            } catch {}
            updateRobot(robot.id, { status: "failed", errorMsg: detail });
            results.push(`${robot.RobotName} — 동기화 실패 (${detail})`);
            continue;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder("utf-8");
          let buffer = "";
          let finalMsg = "";
          let finalStatus: "ok" | "error" | null = null;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let nlIdx = buffer.indexOf("\n");
            while (nlIdx >= 0) {
              const line = buffer.slice(0, nlIdx).trim();
              buffer = buffer.slice(nlIdx + 1);
              if (line) {
                try {
                  const evt = JSON.parse(line);
                  if (evt.event === "retry") {
                    updateRobot(robot.id, {
                      retryCount: (evt.attempt ?? 1) - 1,
                      step: 1,
                      msg: "맵 파일 전송 중",
                    });
                  } else if (evt.event === "step") {
                    updateRobot(robot.id, { step: evt.step, msg: evt.msg });
                  } else if (evt.event === "done") {
                    finalStatus = evt.status;
                    finalMsg = evt.msg || "";
                  }
                } catch (e) {
                  console.warn("[sync] 이벤트 파싱 실패:", line, e);
                }
              }
              nlIdx = buffer.indexOf("\n");
            }
          }

          if (finalStatus === "ok") {
            updateRobot(robot.id, { status: "success" });
            results.push(`${robot.RobotName} — 동기화 완료`);
          } else {
            const reason = finalMsg || "알 수 없는 오류";
            updateRobot(robot.id, { status: "failed", errorMsg: reason });
            results.push(`${robot.RobotName} — 동기화 실패 (${reason})`);
          }
        } catch (e: any) {
          updateRobot(robot.id, { status: "failed", errorMsg: e.message });
          results.push(`${robot.RobotName} — 동기화 실패 (${e.message})`);
        }
      }

      setShowSyncProgressModal(false);
      modalAlert(results.join("\n"));
    });
  };

  const [connectChecking, setConnectChecking] = useState(false);

  // 대상 로봇들을 /robot/status 기준 online/offline으로 분류 (연결·해제 공용)
  const partitionByOnline = async (targets: Robot[]) => {
    const res = await apiFetch(`/robot/status`);
    if (!res.ok) throw new Error();
    const statuses: { robot_id: number; network: string }[] = await res.json();
    const online: Robot[] = [];
    const offline: string[] = [];
    for (const r of targets) {
      const st = statuses.find((s) => s.robot_id === r.id);
      if (st && st.network === "Online") online.push(r);
      else offline.push(r.RobotName);
    }
    return { online, offline };
  };

  // 연결은 가산(merge): 이미 연결된 로봇은 제외하고 online인 로봇만 추가한다.
  const connectRobots = async (targets: Robot[]) => {
    const fresh = targets.filter((t) => !connectedRobots.some((c) => c.id === t.id));
    if (fresh.length === 0) return;
    setConnectChecking(true);
    try {
      const { online, offline } = await partitionByOnline(fresh);
      if (offline.length > 0) {
        modalAlert(`다음 로봇이 응답하지 않습니다:\n${offline.join(", ")}\n\n온라인 상태의 로봇만 연결됩니다.`);
      }
      if (online.length === 0) {
        modalAlert("연결 가능한 로봇이 없습니다.");
        return;
      }
      setConnectedRobots((prev) => {
        const has = new Set(prev.map((r) => r.id));
        return [...prev, ...online.filter((r) => !has.has(r.id))];
      });
    } catch {
      modalAlert("로봇 상태 확인에 실패했습니다.");
    } finally {
      setConnectChecking(false);
    }
  };

  // 연결해제도 연결과 동일하게 online 상태에서만 가능하다.
  // offline 로봇은 해제하지 않고 안내만 한다.
  const disconnectRobots = async (targets: Robot[]) => {
    if (targets.length === 0) return;
    setConnectChecking(true);
    try {
      const { online, offline } = await partitionByOnline(targets);
      if (offline.length > 0) {
        modalAlert(`다음 로봇이 응답하지 않아 해제할 수 없습니다:\n${offline.join(", ")}\n\n온라인 상태의 로봇만 해제됩니다.`);
      }
      if (online.length === 0) return; // 해제 가능한 로봇 없음
      const removeIds = new Set(online.map((r) => r.id));
      setConnectedRobots((prev) => prev.filter((r) => !removeIds.has(r.id)));
    } catch {
      modalAlert("로봇 상태 확인에 실패했습니다.");
    } finally {
      setConnectChecking(false);
    }
  };

  // 모달이 넘기는 id 배열을 Robot으로 매핑해 실행 (카드/선택/전체 공용 진입점)
  const handleConnectIds = (ids: number[]) =>
    connectRobots(robots.filter((r) => ids.includes(r.id)));
  const handleDisconnectIds = (ids: number[]) =>
    disconnectRobots(connectedRobots.filter((r) => ids.includes(r.id)));

  // ── 맵 삭제 ──
  const handleDeleteMap = async () => {
    clearAllModes();
    if (selectedMap === "") {
      modalAlert("삭제할 맵을 먼저 선택해주세요.");
      return;
    }
    const mapName = maps.find((m) => m.id === selectedMap)?.MapName ?? "선택된 맵";
    modalConfirm(`"${mapName}" 맵을 삭제하시겠습니까?\n맵에 포함된 장소, 구간, 관련 경로가 모두 삭제됩니다.`, async () => {
      try {
        const res = await apiFetch(`/map/maps/${selectedMap}`, { method: "DELETE" });
        if (!res.ok) throw new Error("맵 삭제 실패");
        modalAlert("맵이 삭제되었습니다.");
        setPendingPlaces([]);
        setPendingRoutes([]);
        setDeletedDbIds(new Set());
        setDeletedRouteDbIds(new Set());
        setMovedPlaces(new Map());
        setModifiedDbIds(new Set());
        setUndoStack([]);
        if (selectedFloor !== "") {
          const fl = floors.find((a) => a.id === selectedFloor);
          if (fl) {
            const mapsRes = await apiFetch(`/map/maps?floor_id=${fl.id}`);
            if (mapsRes.ok) {
              const updatedMaps = await mapsRes.json();
              setMaps(updatedMaps);
              if (updatedMaps.length > 0) {
                setSelectedMap(updatedMaps[0].id);
              } else {
                setSelectedMap("");
                setMapPlaces([]);
                setDbRoutes([]);
                setProcessedImg(null);
              }
            }
          }
        } else {
          setSelectedMap("");
          setMapPlaces([]);
          setDbRoutes([]);
          setProcessedImg(null);
        }
      } catch (e) {
        modalAlert(e instanceof Error ? e.message : "삭제 중 오류 발생");
      }
    });
  };

  return (
    <PermissionGuard requiredPermissions={["map-edit", "place-list", "path-list"]}>
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 페이지 헤더 + 탭 */}
      <div className="page-header-tab">
        <h1>맵 관리</h1>
        <div className={styles.mapTab}>
          {mapTabs.map((tab) => (
            <div
              key={tab.id}
              className={activeTab === tab.id ? styles.mapTabActive : ""}
              onClick={() => {
                if (tab.id !== activeTab) {
                  clearAllModes();
                  setRightPanelOpen(true);
                }
                setActiveTab(tab.id);
              }}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      {activeTab === "place" && mapTabs.some((t) => t.id === "place") && <PlaceList robots={tabRobots} floors={tabFloors} hideActions />}
      {activeTab === "path" && mapTabs.some((t) => t.id === "path") && <PathList robots={tabRobots} floors={tabFloors} hideActions />}

      {activeTab === "map" && mapTabs.some((t) => t.id === "map") && <div className={styles.container}>
        {/* ── 상단 툴바 ── */}
        <MapToolbar
          businesses={businesses}
          floors={floors}
          maps={maps}
          selectedBiz={selectedBiz}
          selectedFloor={selectedFloor}
          selectedMap={selectedMap}
          connectedRobots={connectedRobots}
          onBizChange={handleBizChange}
          onFloorChange={handleFloorChange}
          onMapChange={setSelectedMap}
          onClearModes={clearAllModes}
          onSaveAll={handleSaveAll}
          onOpenSyncModal={handleOpenSyncModal}
          onOpenImportModal={handleOpenImportModal}
          onDeleteMap={handleDeleteMap}
          onOpenRobotModal={handleOpenRobotModal}
          onOpenInitPoseModal={handleOpenInitPoseModal}
        />

        {/* ── 메인 영역 ── */}
        <div className={styles.mainArea}>
          {/* 맵 캔버스 (전체 배경) */}
          <div className={styles.mapCanvas}>
            {processedImg ? (
              <svg
                ref={svgRef}
                className={styles.mapSvg}
                style={draggingPlace ? { cursor: "grabbing" } : (isPlaceMode || isDangerMode) ? { cursor: "crosshair" } : (isDeleteMode || isRouteMode || isPathBuildMode) ? { cursor: "pointer" } : undefined}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleSvgClick}
              >
                <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom}) rotate(${rotation})`}>
                  <image
                    href={processedImg.url}
                    x={-processedImg.w / 2}
                    y={-processedImg.h / 2}
                    width={processedImg.w}
                    height={processedImg.h}
                  />
                  {/* 격자 오버레이 (1m 간격) */}
                  {showGrid && mapMeta && (() => {
                    const cellPx = 1 / mapMeta.resolution; // 1미터 = N 픽셀
                    const x0 = -processedImg.w / 2;
                    const y0 = -processedImg.h / 2;
                    const lines: React.ReactNode[] = [];
                    for (let x = 0; x <= processedImg.w; x += cellPx) {
                      lines.push(<line key={`gv${x}`} x1={x0 + x} y1={y0} x2={x0 + x} y2={y0 + processedImg.h} stroke="rgba(0,255,180,0.15)" strokeWidth={0.5} />);
                    }
                    for (let y = 0; y <= processedImg.h; y += cellPx) {
                      lines.push(<line key={`gh${y}`} x1={x0} y1={y0 + y} x2={x0 + processedImg.w} y2={y0 + y} stroke="rgba(0,255,180,0.15)" strokeWidth={0.5} />);
                    }
                    return <g pointerEvents="none">{lines}</g>;
                  })()}
                  {/* 위험구역(폴리곤) 레이어 비활성화 (요청에 의해 OFF — 에러 상황 방지)
                  {mapMeta && (() => {
                    const meta: SvgMetaLike = {
                      originX: mapMeta.originX,
                      originY: mapMeta.originY,
                      resolution: mapMeta.resolution,
                      imgWidth: processedImg.w,
                      imgHeight: processedImg.h,
                    };
                    const toZone = (
                      id: string,
                      name: string,
                      poly: number[][] | null | undefined
                    ): DangerZone | null => {
                      if (!poly || poly.length < 3) return null;
                      return {
                        id,
                        name,
                        floorId: typeof selectedFloor === "number" ? selectedFloor : null,
                        points: poly.map(([x, y]) => ({ x, y })),
                        status: "active",
                      };
                    };
                    const zones: DangerZone[] = [
                      ...mapPlaces
                        .filter((p) => p.Category === "danger" && !deletedDbIds.has(p.id))
                        .map((p) => toZone(`db_${p.id}`, p.LacationName, p.Polygon)),
                      ...pendingPlaces
                        .filter((p) => p.Category === "danger")
                        .map((p) => toZone(p.tempId, p.LacationName, p.Polygon)),
                    ].filter((z): z is DangerZone => z !== null);

                    return (
                      <DangerZoneLayer
                        zones={zones}
                        meta={meta}
                        zoom={zoom}
                        draftPoints={isDangerMode ? danger.points : []}
                        cursorWorld={isDangerMode ? dangerCursor : null}
                      />
                    );
                  })()}
                  */}
                  {/* 경로 라인 표시 (DB + pending) */}
                  {mapMeta && (() => {
                    const allRoutes = [
                      ...dbRoutes
                        .filter((r) => !deletedRouteDbIds.has(r.id))
                        .map((r) => ({ key: `rdb_${r.id}`, dbId: r.id, tempId: null as string | null, start: r.StartPlaceName, end: r.EndPlaceName, dir: r.Direction, pending: false })),
                      ...pendingRoutes.map((r) => ({ key: r.tempId, dbId: null as number | null, tempId: r.tempId, start: r.startName, end: r.endName, dir: r.direction, pending: true })),
                    ];
                    return allRoutes.map((route) => {
                      const startCoord = placeCoordMap.get(route.start);
                      const endCoord = placeCoordMap.get(route.end);
                      if (!startCoord || !endCoord) return null;

                      const x1 = (startCoord.x - mapMeta.originX) / mapMeta.resolution - processedImg.w / 2;
                      const y1 = processedImg.h - (startCoord.y - mapMeta.originY) / mapMeta.resolution - processedImg.h / 2;
                      const x2 = (endCoord.x - mapMeta.originX) / mapMeta.resolution - processedImg.w / 2;
                      const y2 = processedImg.h - (endCoord.y - mapMeta.originY) / mapMeta.resolution - processedImg.h / 2;

                      const dx = x2 - x1;
                      const dy = y2 - y1;
                      const len = Math.sqrt(dx * dx + dy * dy);
                      if (len < 1) return null;
                      const ux = dx / len;
                      const uy = dy / len;
                      // 시작/끝을 마커에서 살짝 띄움
                      const margin = 12 / zoom;
                      const sx = x1 + ux * margin;
                      const sy = y1 + uy * margin;
                      const ex = x2 - ux * margin;
                      const ey = y2 - uy * margin;

                      const color = route.pending ? "#FFD700" : "#4CAF50";
                      const arrowSize = 6 / zoom;

                      // 화살촉 계산
                      const fwdArrow = `M${ex},${ey} L${ex - ux * arrowSize + uy * arrowSize * 0.5},${ey - uy * arrowSize - ux * arrowSize * 0.5} L${ex - ux * arrowSize - uy * arrowSize * 0.5},${ey - uy * arrowSize + ux * arrowSize * 0.5} Z`;
                      const revArrow = `M${sx},${sy} L${sx + ux * arrowSize - uy * arrowSize * 0.5},${sy + uy * arrowSize + ux * arrowSize * 0.5} L${sx + ux * arrowSize + uy * arrowSize * 0.5},${sy + uy * arrowSize - ux * arrowSize * 0.5} Z`;

                      return (
                        <g key={route.key}>
                          {/* 클릭 영역 (투명 두꺼운 선) */}
                          {isDeleteMode && (
                            <line
                              x1={sx} y1={sy} x2={ex} y2={ey}
                              stroke="transparent" strokeWidth={12 / zoom}
                              style={{ cursor: "pointer" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmTarget({
                                  type: route.dbId != null ? "route_db" : "route_pending",
                                  id: route.dbId ?? route.tempId!,
                                  name: `${route.start} → ${route.end}`,
                                });
                              }}
                            />
                          )}
                          <line
                            x1={sx} y1={sy} x2={ex} y2={ey}
                            stroke={color} strokeWidth={2 / zoom}
                            strokeDasharray={route.pending ? `${4 / zoom} ${3 / zoom}` : "none"}
                            opacity={0.9}
                            pointerEvents="none"
                          />
                          {/* 정방향 / 양방향: 끝 화살촉 */}
                          {(route.dir === "forward" || route.dir === "bidirectional") && (
                            <path d={fwdArrow} fill={color} pointerEvents="none" />
                          )}
                          {/* 역방향 / 양방향: 시작 화살촉 */}
                          {(route.dir === "reverse" || route.dir === "bidirectional") && (
                            <path d={revArrow} fill={color} pointerEvents="none" />
                          )}
                        </g>
                      );
                    });
                  })()}

                  {/* 경로 빌드 라인 시각화 */}
                  {isPathBuildMode && mapMeta && pathBuildOrder.length >= 2 && (() => {
                    const segments: React.ReactNode[] = [];
                    for (let i = 0; i < pathBuildOrder.length - 1; i++) {
                      const startCoord = placeCoordMap.get(pathBuildOrder[i]);
                      const endCoord = placeCoordMap.get(pathBuildOrder[i + 1]);
                      if (!startCoord || !endCoord) continue;
                      const x1 = (startCoord.x - mapMeta.originX) / mapMeta.resolution - processedImg.w / 2;
                      const y1 = processedImg.h - (startCoord.y - mapMeta.originY) / mapMeta.resolution - processedImg.h / 2;
                      const x2 = (endCoord.x - mapMeta.originX) / mapMeta.resolution - processedImg.w / 2;
                      const y2 = processedImg.h - (endCoord.y - mapMeta.originY) / mapMeta.resolution - processedImg.h / 2;
                      const mx = (x1 + x2) / 2;
                      const my = (y1 + y2) / 2;
                      segments.push(
                        <g key={`pathbuild_${i}`}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2}
                            stroke="#FF6B35" strokeWidth={3 / zoom} opacity={0.85} pointerEvents="none" />
                          <g transform={`translate(${mx}, ${my}) scale(${1 / zoom})`}>
                            <circle r="9" fill="#FF6B35" />
                            <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="10" fontWeight="700">
                              {i + 1}
                            </text>
                          </g>
                        </g>
                      );
                    }
                    return segments;
                  })()}

                  {/* 저장된 장소 + 미저장 장소 마커 표시 (위험구역은 DangerZoneLayer 가 폴리곤으로 그림) */}
                  {mapMeta && [
                    ...mapPlaces
                      .filter((p) => !deletedDbIds.has(p.id) && p.Category !== "danger")
                      .map((p) => ({ key: `db_${p.id}`, dbId: p.id, tempId: null as string | null, name: p.LacationName, x: p.LocationX, y: p.LocationY, pending: false })),
                    ...pendingPlaces
                      .filter((p) => p.Category !== "danger")
                      .map((p) => ({ key: p.tempId, dbId: null as number | null, tempId: p.tempId, name: p.LacationName, x: p.LocationX, y: p.LocationY, pending: true })),
                  ].map((place) => {
                    // 드래그 중이면 드래그 좌표, 아니면 movedPlaces 또는 원본
                    const isDragging = draggingPlace?.name === place.name && dragWorldPos;
                    const moved = movedPlaces.get(place.name);
                    const wx = isDragging ? dragWorldPos!.x : moved ? moved.x : place.x;
                    const wy = isDragging ? dragWorldPos!.y : moved ? moved.y : place.y;
                    const px = (wx - mapMeta.originX) / mapMeta.resolution;
                    const py = processedImg.h - (wy - mapMeta.originY) / mapMeta.resolution;
                    const svgX = px - processedImg.w / 2;
                    const svgY = py - processedImg.h / 2;
                    return (
                      <g
                        key={place.key}
                        transform={`translate(${svgX}, ${svgY})`}
                        style={{ cursor: (isDeleteMode || isRouteMode || isPathBuildMode) ? "pointer" : draggingPlace?.name === place.name ? "grabbing" : "grab" }}
                        onMouseDown={(!isDeleteMode && !isRouteMode && !isPlaceMode && !isPathBuildMode) ? (e) => {
                          e.stopPropagation();
                          dragPending.current = { key: place.key, name: place.name, wx, wy, mx: e.clientX, my: e.clientY };
                          if (dragTimer.current) clearTimeout(dragTimer.current);
                          dragTimer.current = null;
                        } : undefined}
                        onDoubleClick={(!isDeleteMode && !isRouteMode && !isPlaceMode && !isPathBuildMode) ? (e) => {
                          e.stopPropagation();
                          // 드래그 취소
                          dragPending.current = null;
                          if (draggingPlace) {
                            setDraggingPlace(null);
                            setDragWorldPos(null);
                          }
                          const dbP = place.dbId != null ? mapPlaces.find((p) => p.id === place.dbId) : null;
                          const pendP = place.tempId ? pendingPlaces.find((p) => p.tempId === place.tempId) : null;
                          const yaw = dbP?.Yaw ?? pendP?.Yaw ?? 0;
                          const desc = dbP?.Imformation ?? pendP?.Imformation ?? "";
                          setEditingPlace({ key: place.key, name: place.name, svgX, svgY, x: wx, y: wy, yaw, desc });
                          setEditValues({
                            name: place.name,
                            x: wx.toFixed(3),
                            y: wy.toFixed(3),
                            dir: String(Math.round(yaw * 180 / Math.PI)),
                            desc: desc,
                          });
                        } : undefined}
                        onClick={(isDeleteMode || isRouteMode || isPathBuildMode) ? (e) => {
                          e.stopPropagation();
                          if (isPathBuildMode) {
                            // 경로 빌드: 장소 추가
                            if (pathBuildOrder.length === 0 || (pathReachable && pathReachable.has(place.name)) || !pathReachable) {
                              const last = pathBuildOrder[pathBuildOrder.length - 1];
                              if (last === place.name) return; // 연속 동일 장소 방지
                              setPathBuildOrder((prev) => [...prev, place.name]);
                              setPathBuildWaits((prev) => [...prev, 0]);
                            }
                            return;
                          }
                          if (isDeleteMode) {
                            setDeleteConfirmTarget({
                              type: place.dbId != null ? "db" : "pending",
                              id: place.dbId ?? place.tempId!,
                              name: place.name,
                            });
                          } else if (isRouteMode) {
                            if (!routeStartName) {
                              setRouteStartName(place.name);
                            } else if (!routeEndName && place.name !== routeStartName) {
                              setRouteEndName(place.name);
                            }
                          }
                        } : undefined}
                      >
                        <g transform={`scale(${1 / zoom})`}>
                          {/* 구간 모드 시작점 하이라이트 */}
                          {isRouteMode && routeStartName === place.name && (
                            <circle r="14" fill="none" stroke="#4CAF50" strokeWidth="2.5" strokeDasharray="4 2" />
                          )}
                          {/* 구간 모드 끝점 하이라이트 */}
                          {isRouteMode && routeEndName === place.name && (
                            <circle r="14" fill="none" stroke="#FF9800" strokeWidth="2.5" strokeDasharray="4 2" />
                          )}
                          {/* 경로 빌드: 갈 수 있는 장소 하이라이트 */}
                          {isPathBuildMode && pathReachable && pathReachable.has(place.name) && (
                            <circle r="14" fill="none" stroke="#FF6B35" strokeWidth="2" strokeDasharray="4 2" opacity={0.8} />
                          )}
                          {/* 경로 빌드: 현재 마지막 선택 장소 */}
                          {isPathBuildMode && pathBuildOrder.length > 0 && pathBuildOrder[pathBuildOrder.length - 1] === place.name && (
                            <circle r="14" fill="none" stroke="#FF6B35" strokeWidth="2.5" />
                          )}
                          {/* 드래그 중 하이라이트 */}
                          {draggingPlace?.name === place.name && (
                            <circle r="16" fill="rgba(0,176,238,0.15)" stroke="#00B0EE" strokeWidth="2" />
                          )}
                          {(() => {
                            const isModified = place.pending || (place.dbId != null && modifiedDbIds.has(place.dbId)) || movedPlaces.has(place.name);
                            const isUnreachable = isPathBuildMode && pathBuildOrder.length > 0 && pathReachable && !pathReachable.has(place.name) && pathBuildOrder[pathBuildOrder.length - 1] !== place.name;
                            return (<>
                          <image
                            href="/icon/place_point.png"
                            x={-10}
                            y={-20}
                            width={20}
                            height={20}
                            opacity={isUnreachable ? 0.25 : isModified ? 0.7 : 1}
                          />
                          <text
                            y={-26}
                            textAnchor="middle"
                            fill={isModified ? "#FFD700" : "#fff"}
                            fontSize="11"
                            fontWeight="600"
                            paintOrder="stroke"
                            stroke="rgba(0,0,0,0.7)"
                            strokeWidth="3"
                          >
                            {place.name}
                          </text>
                          </>); })()}
                        </g>
                      </g>
                    );
                  })}

                  {/* 로봇 위치 표시 (RobotMarker 스타일) — 현재 층과 같을 때만 */}
                  {robotPos && mapMeta && connectedRobots.some((r) => r.CurrentFloorId === selectedFloor) && (() => {
                    const px = (robotPos.x - mapMeta.originX) / mapMeta.resolution;
                    const py = processedImg.h - (robotPos.y - mapMeta.originY) / mapMeta.resolution;
                    const svgX = px - processedImg.w / 2;
                    const svgY = py - processedImg.h / 2;
                    return (
                      <g transform={`translate(${svgX}, ${svgY})`}>
                        {/* 화살표 촉이 로봇 전방(yaw)을 향하도록: Y미러 보정(-yaw). +180° 보정은 ERR-05 오진 과보정이라 원복 */}
                        <g transform={`rotate(${-(robotPos.yaw * 180) / Math.PI})`}>
                          <g transform={`scale(${1 / zoom})`}>
                            <polygon
                              points="-10,-8 10,0 -10,8 -6,0"
                              fill="#E53E3E"
                              stroke="#C53030"
                              strokeWidth="1"
                            />
                          </g>
                        </g>
                      </g>
                    );
                  })()}

                </g>
              </svg>
            ) : selectedMap === "" ? (
              <div className={styles.mapPlaceholderEmpty}>
                <span>등록된 지도가 없습니다</span>
              </div>
            ) : (
              <div className={styles.mapPlaceholderLoading}>
                <div className={styles.mapPlaceholderSpinner} />
                <span>지도를 불러오는 중...</span>
              </div>
            )}

          {/* 장소 생성/삭제 모드 배너 */}
          {isPlaceMode && (
            <div className={styles.placeBanner}>
              지도를 클릭하여 장소 좌표를 선택하세요
            </div>
          )}

          {showInitPoseTargetModal && (
            <div className={styles.startOverlay} onClick={() => setShowInitPoseTargetModal(false)}>
              <div className={styles.robotModal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.startHeader}>
                  <div className={styles.startHeaderLeft}>
                    <img src="/icon/robot_w.png" alt="" />
                    <h2>위치 재조정 로봇 선택</h2>
                  </div>
                  <button
                    className={styles.startCloseBtn}
                    onClick={() => setShowInitPoseTargetModal(false)}
                  >
                    &times;
                  </button>
                </div>

                <div className={styles.robotBody}>
                  <div className={styles.robotActionBar}>
                    <div className={styles.robotActionBarInfo}>
                      <span className={styles.robotConnectedDot} />
                      <span className={styles.robotConnCount}>
                        {connectedRobots.length}대 연결
                      </span>
                      <span
                        className={styles.robotConnNames}
                        title={connectedRobots.map((r) => r.RobotName).join(", ")}
                      >
                        재조정할 로봇 1대를 선택하세요
                      </span>
                    </div>
                  </div>

                  <div className={styles.startSection}>
                    <div className={styles.startSectionTitle}>
                      <span>연결된 로봇</span>
                      <div className={styles.startSectionLine} />
                    </div>

                    <div className={styles.robotList}>
                      {connectedRobots.map((robot) => (
                        <button
                          key={robot.id}
                          type="button"
                          className={styles.robotItem}
                          onClick={() => handleSelectInitPoseRobot(robot)}
                        >
                          <div className={styles.robotItemLeft}>
                            <img
                              src="/icon/robot_icon(1).png"
                              alt=""
                              className={styles.robotItemIcon}
                            />
                            <div>
                              <div className={styles.robotItemName}>
                                {robot.RobotName}
                                <span className={styles.robotConnectedInline}>
                                  <span className={styles.robotConnectedDot} />
                                  연결됨
                                </span>
                              </div>
                              <div className={styles.robotItemInfo}>
                                {robot.ModelName && <span>{robot.ModelName}</span>}
                                {robot.SerialNumber && <span>SN: {robot.SerialNumber}</span>}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={styles.startFooter}>
                  <button
                    className={styles.startFooterBtn + " " + styles.startBtnCancel}
                    onClick={() => setShowInitPoseTargetModal(false)}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          )}

          <InitPoseConfirmModal
            open={showInitPoseManualModal}
            robotId={selectedInitPoseRobot?.id}
            robotName={selectedInitPoseRobot?.RobotName}
            detectedAt={new Date().toISOString()}
            onResolved={handleInitPoseResolved}
            onClose={() => setShowInitPoseManualModal(false)}
            zIndex={10000}
          />
          {isDeleteMode && (
            <div className={styles.placeBanner} style={{ background: "rgba(183, 28, 28, 0.8)" }}>
              삭제할 장소 또는 구간을 클릭하세요
            </div>
          )}
          {isPathBuildMode && (
            <div className={styles.placeBanner} style={{ background: "rgba(255, 107, 53, 0.85)" }}>
              {pathBuildOrder.length === 0
                ? "시작 장소를 클릭하세요"
                : `${pathBuildOrder[pathBuildOrder.length - 1]}에서 다음 장소를 클릭하세요`}
            </div>
          )}
          {isRouteMode && (
            <>
              <div className={styles.placeBanner} style={{ background: "rgba(56, 142, 60, 0.85)" }}>
                {!routeStartName
                  ? "시작 장소를 클릭하세요"
                  : !routeEndName
                    ? `"${routeStartName}"에서 연결할 장소를 클릭하세요`
                    : `${routeStartName} → ${routeEndName}`}
              </div>
              {/* 방향 선택기 + 확인 버튼 */}
              {routeStartName && (
                <div
                  style={{
                    position: "absolute", top: 50, left: "50%", transform: "translateX(-50%)",
                    zIndex: 21, display: "flex", gap: 4, alignItems: "center",
                    background: "var(--surface-3)", borderRadius: 8, padding: "4px 6px",
                    border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {([
                    { value: "forward" as RouteDirection, label: "정방향 →" },
                    { value: "reverse" as RouteDirection, label: "역방향 ←" },
                    { value: "bidirectional" as RouteDirection, label: "양방향 ↔" },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={(e) => { e.stopPropagation(); setRouteDirection(opt.value); }}
                      style={{
                        padding: "5px 12px", borderRadius: 6, border: "1px solid",
                        borderColor: routeDirection === opt.value ? "var(--color-info-border)" : "transparent",
                        background: routeDirection === opt.value ? "var(--color-info-bg)" : "transparent",
                        color: "var(--text-primary)", fontSize: "var(--font-size-sm)",
                        cursor: "pointer", fontWeight: routeDirection === opt.value ? 600 : 400,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {/* 확인 버튼 — 시작+끝점 모두 선택됐을 때 */}
                  {routeEndName && (
                    <>
                      <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const routeTempId = `route_${Date.now()}`;
                          setPendingRoutes((prev) => [...prev, {
                            tempId: routeTempId,
                            startName: routeStartName,
                            endName: routeEndName,
                            direction: routeDirection,
                          }]);
                          setUndoStack((prev) => [...prev, { type: "addRoute", tempId: routeTempId }]);
                          // 구간 생성 완료 → 모드 종료
                          setIsRouteMode(false);
                          setRouteStartName(null);
                          setRouteEndName(null);
                        }}
                        style={{
                          padding: "5px 16px", borderRadius: 6,
                          border: "1px solid var(--color-info-border)",
                          background: "var(--color-info-bg)",
                          color: "var(--text-primary)", fontSize: "var(--font-size-sm)",
                          cursor: "pointer", fontWeight: 600,
                        }}
                      >
                        확인
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {isDangerMode && (
            <>
              <div className={styles.placeBanner} style={{ background: "rgba(232, 120, 0, 0.9)" }}>
                {danger.points.length === 0
                  ? "지도를 클릭하여 위험구역 꼭짓점을 찍으세요 (3개 이상)"
                  : `꼭짓점 ${danger.points.length}개 — ${danger.canFinish ? "완료를 눌러 저장하세요" : "최소 3개 이상 찍으세요"}`}
              </div>
              <div
                style={{
                  position: "absolute", top: 50, left: "50%", transform: "translateX(-50%)",
                  zIndex: 21, display: "flex", gap: 4, alignItems: "center",
                  background: "var(--surface-3)", borderRadius: 8, padding: "4px 6px",
                  border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); danger.undo(); setDangerCursor(null); }}
                  disabled={danger.points.length === 0}
                  style={{
                    padding: "5px 12px", borderRadius: 6, border: "1px solid transparent",
                    background: "transparent", color: "var(--text-primary)",
                    fontSize: "var(--font-size-sm)",
                    cursor: danger.points.length === 0 ? "default" : "pointer",
                    opacity: danger.points.length === 0 ? 0.4 : 1,
                  }}
                >
                  되돌리기
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); resetDangerMode(); }}
                  style={{
                    padding: "5px 12px", borderRadius: 6, border: "1px solid transparent",
                    background: "transparent", color: "var(--text-primary)",
                    fontSize: "var(--font-size-sm)", cursor: "pointer",
                  }}
                >
                  취소
                </button>
                <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />
                <button
                  onClick={(e) => { e.stopPropagation(); handleDangerFinish(); }}
                  disabled={!danger.canFinish}
                  style={{
                    padding: "5px 16px", borderRadius: 6,
                    border: "1px solid var(--color-info-border)",
                    background: danger.canFinish ? "var(--color-info-bg)" : "transparent",
                    color: "var(--text-primary)", fontSize: "var(--font-size-sm)",
                    cursor: danger.canFinish ? "pointer" : "default",
                    fontWeight: 600, opacity: danger.canFinish ? 1 : 0.4,
                  }}
                >
                  완료
                </button>
              </div>
            </>
          )}
          </div>

          {/* 격자 버튼 (좌측 상단 모서리) */}
          <button
            className={styles.gridBtn}
            onClick={() => setShowGrid((v) => !v)}
            style={showGrid ? { background: "var(--surface-5)", color: "var(--color-info)" } : undefined}
            title={showGrid ? "격자 숨기기" : "격자 표시"}
          >
            <span>&#9638;</span>
          </button>

          {/* 상단 가로 도구바 (오버레이) */}
          <div className={styles.topTools}>
            <button
              className={styles.topToolBtn}
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              style={undoStack.length === 0 ? { opacity: 0.4, cursor: "default" } : undefined}
            >
              <span className={styles.topToolIcon}>&#8634;</span>
              <span>되돌리기</span>
            </button>
            <button
              className={styles.topToolBtn}
              onClick={() => {
                clearAllModes();
                if (!processedImg || !mapMeta) {
                  modalAlert("맵을 먼저 선택해주세요.");
                  return;
                }
                if (!robotPos) {
                  modalAlert("로봇 위치 정보를 가져올 수 없습니다.");
                  return;
                }
                // 도킹 포인트 → 충전소 간 거리 (0.866m)
                const CHARGE_OFFSET = 0.866;
                // 로봇 전방 = robotPos.yaw (ERR-05 +π 보정은 과보정 오진이라 원복)
                const yaw = robotPos.yaw;
                // 충전소 좌표: 로봇이 바라보는 방향 앞 0.866m
                const chargeX = robotPos.x + CHARGE_OFFSET * Math.cos(yaw);
                const chargeY = robotPos.y + CHARGE_OFFSET * Math.sin(yaw);
                const chargePx = (chargeX - mapMeta.originX) / mapMeta.resolution;
                const chargePy = processedImg.h - (chargeY - mapMeta.originY) / mapMeta.resolution;

                // 도킹 포인트 기본 정보 저장 (이름은 confirm 시 결정)
                const dockingPlace: PendingPlace = {
                  tempId: `pending_dock_${Date.now()}`,
                  RobotName: connectedRobots[0]?.RobotName ?? "",
                  LacationName: "", // confirm 시 충전소 이름 기반으로 결정
                  FloorId: selectedFloor !== "" ? (selectedFloor as number) : null,
                  LocationX: Number(robotPos.x.toFixed(3)),
                  LocationY: Number(robotPos.y.toFixed(3)),
                  Yaw: Number(robotPos.yaw.toFixed(4)),
                  MapId: selectedMap !== "" ? (selectedMap as number) : null,
                  Category: "waypoint",
                  Imformation: "",
                };
                setChargeDockingPlace(dockingPlace);

                // 충전소 좌표로 모달 열기
                setPlaceClickCoords({
                  worldX: Number(chargeX.toFixed(3)),
                  worldY: Number(chargeY.toFixed(3)),
                  pixelX: chargePx,
                  pixelY: chargePy,
                });
                setIsFromRobotPos(true);
                setIsChargeCreate(true);
                setShowPlaceModal(true);
              }}
            >
              <span className={styles.topToolIcon}>&#9733;</span>
              <span>충전소 생성</span>
            </button>
            <button
              className={styles.topToolBtn}
              onClick={() => {
                clearAllModes();
                if (!processedImg || !mapMeta) {
                  modalAlert("맵을 먼저 선택해주세요.");
                  return;
                }
                if (!robotPos) {
                  modalAlert("로봇 위치 정보를 가져올 수 없습니다.");
                  return;
                }
                const px = (robotPos.x - mapMeta.originX) / mapMeta.resolution;
                const py = processedImg.h - (robotPos.y - mapMeta.originY) / mapMeta.resolution;
                setPlaceClickCoords({
                  worldX: robotPos.x,
                  worldY: robotPos.y,
                  pixelX: px,
                  pixelY: py,
                });
                setIsFromRobotPos(true);
                setShowPlaceModal(true);
              }}
            >
              <span className={styles.topToolIcon}>&#9673;</span>
              <span>현 위치에서 장소 생성</span>
            </button>
          </div>

          {/* 좌측 세로 도구 (오버레이) */}
          <div className={styles.leftTools}>
            <button
              className={`${styles.toolBtn} ${isRouteMode ? styles.toolBtnActive : ""}`}
              onClick={() => {
                if (!processedImg || !mapMeta) {
                  modalAlert("맵을 먼저 선택해주세요.");
                  return;
                }
                setIsRouteMode((v) => !v);
                setIsPlaceMode(false);
                setIsDeleteMode(false);
                setRouteStartName(null);
                setRouteEndName(null);
                resetDangerMode();
              }}
            >
              <img src="/icon/path_way.png" alt="구간" className={styles.toolBtnImg} />
              <span>구간</span>
            </button>
            <button
              className={`${styles.toolBtn} ${isPlaceMode ? styles.toolBtnActive : ""}`}
              onClick={() => {
                if (!processedImg || !mapMeta) {
                  modalAlert("맵을 먼저 선택해주세요.");
                  return;
                }
                setIsPlaceMode((v) => !v);
                setIsDeleteMode(false);
                setIsRouteMode(false);
                setRouteStartName(null);
                setRouteEndName(null);
                resetDangerMode();
              }}
            >
              <img src="/icon/place_point.png" alt="장소" className={styles.toolBtnImg} />
              <span>장소</span>
            </button>
            <button
              className={`${styles.toolBtn} ${isDeleteMode ? styles.toolBtnActive : ""}`}
              onClick={() => {
                if (!processedImg || !mapMeta) {
                  modalAlert("맵을 먼저 선택해주세요.");
                  return;
                }
                setIsDeleteMode((v) => !v);
                setIsPlaceMode(false);
                setIsRouteMode(false);
                setRouteStartName(null);
                setRouteEndName(null);
                resetDangerMode();
              }}
            >
              <span className={styles.toolBtnIcon}>&#10005;</span>
              <span>삭제</span>
            </button>
            {/* 위험구역 버튼 — 2차 개발 예정, 현재 미표시(숨김)
            <button
              type="button"
              className={styles.toolBtn}
              disabled
              title="2차 개발 예정"
              style={{ opacity: 0.4, cursor: "not-allowed" }}
            >
              <span className={styles.toolBtnIcon} style={{ color: "#e87800" }}>&#9650;</span>
              <span>위험구역</span>
            </button>
            */}
          </div>

          {/* 좌측 하단 줌/회전 컨트롤 (오버레이) */}
          <div className={styles.zoomControls}>
            <button className={styles.zoomBtn} onClick={() => setZoom((z) => Math.min(10, z * 1.2))}>
              <span>+</span><span className={styles.zoomLabel}>확대</span>
            </button>
            <button className={styles.zoomBtn} onClick={() => setZoom((z) => Math.max(0.1, z * 0.8))}>
              <span>-</span><span className={styles.zoomLabel}>축소</span>
            </button>
            <button className={styles.zoomBtn} onClick={() => setRotation((r) => r + 90)}>
              <span>&#8635;</span><span className={styles.zoomLabel}>회전</span>
            </button>
            <button className={styles.zoomBtn} onClick={() => setRotation((r) => r - 90)}>
              <span>&#8634;</span><span className={styles.zoomLabel}>반회전</span>
            </button>
            <button className={`${styles.zoomBtn} ${styles.zoomBtnReset}`} onClick={() => centerMapView()}>
              <span>&#9673;</span><span className={styles.zoomLabel}>초기화</span>
            </button>
          </div>

          {/* 오른쪽 패널 (오버레이) */}
          <MapRightPanel
            open={rightPanelOpen}
            onToggle={() => setRightPanelOpen((v) => !v)}
            onPathBuildStart={handlePathBuildStart}
            onMappingStart={handleMappingStart}
            onMapReset={handleMapReset}
            robotConnected={connectedRobots.length > 0}
          />

          <PathBuildPanel
            isOpen={isPathBuildMode}
            pathBuildName={pathBuildName}
            setPathBuildName={setPathBuildName}
            pathBuildWorkType={pathBuildWorkType}
            setPathBuildWorkType={setPathBuildWorkType}
            pathBuildOrder={pathBuildOrder}
            setPathBuildOrder={setPathBuildOrder}
            pathBuildWaits={pathBuildWaits}
            setPathBuildWaits={setPathBuildWaits}
            placeCoordMap={placeCoordMap}
            onCancel={() => {
              setIsPathBuildMode(false);
              setPathBuildOrder([]);
              setPathBuildWaits([]);
              setRightPanelOpen(true);
            }}
            onSave={handleSavePath}
          />
        </div>
      </div>}

      <MappingStartModal
        isOpen={mappingState === "startModal"}
        businesses={businesses}
        startBizId={startBizId}
        startBizNew={startBizNew}
        startBizMode={startBizMode}
        startFloorId={startFloorId}
        startFloorNew={startFloorNew}
        startFloorMode={startFloorMode}
        startFloors={startFloors}
        startMapName={startMapName}
        startMapNameChecked={startMapNameChecked}
        setStartBizNew={setStartBizNew}
        setStartBizMode={setStartBizMode}
        setStartFloorId={setStartFloorId}
        setStartFloorNew={setStartFloorNew}
        setStartFloorMode={setStartFloorMode}
        setStartMapName={setStartMapName}
        setStartMapNameChecked={setStartMapNameChecked}
        onStartBizChange={handleStartBizChange}
        onCheckMapName={handleCheckMapName}
        onConfirm={handleConfirmMappingStart}
        onCancel={() => setMappingState("idle")}
      />

      <MappingProgressModal
        isOpen={mappingState === "mappingModal"}
        isMappingRunning={isMappingRunning}
        isMappingStarting={isMappingStarting}
        isMappingEnding={isMappingEnding}
        saveMapName={saveMapName}
        mappingCanvasRef={mappingCanvasRef}
        onStart={handleMappingRun}
        onEnd={handleMappingEnd}
        onCancel={async () => {
          await apiFetch(`/map/mapping/cancel`, { method: "POST" }).catch(() => {});
          setIsMappingRunning(false);
          setMappingState("idle");
        }}
      />

      <MappingSuccessModal
        isOpen={mappingState === "success"}
        onConfirm={handleSuccessConfirm}
      />

      {/* ── 저장 모달 ── */}
      {mappingState === "saveModal" && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>맵 저장</div>

            <div className={styles.formGroup}>
              <label>사업장</label>
              <select
                value={saveBizId}
                onChange={(e) => {
                  setSaveBizId(Number(e.target.value));
                  setSaveFloorId("");
                }}
              >
                <option value="">사업장 선택</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>{b.BusinessName}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>층</label>
              <select
                value={saveFloorId}
                onChange={(e) => setSaveFloorId(Number(e.target.value))}
              >
                <option value="">층 선택</option>
                {floors.map((a) => (
                  <option key={a.id} value={a.id}>{a.FloorName}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>영역 이름</label>
              <input
                type="text"
                placeholder="영역 이름을 입력하세요"
                value={saveMapName}
                onChange={(e) => setSaveMapName(e.target.value)}
              />
            </div>

            <div className={styles.modalBtns}>
              <button className={styles.btnCancel} onClick={handleCancelSave}>
                취소
              </button>
              <button className={styles.btnConfirm} onClick={handleSaveMap}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 로봇 연결 모달 ── */}
      <RobotConnectModal
        isOpen={showRobotModal}
        robots={robots}
        connectedRobots={connectedRobots}
        selectedConnectIds={selectedConnectIds}
        setSelectedConnectIds={setSelectedConnectIds}
        selectedMap={selectedMap}
        onClose={() => setShowRobotModal(false)}
        onConnect={handleConnectIds}
        onDisconnect={handleDisconnectIds}
        onRefresh={handleRefreshRobotList}
        checking={connectChecking}
        loading={robotListLoading}
      />
      <ImportMapModal
        isOpen={showImportModal}
        robots={importRobots}
        floors={floors}
        defaultBizId={selectedBiz}
        defaultFloorId={selectedFloor}
        onClose={() => setShowImportModal(false)}
        onImported={handleImported}
      />
      <MapSyncModal
        isOpen={showSyncModal}
        syncRobots={syncRobots}
        selectedSyncIds={selectedSyncIds}
        setSelectedSyncIds={setSelectedSyncIds}
        onClose={() => setShowSyncModal(false)}
        onConfirm={handleSyncConfirm}
      />
      <MapSyncProgressModal
        isOpen={showSyncProgressModal}
        states={syncProgressStates}
      />

      {/* ── 장소 인라인 수정 팝오버 ── */}
      {editingPlace && (() => {
        const fieldStyle: React.CSSProperties = {
          width: "100%", height: 28, borderRadius: 5,
          border: "1px solid var(--border-input)", background: "var(--surface-input)",
          color: "var(--text-primary)", padding: "0 8px", fontSize: "var(--font-size-sm)", outline: "none",
        };
        const labelStyle: React.CSSProperties = {
          fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", fontWeight: 600, marginBottom: 2,
        };

        const handleEditConfirm = () => {
          const trimmed = editValues.name.trim();
          if (!trimmed) { setEditingPlace(null); return; }

          const oldName = editingPlace.name;
          const newX = Number(editValues.x);
          const newY = Number(editValues.y);
          const newYaw = Number((Number(editValues.dir) * Math.PI / 180).toFixed(4));
          const newDesc = editValues.desc.trim();
          const nameChanged = trimmed !== oldName;
          const coordChanged = Math.abs(newX - editingPlace.x) > 0.0001 || Math.abs(newY - editingPlace.y) > 0.0001;

          // 이름 변경
          if (nameChanged) {
            setMapPlaces((prev) => prev.map((p) =>
              p.LacationName === oldName ? { ...p, LacationName: trimmed } : p
            ));
            setPendingPlaces((prev) => prev.map((p) =>
              p.LacationName === oldName ? { ...p, LacationName: trimmed } : p
            ));
            setMovedPlaces((prev) => {
              const moved = prev.get(oldName);
              if (!moved) return prev;
              const next = new Map(prev);
              next.delete(oldName);
              next.set(trimmed, moved);
              return next;
            });
            setPendingRoutes((prev) => prev.map((r) => ({
              ...r,
              startName: r.startName === oldName ? trimmed : r.startName,
              endName: r.endName === oldName ? trimmed : r.endName,
            })));
            setDbRoutes((prev) => prev.map((r) => ({
              ...r,
              StartPlaceName: r.StartPlaceName === oldName ? trimmed : r.StartPlaceName,
              EndPlaceName: r.EndPlaceName === oldName ? trimmed : r.EndPlaceName,
            })));
          }

          // Yaw, 설명 업데이트
          const placeName = trimmed;
          setMapPlaces((prev) => prev.map((p) =>
            p.LacationName === placeName ? { ...p, Yaw: newYaw, Imformation: newDesc } : p
          ));
          setPendingPlaces((prev) => prev.map((p) =>
            p.LacationName === placeName ? { ...p, Yaw: newYaw, Imformation: newDesc } : p
          ));

          // 좌표 변경
          if (coordChanged || nameChanged) {
            const finalName = trimmed;
            setMovedPlaces((prev) => {
              const next = new Map(prev);
              next.set(finalName, { x: newX, y: newY });
              return next;
            });
          }

          // DB 변경 추적
          if (editingPlace.key.startsWith("db_")) {
            const dbId = Number(editingPlace.key.replace("db_", ""));
            setModifiedDbIds((prev) => new Set(prev).add(dbId));
            if (!movedPlaces.has(trimmed) && !coordChanged) {
              setMovedPlaces((prev) => {
                const next = new Map(prev);
                next.set(trimmed, { x: editingPlace.x, y: editingPlace.y });
                return next;
              });
            }
          }

          setEditingPlace(null);
        };

        // SVG 좌표 → 화면 좌표 변환
        const svgEl = svgRef.current;
        if (!svgEl) return null;
        const rect = svgEl.getBoundingClientRect();
        const rad = (rotation * Math.PI) / 180;
        const rx = editingPlace.svgX * Math.cos(rad) - editingPlace.svgY * Math.sin(rad);
        const ry = editingPlace.svgX * Math.sin(rad) + editingPlace.svgY * Math.cos(rad);
        const screenX = Math.min(Math.max(rect.left + offset.x + rx * zoom, rect.left + 140), rect.right - 140);
        const screenY = rect.top + offset.y + ry * zoom;

        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 85 }} onClick={() => setEditingPlace(null)}>
            <div
              style={{
                position: "absolute", left: screenX, top: screenY - 70,
                transform: "translateX(-50%)",
                background: "var(--surface-3)", borderRadius: 10, padding: "14px 16px",
                boxShadow: "0 6px 24px rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.1)",
                minWidth: 260, display: "flex", flexDirection: "column", gap: 8,
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") handleEditConfirm();
                if (e.key === "Escape") setEditingPlace(null);
              }}
            >
              {/* 장소명 */}
              <div>
                <div style={labelStyle}>장소명</div>
                <input autoFocus value={editValues.name} onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                  maxLength={50} style={fieldStyle} placeholder="장소명" />
              </div>
              {/* X, Y */}
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>X</div>
                  <input value={editValues.x} onChange={(e) => setEditValues((v) => ({ ...v, x: e.target.value }))}
                    type="number" step="0.001" style={fieldStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Y</div>
                  <input value={editValues.y} onChange={(e) => setEditValues((v) => ({ ...v, y: e.target.value }))}
                    type="number" step="0.001" style={fieldStyle} />
                </div>
              </div>
              {/* 각도 */}
              <div>
                <div style={labelStyle}>방향 (°)</div>
                <input value={editValues.dir} onChange={(e) => setEditValues((v) => ({ ...v, dir: e.target.value }))}
                  type="number" min={0} max={360} style={fieldStyle} placeholder="0~360" />
              </div>
              {/* 설명 */}
              <div>
                <div style={labelStyle}>설명</div>
                <textarea value={editValues.desc} onChange={(e) => setEditValues((v) => ({ ...v, desc: e.target.value }))}
                  maxLength={100} rows={2}
                  style={{ ...fieldStyle, height: "auto", padding: "6px 8px", resize: "none" }}
                  placeholder="장소 설명" />
              </div>
              {/* 버튼 */}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 2 }}>
                <button onClick={() => setEditingPlace(null)}
                  style={{
                    height: 30, padding: "0 14px", borderRadius: 6,
                    border: "1px solid var(--border-input)", background: "var(--surface-5)",
                    color: "var(--text-primary)", fontSize: "var(--font-size-sm)", cursor: "pointer",
                  }}>취소</button>
                <button onClick={handleEditConfirm}
                  style={{
                    height: 30, padding: "0 14px", borderRadius: 6,
                    border: "1px solid var(--color-info-border)", background: "var(--color-info-bg)",
                    color: "var(--text-primary)", fontSize: "var(--font-size-sm)", cursor: "pointer",
                  }}>확인</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 장소 삭제 확인 팝업 ── */}
      {deleteConfirmTarget && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90,
          }}
          onClick={() => setDeleteConfirmTarget(null)}
        >
          <div
            style={{
              background: "var(--surface-3)", borderRadius: 12, padding: "20px 28px",
              minWidth: 300, boxShadow: "0 8px 32px rgba(0,0,0,0.35)", textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "var(--font-size-lg)", color: "var(--text-primary)", marginBottom: 6 }}>
              {deleteConfirmTarget.type.startsWith("route") ? "구간 삭제" : "장소 삭제"}
            </div>
            <div style={{ fontSize: "var(--font-size-md)", color: "var(--text-secondary)", marginBottom: 20 }}>
              {deleteConfirmTarget.type.startsWith("route")
                ? <><strong>{deleteConfirmTarget.name}</strong> 구간을 삭제하시겠습니까?</>
                : <><strong>{deleteConfirmTarget.name}</strong>을(를) 삭제하시겠습니까?</>
              }
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
              <button
                onClick={() => setDeleteConfirmTarget(null)}
                style={{
                  width: 110, height: 34, borderRadius: 8, border: "1px solid var(--border-input)",
                  background: "var(--surface-5)", color: "var(--text-primary)", cursor: "pointer",
                  fontSize: "var(--font-size-md)",
                }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  const t = deleteConfirmTarget.type;
                  if (t === "db" || t === "pending") {
                    // 삭제할 장소명 찾기
                    const placeName = deleteConfirmTarget.name;
                    // 연결된 DB 구간 찾아서 삭제 표시
                    const cascadedDb = dbRoutes
                      .filter((r) => !deletedRouteDbIds.has(r.id) && (r.StartPlaceName === placeName || r.EndPlaceName === placeName))
                      .map((r) => r.id);
                    if (cascadedDb.length > 0)
                      setDeletedRouteDbIds((prev) => { const next = new Set(prev); cascadedDb.forEach((id) => next.add(id)); return next; });
                    // 연결된 pending 구간 찾아서 제거
                    const cascadedPending = pendingRoutes.filter((r) => r.startName === placeName || r.endName === placeName);
                    if (cascadedPending.length > 0)
                      setPendingRoutes((prev) => prev.filter((r) => r.startName !== placeName && r.endName !== placeName));

                    if (t === "db") {
                      setDeletedDbIds((prev) => new Set(prev).add(deleteConfirmTarget.id as number));
                      setUndoStack((prev) => [...prev, { type: "deleteDbPlace", id: deleteConfirmTarget.id as number, cascadedDbRoutes: cascadedDb, cascadedPendingRoutes: cascadedPending }]);
                    } else {
                      const removed = pendingPlaces.find((p) => p.tempId === deleteConfirmTarget.id);
                      setPendingPlaces((prev) => prev.filter((p) => p.tempId !== deleteConfirmTarget.id));
                      if (removed) setUndoStack((prev) => [...prev, { type: "deletePendingPlace", place: removed, cascadedDbRoutes: cascadedDb, cascadedPendingRoutes: cascadedPending }]);
                    }
                  } else if (t === "route_db") {
                    setDeletedRouteDbIds((prev) => new Set(prev).add(deleteConfirmTarget.id as number));
                    setUndoStack((prev) => [...prev, { type: "deleteDbRoute", id: deleteConfirmTarget.id as number }]);
                  } else if (t === "route_pending") {
                    const removed = pendingRoutes.find((r) => r.tempId === deleteConfirmTarget.id);
                    setPendingRoutes((prev) => prev.filter((r) => r.tempId !== deleteConfirmTarget.id));
                    if (removed) setUndoStack((prev) => [...prev, { type: "deletePendingRoute", route: removed }]);
                  }
                  setDeleteConfirmTarget(null);
                }}
                style={{
                  width: 110, height: 34, borderRadius: 8, border: "1px solid var(--color-error-border)",
                  background: "var(--color-error-bg)", color: "var(--text-primary)", cursor: "pointer",
                  fontSize: "var(--font-size-md)",
                }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 장소 생성 모달 ── */}
      {showPlaceModal && placeClickCoords && (
        <MapPlaceCreateModal
          isOpen={showPlaceModal}
          mode="create"
          worldX={placeClickCoords.worldX}
          worldY={placeClickCoords.worldY}
          pixelX={placeClickCoords.pixelX}
          pixelY={placeClickCoords.pixelY}
          mapId={selectedMap !== "" ? (selectedMap as number) : undefined}
          defaultRobotName={connectedRobots[0]?.RobotName ?? ""}
          defaultFloor={
            selectedFloor !== ""
              ? floors.find((a) => a.id === selectedFloor)?.FloorName ?? ""
              : ""
          }
          floors={floors}
          lockCoords={isFromRobotPos}
          defaultYaw={isFromRobotPos && robotPos ? robotPos.yaw : undefined}
          defaultCategory={isChargeCreate ? "charge" : undefined}
          onSelectDanger={handleStartDangerFromPlace}
          onClose={() => {
            setShowPlaceModal(false);
            setPlaceClickCoords(null);
            setIsFromRobotPos(false);
            setIsChargeCreate(false);
            setChargeDockingPlace(null);
          }}
          onConfirm={(place) => {
            // 충전소 생성 시 도킹 포인트도 함께 추가
            // 도킹/충전소 좌표는 모달이 열린 시점(= 생성 버튼 클릭)에 robotPos로 확정되어
            // 모달에 표시된 값 그대로 저장된다(보이는 값 = 저장 값). 충전소(★)는 도킹 기준
            // +0.866m 정면(#1, 유지). 정지 충전 중 로봇 기준이므로 이 스냅샷으로 충분하다.
            if (isChargeCreate && chargeDockingPlace) {
              const dock: PendingPlace = {
                ...chargeDockingPlace,
                LacationName: `${place.LacationName}-1`,
                Imformation: `${place.LacationName} 충전 도킹 포인트`,
              };
              setPendingPlaces((prev) => [...prev, dock, place]);
              setUndoStack((prev) => [
                ...prev,
                { type: "addPlace", tempId: dock.tempId },
                { type: "addPlace", tempId: place.tempId },
              ]);
            } else {
              setPendingPlaces((prev) => [...prev, place]);
              setUndoStack((prev) => [...prev, { type: "addPlace", tempId: place.tempId }]);
            }
            if (isRouteMode && routeStartName) {
              setRouteEndName(place.LacationName);
            }
            setShowPlaceModal(false);
            setPlaceClickCoords(null);
            setIsFromRobotPos(false);
            setIsChargeCreate(false);
            setChargeDockingPlace(null);
          }}
        />
      )}

      {/* 위험구역 이름 입력 모달 비활성화 (요청에 의해 OFF — 에러 상황 방지)
      <DangerZoneSaveModal
        isOpen={dangerSave !== null}
        points={dangerSave?.points ?? []}
        centroid={dangerSave?.centroid ?? { x: 0, y: 0 }}
        floorName={
          selectedFloor !== ""
            ? floors.find((a) => a.id === selectedFloor)?.FloorName ?? ""
            : ""
        }
        onClose={() => setDangerSave(null)}
        onConfirm={handleDangerConfirm}
      />
      */}

    </div>
    <MapAlertModal
      open={modal.open}
      message={modal.message}
      mode={modal.mode}
      onConfirm={modal.mode === "alert" ? closeModal : handleConfirm}
      onClose={closeModal}
    />
    </PermissionGuard>
  );
}
