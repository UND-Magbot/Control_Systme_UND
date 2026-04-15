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
import MappingStartModal from "./components/tabs/map/MappingStartModal";
import MappingProgressModal from "./components/tabs/map/MappingProgressModal";
import MappingSuccessModal from "./components/tabs/map/MappingSuccessModal";
import PathBuildPanel from "./components/tabs/map/PathBuildPanel";
import MapToolbar from "./components/tabs/map/MapToolbar";
import MapRightPanel from "./components/tabs/map/MapRightPanel";

export default function MapManagementPage() {
  const setPageReady = usePageReady();
  // ── URL query에서 초기 탭 결정 ──
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as MapTab) || "map";
  const [activeTab, setActiveTab] = useState<MapTab>(
    ["map", "place", "path"].includes(initialTab) ? initialTab : "map"
  );

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
        setPageReady();
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
  const [selectedConnectIds, setSelectedConnectIds] = useState<number[]>([]);

  // ── 동기화 (맵 적용) ──
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncRobots, setSyncRobots] = useState<Robot[]>([]);
  const [selectedSyncIds, setSelectedSyncIds] = useState<number[]>([]);
  const [robotPos, setRobotPos] = useState<{ x: number; y: number; yaw: number } | null>(null);

  // ── 맵 메타 (origin, resolution) — 훅으로 분리 ──
  const mapMeta = useMapMeta(selectedMap);

  // ── 맵 위 장소 목록 ──
  const [mapPlaces, setMapPlaces] = useState<
    { id: number; LacationName: string; LocationX: number; LocationY: number; Yaw: number;
      RobotName?: string; Floor?: string; FloorId?: number; MapId?: number; Category?: string; Imformation?: string }[]
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

  const clearAllModes = () => {
    setIsPlaceMode(false);
    resetDeleteMode();
    resetRouteMode();
    resetPathBuild();
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
      alert("저장할 변경사항이 없습니다.");
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

      alert("저장되었습니다.");
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
      alert(e instanceof Error ? e.message : "저장 중 오류 발생");
    }
  };

  // ── 장소 생성 모드 ──
  const [isPlaceMode, setIsPlaceMode] = useState(false);
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
    if (!pathBuildName.trim()) { alert("경로명을 입력해주세요."); return; }
    if (pathBuildOrder.length < 2) { alert("장소를 2개 이상 선택해주세요."); return; }

    // RobotName: 연결된 로봇 > 첫 번째 장소의 RobotName > 빈 문자열
    const robotName =
      connectedRobots[0]?.RobotName
      ?? mapPlaces.find((p) => p.LacationName === pathBuildOrder[0])?.RobotName
      ?? pendingPlaces.find((p) => p.LacationName === pathBuildOrder[0])?.RobotName
      ?? "";

    if (!robotName) { alert("로봇 정보를 확인할 수 없습니다. 로봇을 연결하거나 장소에 로봇을 지정해주세요."); return; }

    try {
      const res = await apiFetch(`/DB/path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RobotName: robotName,
          TaskType: pathBuildWorkType,
          WayName: pathBuildName.trim(),
          WayPoints: pathBuildOrder.join(" - "),
        }),
      });
      if (!res.ok) throw new Error("경로 저장 실패");
      alert("경로가 저장되었습니다.");
      setIsPathBuildMode(false);
      setPathBuildOrder([]);
      setPathBuildName("");
      setRightPanelOpen(true);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "저장 중 오류 발생");
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
    if (!isPlaceMode && !isDeleteMode && !isRouteMode && !isPathBuildMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsPlaceMode(false);
        setIsDeleteMode(false);
        setIsRouteMode(false);
        setRouteStartName(null);
        setRouteEndName(null);
        setIsPathBuildMode(false);
        setPathBuildOrder([]);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPlaceMode, isDeleteMode, isRouteMode, isPathBuildMode]);

  // ── SVG 맵 뷰 상태 ──
  const [processedImg, setProcessedImg] = useState<{ url: string; w: number; h: number } | null>(null);
  const { zoom, setZoom, rotation, setRotation, offset, setOffset, svgRef } =
    useSvgPanZoom(processedImg !== null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

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

  // ── 초기 진입 시 첫 번째 맵 자동 탐색 ──
  useEffect(() => {
    let cancelled = false;
    const loadFirstMap = async () => {
      try {
        // 1. 사업장 로드
        const bizRes = await apiFetch(`/map/businesses`);
        const bizRaw = await bizRes.json();
        const bizList: Business[] = Array.isArray(bizRaw) ? bizRaw : [];
        setBusinesses(bizList);
        if (bizList.length === 0 || cancelled) return;

        for (const biz of bizList) {
          if (cancelled) return;
          // 2. 해당 사업장의 층 로드
          const floorRes = await apiFetch(`/map/floors?business_id=${biz.id}`);
          const floorRaw = await floorRes.json();
          const floorList: FloorItem[] = Array.isArray(floorRaw) ? floorRaw : [];

          for (const fl of floorList) {
            if (cancelled) return;
            // 3. 해당 층의 맵 로드
            const mapRes = await apiFetch(`/map/maps?floor_id=${fl.id}`);
            const mapRaw = await mapRes.json();
            const mapList: RobotMap[] = Array.isArray(mapRaw) ? mapRaw : [];

            if (mapList.length > 0) {
              // 첫 번째 맵 발견 → 전부 세팅
              setSelectedBiz(biz.id);
              setFloors(floorList);
              setSelectedFloor(fl.id);
              setMaps(mapList);
              setSelectedMap(mapList[0].id);
              return;
            }
          }

          // 맵은 없지만 첫 사업장/층은 세팅
          if (floorList.length > 0) {
            setSelectedBiz(biz.id);
            setFloors(floorList);
            setSelectedFloor(floorList[0].id);
          }
        }
      } catch (e) {
        if (!cancelled) console.error("초기 맵 로드 실패:", e);
      }
    };
    loadFirstMap();
    return () => { cancelled = true; };
  }, []);

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
      setRotation(0);

      // SVG가 렌더된 후 중앙 배치 (마운트 대기)
      const centerMap = () => {
        const svgEl = svgRef.current;
        if (svgEl && svgEl.getBoundingClientRect().width > 0) {
          const rect = svgEl.getBoundingClientRect();
          const scaleX = rect.width / processed.w;
          const scaleY = rect.height / processed.h;
          const fitZoom = Math.min(scaleX, scaleY) * 0.75;
          setZoom(fitZoom);
          setOffset({ x: rect.width / 2, y: rect.height / 2 });
        } else {
          requestAnimationFrame(centerMap);
        }
      };
      requestAnimationFrame(centerMap);
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

    // 장소 생성 모드 (최우선)
    if (isPlaceMode) {
      const coords = svgEventToWorld(e);
      if (!coords) return;
      setPlaceClickCoords(coords);
      setShowPlaceModal(true);
      setIsPlaceMode(false);
      return;
    }

    // 구간 모드: 빈 공간 클릭 → 시작점 선택된 상태에서만 새 장소 생성
    if (isRouteMode && routeStartName) {
      const coords = svgEventToWorld(e);
      if (!coords) return;
      setPlaceClickCoords(coords);
      setShowPlaceModal(true);
      return;
    }
  };

  // ── 상단 사업장 선택 ──
  const handleBizChange = (bizId: number) => {
    setSelectedBiz(bizId);
    setSelectedFloor("");
    setSelectedMap("");
    setMaps([]);
    loadFloors(bizId);
  };

  // ── 상단 층 선택 ──
  const handleFloorChange = async (floorId: number) => {
    setSelectedFloor(floorId);
    setSelectedMap("");
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
      alert("로봇이 연결되어 있지 않습니다. 먼저 로봇을 연결해주세요.");
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
    if (!processedImg || !mapMeta) { alert("맵을 먼저 선택해주세요."); return; }
    clearAllModes();
    setIsPathBuildMode(true);
    setPathBuildName("");
    setRightPanelOpen(false);
  };

  const handleMapReset = () => {
    clearAllModes();
    if (!processedImg || !mapMeta) {
      alert("맵을 먼저 선택해주세요.");
      return;
    }
    if (!confirm("맵 위의 모든 장소와 구간을 초기화하시겠습니까?\n저장 버튼을 눌러야 DB에 반영됩니다.")) return;
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
      alert("영역 이름 중복 체크를 해주세요.");
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
        alert("사업장 생성 실패");
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
        alert("층 생성 실패");
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
      alert("맵핑 시작 실패");
    } finally {
      setIsMappingStarting(false);
    }
  };

  // ── 맵핑 종료 → SSH 파일 가져오기 → DB 저장 → 성공 팝업 ──
  const handleMappingEnd = async () => {
    if (isMappingEnding) return;
    setIsMappingEnding(true);
    try {
      const res = await apiFetch(`/map/mapping/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessId: saveBizId,
          FloorId: saveFloorId,
          MapName: saveMapName,
        }),
      });
      if (res.ok) {
        setMappingState("success");
      } else {
        const err = await res.json();
        alert(err.detail || "맵 저장 실패");
      }
    } catch (e) {
      console.error("맵핑 종료 실패:", e);
      alert("맵핑 종료 중 오류 발생");
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
      alert("모든 항목을 입력해주세요.");
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
        alert("맵이 저장되었습니다.");
        setMappingState("idle");
      } else {
        alert("저장 실패");
      }
    } catch (e) {
      console.error("맵 저장 실패:", e);
      alert("저장 중 오류 발생");
    }
  };

  // ── 로봇 위치 폴링 + 현재 층 갱신 (훅으로 분리) ──
  useRobotPolling(connectedRobots, setConnectedRobots, setRobotPos);

  // ── 저장 취소 ──
  const handleCancelSave = () => {
    setMappingState("idle");
  };

  // ── 로봇 연결 모달 ──
  const handleOpenRobotModal = async () => {
    clearAllModes();
    try {
      const res = await apiFetch(`/DB/robots`);
      const data = await res.json();
      // 현재 선택된 맵을 사용 중인 로봇만 필터링
      if (selectedMap !== "") {
        setRobots(data.filter((r: Robot) => r.CurrentMapId === selectedMap));
      } else {
        setRobots(data);
      }
    } catch (e) {
      console.error("로봇 목록 로드 실패:", e);
    }
    setSelectedConnectIds(connectedRobots.map((r) => r.id));
    setShowRobotModal(true);
  };

  // ── 동기화 모달 열기 ──
  const handleOpenSyncModal = async () => {
    clearAllModes();
    if (selectedMap === "") {
      alert("동기화할 맵을 먼저 선택해주세요.");
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
    if (selected.length === 0) { alert("동기화할 로봇을 선택해주세요."); return; }

    const names = selected.map((r) => r.RobotName).join(", ");
    if (!confirm(`로봇 [${names}]에 맵 '${mapData.MapName}'을(를) 동기화하시겠습니까?`)) return;
    setShowSyncModal(false);

    const results: string[] = [];
    for (const robot of selected) {
      try {
        const res = await apiFetch(`/map/maps/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ map_id: mapData.id, robot_id: robot.id }),
        });
        if (!res.ok) {
          const err = await res.json();
          results.push(`${robot.RobotName}: 실패 - ${err.detail || "오류"}`);
        } else {
          results.push(`${robot.RobotName}: 성공`);
        }
      } catch (e: any) {
        results.push(`${robot.RobotName}: 실패 - ${e.message}`);
      }
    }
    alert(results.join("\n"));
  };

  const handleConnectConfirm = () => {
    const selected = robots.filter((r) => selectedConnectIds.includes(r.id));
    setConnectedRobots(selected);
    setShowRobotModal(false);
  };

  // ── 맵 삭제 ──
  const handleDeleteMap = async () => {
    clearAllModes();
    if (selectedMap === "") {
      alert("삭제할 맵을 먼저 선택해주세요.");
      return;
    }
    const mapName = maps.find((m) => m.id === selectedMap)?.MapName ?? "선택된 맵";
    if (!confirm(`"${mapName}" 맵을 삭제하시겠습니까?\n맵에 포함된 장소, 구간, 관련 경로가 모두 삭제됩니다.`)) return;
    try {
      const res = await apiFetch(`/map/maps/${selectedMap}`, { method: "DELETE" });
      if (!res.ok) throw new Error("맵 삭제 실패");
      alert("맵이 삭제되었습니다.");
      setPendingPlaces([]);
      setPendingRoutes([]);
      setDeletedDbIds(new Set());
      setDeletedRouteDbIds(new Set());
      setMovedPlaces(new Map());
      setModifiedDbIds(new Set());
      setUndoStack([]);
      // 맵 목록 새로고침 후 다음 맵 자동 선택
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
      alert(e instanceof Error ? e.message : "삭제 중 오류 발생");
    }
  };

  return (
    <PermissionGuard requiredPermissions={["map-edit", "place-list", "path-list"]}>
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 페이지 헤더 + 탭 */}
      <div className="page-header-tab">
        <h1>맵 관리</h1>
        <div className={styles.mapTab}>
          {([
            { id: "map" as MapTab, label: "맵 편집" },
            { id: "place" as MapTab, label: "장소 목록" },
            { id: "path" as MapTab, label: "경로 목록" },
          ]).map((tab) => (
            <div
              key={tab.id}
              className={activeTab === tab.id ? styles.mapTabActive : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      {activeTab === "place" && <PlaceList robots={tabRobots} floors={tabFloors} hideActions />}
      {activeTab === "path" && <PathList robots={tabRobots} floors={tabFloors} hideActions />}

      {activeTab === "map" && <div className={styles.container}>
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
          onSaveAll={handleSaveAll}
          onOpenSyncModal={handleOpenSyncModal}
          onClearModes={clearAllModes}
          onDeleteMap={handleDeleteMap}
          onOpenRobotModal={handleOpenRobotModal}
        />

        {/* ── 메인 영역 ── */}
        <div className={styles.mainArea}>
          {/* 맵 캔버스 (전체 배경) */}
          <div className={styles.mapCanvas}>
            {processedImg ? (
              <svg
                ref={svgRef}
                className={styles.mapSvg}
                style={draggingPlace ? { cursor: "grabbing" } : isPlaceMode ? { cursor: "crosshair" } : (isDeleteMode || isRouteMode || isPathBuildMode) ? { cursor: "pointer" } : undefined}
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

                  {/* 저장된 장소 + 미저장 장소 마커 표시 */}
                  {mapMeta && [
                    ...mapPlaces
                      .filter((p) => !deletedDbIds.has(p.id))
                      .map((p) => ({ key: `db_${p.id}`, dbId: p.id, tempId: null as string | null, name: p.LacationName, x: p.LocationX, y: p.LocationY, pending: false })),
                    ...pendingPlaces.map((p) => ({ key: p.tempId, dbId: null as number | null, tempId: p.tempId, name: p.LacationName, x: p.LocationX, y: p.LocationY, pending: true })),
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
          </div>

          {/* 격자 버튼 (좌측 상단 모서리) */}
          <button className={styles.gridBtn}>
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
                  alert("맵을 먼저 선택해주세요.");
                  return;
                }
                if (!robotPos) {
                  alert("로봇 위치 정보를 가져올 수 없습니다.");
                  return;
                }
                // 도킹 포인트 → 충전소 간 거리 (0.866m)
                const CHARGE_OFFSET = 0.866;
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
                  alert("맵을 먼저 선택해주세요.");
                  return;
                }
                if (!robotPos) {
                  alert("로봇 위치 정보를 가져올 수 없습니다.");
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
                  alert("맵을 먼저 선택해주세요.");
                  return;
                }
                setIsRouteMode((v) => !v);
                setIsPlaceMode(false);
                setIsDeleteMode(false);
                setRouteStartName(null);
                setRouteEndName(null);
              }}
            >
              <img src="/icon/path_way.png" alt="구간" className={styles.toolBtnImg} />
              <span>구간</span>
            </button>
            <button
              className={`${styles.toolBtn} ${isPlaceMode ? styles.toolBtnActive : ""}`}
              onClick={() => {
                if (!processedImg || !mapMeta) {
                  alert("맵을 먼저 선택해주세요.");
                  return;
                }
                setIsPlaceMode((v) => !v);
                setIsDeleteMode(false);
                setIsRouteMode(false);
                setRouteStartName(null);
                setRouteEndName(null);
              }}
            >
              <img src="/icon/place_point.png" alt="장소" className={styles.toolBtnImg} />
              <span>장소</span>
            </button>
            <button
              className={`${styles.toolBtn} ${isDeleteMode ? styles.toolBtnActive : ""}`}
              onClick={() => {
                if (!processedImg || !mapMeta) {
                  alert("맵을 먼저 선택해주세요.");
                  return;
                }
                setIsDeleteMode((v) => !v);
                setIsPlaceMode(false);
                setIsRouteMode(false);
                setRouteStartName(null);
                setRouteEndName(null);
              }}
            >
              <span className={styles.toolBtnIcon}>&#10005;</span>
              <span>삭제</span>
            </button>
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
            <button className={`${styles.zoomBtn} ${styles.zoomBtnReset}`} onClick={() => { setZoom(1); setRotation(0); setOffset({ x: 0, y: 0 }); }}>
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
          />

          <PathBuildPanel
            isOpen={isPathBuildMode}
            pathBuildName={pathBuildName}
            setPathBuildName={setPathBuildName}
            pathBuildWorkType={pathBuildWorkType}
            setPathBuildWorkType={setPathBuildWorkType}
            pathBuildOrder={pathBuildOrder}
            setPathBuildOrder={setPathBuildOrder}
            placeCoordMap={placeCoordMap}
            onCancel={() => {
              setIsPathBuildMode(false);
              setPathBuildOrder([]);
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
        onConfirm={handleConnectConfirm}
      />
      <MapSyncModal
        isOpen={showSyncModal}
        syncRobots={syncRobots}
        selectedSyncIds={selectedSyncIds}
        setSelectedSyncIds={setSelectedSyncIds}
        onClose={() => setShowSyncModal(false)}
        onConfirm={handleSyncConfirm}
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
          onClose={() => {
            setShowPlaceModal(false);
            setPlaceClickCoords(null);
            setIsFromRobotPos(false);
            setIsChargeCreate(false);
            setChargeDockingPlace(null);
          }}
          onConfirm={(place) => {
            // 충전소 생성 시 도킹 포인트도 함께 추가
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



    </div>
    </PermissionGuard>
  );
}
