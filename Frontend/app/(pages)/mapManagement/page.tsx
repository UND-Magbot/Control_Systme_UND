"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import styles from "./mapManagement.module.css";
import PlaceList from "@/app/(pages)/schedules/components/PlaceList";
import PathList from "@/app/(pages)/schedules/components/PathList";
import MapPlaceCreateModal from "./components/MapPlaceCreateModal";
import type { PendingPlace } from "./components/MapPlaceCreateModal";
import type { RobotRowData, Floor } from "@/app/type";
import { apiFetch } from "@/app/lib/api";
import { API_BASE } from "@/app/config";

type MapTab = "map" | "place" | "path";

type Business = { id: number; BusinessName: string };
type Area = { id: number; BusinessId: number; FloorName: string };
type RobotMap = { id: number; BusinessId: number; AreaId: number; AreaName: string; PgmFilePath: string; ImgFilePath: string };

type Robot = { id: number; RobotName: string; ModelName: string; SerialNumber: string };
type MappingState = "idle" | "startModal" | "mappingModal" | "success" | "saveModal";

export default function MapManagementPage() {
  // ── 탭 상태 ──
  const [activeTab, setActiveTab] = useState<MapTab>("map");

  // ── PlaceList / PathList 용 데이터 ──
  const [tabRobots, setTabRobots] = useState<RobotRowData[]>([]);
  const [tabFloors] = useState<Floor[]>([
    { id: 1, label: "B2" },
    { id: 2, label: "B1" },
    { id: 3, label: "1F" },
    { id: 4, label: "2F" },
    { id: 5, label: "3F" },
  ]);

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
      }
    };
    fetchTabRobots();
  }, []);

  // ── 사업장 / 층 / 영역(맵) 데이터 ──
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
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
  const [connectedRobot, setConnectedRobot] = useState<Robot | null>(null);

  // ── 동기화 (맵 적용) ──
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncRobots, setSyncRobots] = useState<Robot[]>([]);
  const [robotPos, setRobotPos] = useState<{ x: number; y: number; yaw: number } | null>(null);

  // ── 맵 메타 (origin, resolution) ──
  const [mapMeta, setMapMeta] = useState<{ resolution: number; originX: number; originY: number } | null>(null);

  // ── 맵 위 장소 목록 ──
  const [mapPlaces, setMapPlaces] = useState<
    { id: number; LacationName: string; LocationX: number; LocationY: number; Yaw: number;
      RobotName?: string; Floor?: string; MapId?: number; Imformation?: string }[]
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
  type RouteSegmentData = { tempId: string; startName: string; endName: string; direction: "forward" | "reverse" | "bidirectional" };
  type UndoAction =
    | { type: "addPlace"; tempId: string }
    | { type: "deletePendingPlace"; place: PendingPlace; cascadedDbRoutes: number[]; cascadedPendingRoutes: RouteSegmentData[] }
    | { type: "deleteDbPlace"; id: number; cascadedDbRoutes: number[]; cascadedPendingRoutes: RouteSegmentData[] }
    | { type: "addRoute"; tempId: string }
    | { type: "deletePendingRoute"; route: RouteSegmentData }
    | { type: "deleteDbRoute"; id: number }
    | { type: "mapReset";
        prevPendingPlaces: PendingPlace[];
        prevPendingRoutes: RouteSegmentData[];
        prevDeletedDbIds: Set<number>;
        prevDeletedRouteDbIds: Set<number>;
        prevMovedPlaces: Map<string, { x: number; y: number }>;
        prevModifiedDbIds: Set<number>;
      };
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);

  const clearAllModes = () => {
    setIsPlaceMode(false);
    setIsDeleteMode(false);
    setIsRouteMode(false);
    setRouteStartName(null);
    setRouteEndName(null);
    setIsPathBuildMode(false);
    setPathBuildOrder([]);
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
              Floor: dbPlace.Floor ?? "",
              LocationX: Number(coords.x.toFixed(3)),
              LocationY: Number(coords.y.toFixed(3)),
              Yaw: Number((dbPlace.Yaw ?? 0).toFixed(3)),
              MapId: dbPlace.MapId ?? null,
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

  // ── 장소 인라인 수정 ──
  const [editingPlace, setEditingPlace] = useState<{
    key: string; name: string; svgX: number; svgY: number;
    x: number; y: number; yaw: number; desc: string;
  } | null>(null);
  const [editValues, setEditValues] = useState({ name: "", x: "", y: "", dir: "", desc: "" });
  const [modifiedDbIds, setModifiedDbIds] = useState<Set<number>>(new Set());

  // ── 장소 삭제 모드 ──
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [deletedDbIds, setDeletedDbIds] = useState<Set<number>>(new Set());
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    type: "db" | "pending" | "route_db" | "route_pending";
    id: number | string;
    name: string;
  } | null>(null);

  // ── 경로 생성 모드 (way_info) — state만 선언, useMemo는 dbRoutes 뒤에 ──
  const [isPathBuildMode, setIsPathBuildMode] = useState(false);
  const [pathBuildOrder, setPathBuildOrder] = useState<string[]>([]);
  const [pathBuildName, setPathBuildName] = useState("");
  const [pathBuildWorkType, setPathBuildWorkType] = useState("task1");

  // ── 구간 생성 모드 ──
  type RouteDirection = "forward" | "reverse" | "bidirectional";
  type RouteSegment = {
    tempId: string;
    startName: string;
    endName: string;
    direction: RouteDirection;
  };
  type DbRoute = {
    id: number;
    MapId: number;
    StartPlaceName: string;
    EndPlaceName: string;
    Direction: string;
  };

  const [isRouteMode, setIsRouteMode] = useState(false);
  const [routeStartName, setRouteStartName] = useState<string | null>(null);
  const [routeEndName, setRouteEndName] = useState<string | null>(null);
  const [routeDirection, setRouteDirection] = useState<RouteDirection>("forward");
  const [pendingRoutes, setPendingRoutes] = useState<RouteSegment[]>([]);
  const [dbRoutes, setDbRoutes] = useState<DbRoute[]>([]);
  const [deletedRouteDbIds, setDeletedRouteDbIds] = useState<Set<number>>(new Set());

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
      connectedRobot?.RobotName
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
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  // ── 저장 모달 폼 ──
  const [saveBizId, setSaveBizId] = useState<number | "">("");
  const [saveAreaId, setSaveAreaId] = useState<number | "">("");
  const [saveAreaName, setSaveAreaName] = useState("");

  // ── 맵핑 시작 모달 폼 ──
  const [startBizId, setStartBizId] = useState<number | "">("");
  const [startBizNew, setStartBizNew] = useState("");
  const [startBizMode, setStartBizMode] = useState<"select" | "new">("select");
  const [startFloorId, setStartFloorId] = useState<number | "">("");
  const [startFloorNew, setStartFloorNew] = useState("");
  const [startFloorMode, setStartFloorMode] = useState<"select" | "new">("select");
  const [startAreas, setStartAreas] = useState<Area[]>([]);
  const [startAreaName, setStartAreaName] = useState("");
  const [startAreaChecked, setStartAreaChecked] = useState<boolean | null>(null); // null=미확인, true=사용가능, false=중복
  const [isMappingRunning, setIsMappingRunning] = useState(false); // 맵핑 진행 중 여부
  const [isMappingStarting, setIsMappingStarting] = useState(false); // 맵핑 시작 준비 중
  const [isMappingEnding, setIsMappingEnding] = useState(false); // 맵핑 종료(맵 생성) 중

  // ── 맵핑 실시간 시각화 ──
  const [mappingCloudPoints, setMappingCloudPoints] = useState<number[][]>([]);
  const [mappingOdom, setMappingOdom] = useState<{ x: number; y: number; yaw: number } | null>(null);
  const hasReceivedData = useRef(false);
  const mappingCanvasRef = useRef<HTMLCanvasElement>(null);
  const mappingWsRef = useRef<WebSocket | null>(null);

  // ── 사업장 목록 로드 ──
  const loadBusinesses = useCallback(async () => {
    try {
      const res = await apiFetch(`/map/businesses`);
      const data = await res.json();
      setBusinesses(data);
    } catch (e) {
      console.error("사업장 로드 실패:", e);
    }
  }, []);

  // ── 층 목록 로드 ──
  const loadAreas = useCallback(async (bizId: number) => {
    try {
      const res = await apiFetch(`/map/areas?business_id=${bizId}`);
      const data = await res.json();
      setAreas(data);
    } catch (e) {
      console.error("층 로드 실패:", e);
    }
  }, []);

  // ── 영역(맵) 목록 로드 ──
  const loadMaps = useCallback(async (areaId: number) => {
    try {
      const res = await apiFetch(`/map/maps?area_id=${areaId}`);
      const data = await res.json();
      setMaps(data);
    } catch (e) {
      console.error("영역 로드 실패:", e);
    }
  }, []);

  // ── 초기 진입 시 첫 번째 맵 자동 탐색 ──
  useEffect(() => {
    const loadFirstMap = async () => {
      try {
        // 1. 사업장 로드
        const bizRes = await apiFetch(`/map/businesses`);
        const bizList: Business[] = await bizRes.json();
        setBusinesses(bizList);
        if (bizList.length === 0) return;

        for (const biz of bizList) {
          // 2. 해당 사업장의 층 로드
          const areaRes = await apiFetch(`/map/areas?business_id=${biz.id}`);
          const areaList: Area[] = await areaRes.json();

          for (const area of areaList) {
            // 3. 해당 층의 맵 로드
            const mapRes = await apiFetch(`/map/maps?area_id=${area.id}`);
            const mapList: RobotMap[] = await mapRes.json();

            if (mapList.length > 0) {
              // 첫 번째 맵 발견 → 전부 세팅
              setSelectedBiz(biz.id);
              setAreas(areaList);
              setSelectedFloor(area.id);
              setMaps(mapList);
              setSelectedMap(mapList[0].id);
              return;
            }
          }

          // 맵은 없지만 첫 사업장/층은 세팅
          if (areaList.length > 0) {
            setSelectedBiz(biz.id);
            setAreas(areaList);
            setSelectedFloor(areaList[0].id);
          }
        }
      } catch (e) {
        console.error("초기 맵 로드 실패:", e);
      }
    };
    loadFirstMap();
  }, []);

  useEffect(() => {
    if (saveBizId !== "") {
      loadAreas(saveBizId as number);
    }
  }, [saveBizId, loadAreas]);

  // ── 맵 메타 로드 ──
  useEffect(() => {
    if (selectedMap === "") {
      setMapMeta(null);
      return;
    }
    apiFetch(`/map/maps/${selectedMap}/meta`)
      .then((res) => res.json())
      .then((data) => setMapMeta(data))
      .catch(() => setMapMeta(null));
  }, [selectedMap]);

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
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // 1단계: 바깥 회색(unknown) 영역만 flood-fill 방식으로 투명 처리
      const w = canvas.width, h = canvas.height;
      const isGrayPixel = (idx: number) => {
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        return Math.abs(r - g) < 20 && Math.abs(r - b) < 20 && r > 100 && r < 253;
      };

      // 가장자리에서 시작하는 flood fill로 바깥 회색만 마킹
      const visited = new Uint8Array(w * h);
      const queue: number[] = [];

      // 4변 가장자리 픽셀 중 회색인 것을 시드로
      for (let x = 0; x < w; x++) {
        if (isGrayPixel(x * 4)) queue.push(x);
        const bottom = (h - 1) * w + x;
        if (isGrayPixel(bottom * 4)) queue.push(bottom);
      }
      for (let y = 0; y < h; y++) {
        if (isGrayPixel(y * w * 4)) queue.push(y * w);
        const right = y * w + (w - 1);
        if (isGrayPixel(right * 4)) queue.push(right);
      }

      // BFS
      while (queue.length > 0) {
        const pos = queue.pop()!;
        if (visited[pos]) continue;
        visited[pos] = 1;

        const idx = pos * 4;
        if (!isGrayPixel(idx)) continue;

        data[idx + 3] = 0; // 투명 처리

        const x = pos % w, y = Math.floor(pos / w);
        if (x > 0) queue.push(pos - 1);
        if (x < w - 1) queue.push(pos + 1);
        if (y > 0) queue.push(pos - w);
        if (y < h - 1) queue.push(pos + w);
      }

      ctx.putImageData(imageData, 0, 0);
      const url = canvas.toDataURL("image/png");
      const imgW = img.width;
      const imgH = img.height;
      setProcessedImg({ url, w: imgW, h: imgH });
      setRotation(0);

      // SVG가 렌더된 후 중앙 배치 (마운트 대기)
      const centerMap = () => {
        const svgEl = svgRef.current;
        if (svgEl && svgEl.getBoundingClientRect().width > 0) {
          const rect = svgEl.getBoundingClientRect();
          const scaleX = rect.width / imgW;
          const scaleY = rect.height / imgH;
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

  // ── 맵핑 모달 WebSocket 연결 ──
  useEffect(() => {
    if (mappingState !== "mappingModal") {
      // 모달 닫히면 WebSocket 해제
      if (mappingWsRef.current) {
        mappingWsRef.current.close();
        mappingWsRef.current = null;
      }
      setMappingOdom(null);
      return;
    }

    const wsUrl =
      typeof window !== "undefined" && window.location.hostname !== "localhost"
        ? `ws://${window.location.hostname}:8000/ws/mapping/view`
        : "ws://localhost:8000/ws/mapping/view";

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      mappingWsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === "cloud") {
            hasReceivedData.current = true;
            setMappingCloudPoints(data.points || []);
          } else if (data.type === "aligned") {
            hasReceivedData.current = true;
            setMappingCloudPoints(prev => [...prev, ...(data.points || [])]);
          } else if (data.type === "odom") {
            setMappingOdom({ x: data.x, y: data.y, yaw: data.yaw });
          }
        } catch (err) {
          console.error("WS 메시지 파싱 오류:", err);
        }
      };

      ws.onclose = () => {
        if (mappingState === "mappingModal") {
          setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      if (mappingWsRef.current) {
        mappingWsRef.current.close();
        mappingWsRef.current = null;
      }
    };
  }, [mappingState]);

  // ── 맵핑 Canvas 렌더링 (PointCloud, 더블 버퍼링) ──
  useEffect(() => {
    const canvas = mappingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = canvas.parentElement;
    if (!container) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;

    // 오프스크린 Canvas에 먼저 그리기 (깜빡임 방지)
    const offscreen = document.createElement("canvas");
    offscreen.width = cw;
    offscreen.height = ch;
    const off = offscreen.getContext("2d")!;

    // 배경
    off.fillStyle = "#111";
    off.fillRect(0, 0, cw, ch);

    if (mappingCloudPoints.length === 0) {
      if (!hasReceivedData.current) {
        off.fillStyle = "#555";
        off.font = "15px Pretendard, sans-serif";
        off.textAlign = "center";
        off.fillText("맵 데이터 수신 대기 중...", cw / 2, ch / 2);
        canvas.width = cw;
        canvas.height = ch;
        ctx.drawImage(offscreen, 0, 0);
      }
      return;
    }

    // 포인트 클라우드 범위 계산
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of mappingCloudPoints) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const margin = 40;
    const scaleX = (cw - margin * 2) / rangeX;
    const scaleY = (ch - margin * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const ox = (cw - rangeX * scale) / 2;
    const oy = (ch - rangeY * scale) / 2;

    // ROS 좌표 → Canvas 픽셀
    const toCanvas = (rx: number, ry: number) => ({
      x: ox + (rx - minX) * scale,
      y: oy + (maxY - ry) * scale,
    });

    // 포인트 클라우드 그리기
    off.fillStyle = "rgba(0, 200, 255, 0.7)";
    for (const pt of mappingCloudPoints) {
      const p = toCanvas(pt[0], pt[1]);
      off.fillRect(p.x, p.y, 2, 2);
    }

    // 로봇 위치 그리기 (빨간 삼각형)
    if (mappingOdom) {
      const rp = toCanvas(mappingOdom.x, mappingOdom.y);
      const sz = 8;
      off.save();
      off.translate(rp.x, rp.y);
      off.rotate(-mappingOdom.yaw);
      off.beginPath();
      off.moveTo(sz * 1.5, 0);
      off.lineTo(-sz, -sz);
      off.lineTo(-sz, sz);
      off.closePath();
      off.fillStyle = "rgba(255, 60, 60, 0.9)";
      off.fill();
      off.strokeStyle = "#fff";
      off.lineWidth = 1;
      off.stroke();
      off.restore();
    }

    // 완성된 프레임을 한 번에 복사
    canvas.width = cw;
    canvas.height = ch;
    ctx.drawImage(offscreen, 0, 0);
  }, [mappingCloudPoints, mappingOdom]);

  // ── SVG 마우스 휠 줌 ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.1, Math.min(10, prev * (e.deltaY < 0 ? 1.1 : 0.9))));
  }, []);

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
    loadAreas(bizId);
  };

  // ── 상단 층 선택 ──
  const handleFloorChange = (areaId: number) => {
    setSelectedFloor(areaId);
    setSelectedMap("");
    loadMaps(areaId);
  };

  // ── 맵핑 시작 모달 열기 ──
  const handleMappingStart = () => {
    clearAllModes();
    if (!connectedRobot) {
      alert("로봇이 연결되어 있지 않습니다. 먼저 로봇을 연결해주세요.");
      return;
    }
    setStartBizId("");
    setStartBizNew("");
    setStartBizMode("select");
    setStartFloorId("");
    setStartFloorNew("");
    setStartFloorMode("select");
    setStartAreas([]);
    setStartAreaName("");
    setStartAreaChecked(null);
    setMappingState("startModal");
  };

  // ── 시작 모달: 사업장 선택 시 층 로드 ──
  const handleStartBizChange = async (bizId: number) => {
    setStartBizId(bizId);
    setStartFloorId("");
    setStartFloorMode("select");
    try {
      const res = await apiFetch(`/map/areas?business_id=${bizId}`);
      const data = await res.json();
      setStartAreas(data);
    } catch (e) {
      setStartAreas([]);
    }
  };

  // ── 영역 이름 중복 체크 ──
  const handleCheckAreaName = async () => {
    if (!startAreaName.trim()) return;
    try {
      const res = await apiFetch(`/map/maps`);
      const data: RobotMap[] = await res.json();
      const exists = data.some((m) => m.AreaName === startAreaName.trim());
      setStartAreaChecked(!exists);
    } catch (e) {
      console.error("중복 체크 실패:", e);
    }
  };

  // ── 맵핑 실제 시작 ──
  const handleConfirmMappingStart = async () => {
    if (startAreaChecked !== true) {
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
        const res = await apiFetch(`/map/areas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ BusinessId: bizId, FloorName: startFloorNew.trim() }),
        });
        const area = await res.json();
        floorId = area.id;
      } catch (e) {
        alert("층 생성 실패");
        return;
      }
    }

    // 맵핑 시작 정보 임시 저장 (종료 시 사용)
    setSaveBizId(bizId);
    setSaveAreaId(floorId);
    setSaveAreaName(startAreaName.trim());
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
          AreaId: saveAreaId,
          AreaName: saveAreaName,
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
          AreaId: saveAreaId,
          AreaName: saveAreaName,
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
    const areaId = saveAreaId as number;
    setSelectedBiz(bizId);
    await loadAreas(bizId);
    setSelectedFloor(areaId);

    // 영역(맵) 목록 갱신 & 새 맵 자동 선택
    const mapRes = await apiFetch(`/map/maps?area_id=${areaId}`);
    const mapList: RobotMap[] = await mapRes.json();
    setMaps(mapList);

    const newMap = mapList.find((m) => m.AreaName === saveAreaName);
    if (newMap) {
      setSelectedMap(newMap.id);
    }
  };

  // ── 맵 저장 ──
  const handleSaveMap = async () => {
    if (saveBizId === "" || saveAreaId === "" || !saveAreaName.trim()) {
      alert("모든 항목을 입력해주세요.");
      return;
    }

    try {
      const res = await apiFetch(`/map/maps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessId: saveBizId,
          AreaId: saveAreaId,
          AreaName: saveAreaName.trim(),
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

  // ── 로봇 위치 폴링 ──
  useEffect(() => {
    if (!connectedRobot) {
      setRobotPos(null);
      return;
    }
    const poll = async () => {
      try {
        const res = await apiFetch(`/robot/position`);
        const data = await res.json();
        if (data.timestamp > 0) {
          setRobotPos({ x: data.x, y: data.y, yaw: data.yaw });
        }
      } catch (e) {
        console.error("위치 폴링 실패:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [connectedRobot]);

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
      setRobots(data);
    } catch (e) {
      console.error("로봇 목록 로드 실패:", e);
    }
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
    setShowSyncModal(true);
  };

  const handleSyncRobot = async (robot: Robot) => {
    const mapData = maps.find((m) => m.id === selectedMap);
    if (!mapData) return;
    setShowSyncModal(false);
    // TODO: 로봇에 맵 적용 API 호출
    alert(`로봇 '${robot.RobotName}'에 맵 '${mapData.AreaName}' 동기화 (추후 구현)`);
  };

  const handleConnectRobot = (robot: Robot) => {
    setConnectedRobot(robot);
    setShowRobotModal(false);
  };

  return (
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
        <div className={styles.toolbar}>
          <span className={styles.toolbarLabel}>사업장:</span>
          <select
            value={selectedBiz}
            onChange={(e) => handleBizChange(Number(e.target.value))}
          >
            <option value="">사업장 선택</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>{b.BusinessName}</option>
            ))}
          </select>

          <span className={styles.toolbarLabel}>층:</span>
          <select
            value={selectedFloor}
            onChange={(e) => handleFloorChange(Number(e.target.value))}
          >
            <option value="">층 선택</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>{a.FloorName}</option>
            ))}
          </select>

          <span className={styles.toolbarLabel}>영역:</span>
          <select
            value={selectedMap}
            onChange={(e) => setSelectedMap(Number(e.target.value))}
          >
            <option value="">영역 선택</option>
            {maps.map((m) => (
              <option key={m.id} value={m.id}>{m.AreaName}</option>
            ))}
          </select>

          <div className={styles.toolbarCenter}>
            <button className={styles.toolbarBtn} onClick={handleSaveAll}>저장</button>
            <button className={styles.toolbarBtn} onClick={handleOpenSyncModal}>동기화</button>
            <button className={styles.toolbarBtn} onClick={clearAllModes}>위치재조정</button>
            <button
              className={styles.toolbarBtn}
              onClick={async () => {
                clearAllModes();
                if (selectedMap === "") {
                  alert("삭제할 맵을 먼저 선택해주세요.");
                  return;
                }
                const mapName = maps.find((m) => m.id === selectedMap)?.AreaName ?? "선택된 맵";
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
                    const area = areas.find((a) => a.id === selectedFloor);
                    if (area) {
                      const mapsRes = await apiFetch(`/map/maps?area_id=${area.id}`);
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
                          setMapMeta(null);
                        }
                      }
                    }
                  } else {
                    setSelectedMap("");
                    setMapPlaces([]);
                    setDbRoutes([]);
                    setProcessedImg(null);
                    setMapMeta(null);
                  }
                } catch (e) {
                  alert(e instanceof Error ? e.message : "삭제 중 오류 발생");
                }
              }}
            >삭제</button>
          </div>
          <div className={styles.toolbarRight}>
            <button className={styles.robotConnectBtn} onClick={handleOpenRobotModal}>
              {connectedRobot ? connectedRobot.RobotName : "로봇 연결"}
            </button>
          </div>
        </div>

        {/* ── 메인 영역 ── */}
        <div className={styles.mainArea}>
          {/* 맵 캔버스 (전체 배경) */}
          <div className={styles.mapCanvas}>
            {processedImg ? (
              <svg
                ref={svgRef}
                className={styles.mapSvg}
                style={draggingPlace ? { cursor: "grabbing" } : isPlaceMode ? { cursor: "crosshair" } : (isDeleteMode || isRouteMode || isPathBuildMode) ? { cursor: "pointer" } : undefined}
                onWheel={handleWheel}
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

                  {/* 로봇 위치 표시 (RobotMarker 스타일) */}
                  {robotPos && mapMeta && (() => {
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
              <span className={styles.mapPlaceholder}>
                맵을 불러오거나 맵핑을 시작하세요
              </span>
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
            <button className={styles.topToolBtn}>
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
          <div className={`${styles.rightPanel} ${rightPanelOpen ? styles.rightPanelOpen : styles.rightPanelClosed}`}>
            <button
              className={styles.panelToggle}
              onClick={() => setRightPanelOpen((v) => !v)}
            >
              {rightPanelOpen ? "\u203A" : "\u2039"}
            </button>
            <div className={styles.panelCard}>
              <div className={styles.panelTitle}>맵 관리</div>

              {/* 경로 */}
              <button
                className={`${styles.btnMapping} ${styles.btnMappingStart}`}
                style={{ width: "100%", marginBottom: 10 }}
                onClick={() => {
                  if (!processedImg || !mapMeta) { alert("맵을 먼저 선택해주세요."); return; }
                  clearAllModes();
                  setIsPathBuildMode(true);
                  setPathBuildName("");
                  setRightPanelOpen(false);
                }}
              >
                경로 만들기
              </button>

              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "0 0 10px" }} />

              {/* 맵핑 */}
              <div className={styles.mappingBtns}>
                <button className={`${styles.btnMapping} ${styles.btnMappingStart}`} onClick={handleMappingStart}>
                  맵핑 시작
                </button>
                <button
                  className={`${styles.btnMapping} ${styles.btnMappingReset}`}
                  onClick={() => {
                    clearAllModes();
                    if (!processedImg || !mapMeta) {
                      alert("맵을 먼저 선택해주세요.");
                      return;
                    }
                    if (!confirm("맵 위의 모든 장소와 구간을 초기화하시겠습니까?\n저장 버튼을 눌러야 DB에 반영됩니다.")) return;
                    // 현재 상태를 undo 스택에 저장
                    setUndoStack((prev) => [...prev, {
                      type: "mapReset" as const,
                      prevPendingPlaces: [...pendingPlaces],
                      prevPendingRoutes: [...pendingRoutes],
                      prevDeletedDbIds: new Set(deletedDbIds),
                      prevDeletedRouteDbIds: new Set(deletedRouteDbIds),
                      prevMovedPlaces: new Map(movedPlaces),
                      prevModifiedDbIds: new Set(modifiedDbIds),
                    }]);
                    // pending 데이터 비우기
                    setPendingPlaces([]);
                    setPendingRoutes([]);
                    // DB 장소 전부 삭제 표시
                    setDeletedDbIds(new Set(mapPlaces.map((p) => p.id)));
                    // DB 구간 전부 삭제 표시
                    setDeletedRouteDbIds(new Set(dbRoutes.map((r) => r.id)));
                    // 이동/수정 상태 초기화
                    setMovedPlaces(new Map());
                    setModifiedDbIds(new Set());
                  }}
                >
                  맵 초기화
                </button>
              </div>
            </div>
          </div>

          {/* 경로 생성 플로팅 패널 */}
          {isPathBuildMode && (
            <div style={{
              position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 15,
              width: 280, background: "var(--surface-3)",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.3)",
              display: "flex", flexDirection: "column",
            }}>
              {/* 헤더 */}
              <div style={{
                padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
              }}>
                <span style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--text-primary)" }}>
                  경로 생성
                </span>
                <button
                  onClick={() => { setIsPathBuildMode(false); setPathBuildOrder([]); setRightPanelOpen(true); }}
                  style={{
                    background: "none", border: "none", color: "var(--text-muted)",
                    cursor: "pointer", fontSize: 18, lineHeight: 1,
                  }}
                >×</button>
              </div>

              {/* 폼 */}
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
                {/* 경로명 */}
                <div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", marginBottom: 3, fontWeight: 600 }}>경로명</div>
                  <input
                    value={pathBuildName}
                    onChange={(e) => setPathBuildName(e.target.value)}
                    maxLength={20}
                    placeholder="경로명을 입력하세요"
                    style={{
                      width: "100%", height: 32, borderRadius: 6,
                      border: "1px solid var(--border-input)", background: "var(--surface-input)",
                      color: "var(--text-primary)", padding: "0 10px", fontSize: "var(--font-size-sm)",
                    }}
                  />
                </div>
                {/* 작업유형 */}
                <div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", marginBottom: 3, fontWeight: 600 }}>작업유형</div>
                  <select
                    value={pathBuildWorkType}
                    onChange={(e) => setPathBuildWorkType(e.target.value)}
                    style={{
                      width: "100%", height: 32, borderRadius: 6,
                      border: "1px solid var(--border-input)", background: "var(--surface-input)",
                      color: "var(--text-primary)", padding: "0 8px", fontSize: "var(--font-size-sm)",
                    }}
                  >
                    <option value="task1">task1</option>
                    <option value="task2">task2</option>
                    <option value="task3">task3</option>
                  </select>
                </div>
              </div>

              {/* 경로 순서 */}
              <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <div style={{
                  fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", marginBottom: 6, fontWeight: 600,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span>경로 순서</span>
                  <span style={{ color: "var(--color-info)", fontWeight: 700 }}>{pathBuildOrder.length}개</span>
                </div>
                <div style={{
                  flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4,
                  background: "var(--surface-4)", borderRadius: 8, border: "1px solid var(--border-input)",
                  padding: pathBuildOrder.length > 0 ? 8 : "20px 8px",
                  minHeight: 80,
                }}>
                  {pathBuildOrder.length === 0 ? (
                    <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
                      맵에서 장소를 클릭하세요
                    </div>
                  ) : (
                    pathBuildOrder.map((name, i) => (
                      <div key={`${name}_${i}`} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 10px", borderRadius: 6,
                        background: "var(--surface-5)", fontSize: "var(--font-size-sm)",
                      }}>
                        <span style={{
                          width: 22, height: 22, borderRadius: "50%", background: "#FF6B35",
                          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>{i + 1}</span>
                        <span style={{ flex: 1, color: "var(--text-primary)", fontWeight: 500 }}>{name}</span>
                        {i > 0 && i < pathBuildOrder.length && (
                          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--text-muted)" }}>
                            {(() => {
                              const prev = placeCoordMap.get(pathBuildOrder[i - 1]);
                              const cur = placeCoordMap.get(name);
                              if (!prev || !cur) return "";
                              const d = Math.sqrt((cur.x - prev.x) ** 2 + (cur.y - prev.y) ** 2);
                              return `${d.toFixed(1)}m`;
                            })()}
                          </span>
                        )}
                        <button
                          onClick={() => setPathBuildOrder((prev) => prev.filter((_, idx) => idx !== i))}
                          style={{
                            background: "none", border: "none", color: "var(--text-muted)",
                            cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1,
                          }}
                          title="제거"
                        >×</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 하단 버튼 */}
              <div style={{
                padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)",
                display: "flex", gap: 8, flexShrink: 0,
              }}>
                <button
                  onClick={() => { setIsPathBuildMode(false); setPathBuildOrder([]); setRightPanelOpen(true); }}
                  style={{
                    flex: 1, height: 34, borderRadius: 8,
                    border: "1px solid var(--border-input)", background: "var(--surface-5)",
                    color: "var(--text-primary)", fontSize: "var(--font-size-md)", cursor: "pointer",
                  }}
                >취소</button>
                <button
                  onClick={handleSavePath}
                  disabled={pathBuildOrder.length < 2 || !pathBuildName.trim()}
                  style={{
                    flex: 1, height: 34, borderRadius: 8,
                    border: "1px solid var(--color-info-border)", background: "var(--color-info-bg)",
                    color: "var(--text-primary)", fontSize: "var(--font-size-md)", cursor: "pointer",
                    opacity: (pathBuildOrder.length < 2 || !pathBuildName.trim()) ? 0.5 : 1,
                  }}
                >저장</button>
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* ── 맵핑 시작 모달 ── */}
      {mappingState === "startModal" && (
        <div className={styles.startOverlay}>
          <div className={styles.startModal} onClick={(e) => e.stopPropagation()}>
            {/* 헤더 */}
            <div className={styles.startHeader}>
              <div className={styles.startHeaderLeft}>
                <img src="/icon/map_w.png" alt="" />
                <h2>맵핑 시작</h2>
              </div>
              <button className={styles.startCloseBtn} onClick={() => setMappingState("idle")}>
                &times;
              </button>
            </div>

            {/* 본문 */}
            <div className={styles.startBody}>
              {/* 사업장 섹션 */}
              <div className={styles.startSection}>
                <div className={styles.startSectionTitle}>
                  <span>사업장 정보</span>
                  <div className={styles.startSectionLine} />
                </div>
                <div className={styles.startRow}>
                  <span className={styles.startLabel}>사업장 <span className={styles.startRequired}>*</span></span>
                  <div className={styles.startField}>
                    {startBizMode === "select" ? (
                      <select
                        className={styles.startSelect}
                        value={startBizId}
                        onChange={(e) => handleStartBizChange(Number(e.target.value))}
                      >
                        <option value="">사업장 선택</option>
                        {businesses.map((b) => (
                          <option key={b.id} value={b.id}>{b.BusinessName}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={styles.startInput}
                        type="text"
                        placeholder="사업장 이름 입력"
                        value={startBizNew}
                        onChange={(e) => setStartBizNew(e.target.value)}
                      />
                    )}
                    <button
                      className={styles.startToggleBtn}
                      onClick={() => setStartBizMode(startBizMode === "select" ? "new" : "select")}
                    >
                      {startBizMode === "select" ? "직접 입력" : "목록 선택"}
                    </button>
                  </div>
                </div>
                <div className={styles.startRow}>
                  <span className={styles.startLabel}>층 <span className={styles.startRequired}>*</span></span>
                  <div className={styles.startField}>
                    {startFloorMode === "select" ? (
                      <select
                        className={styles.startSelect}
                        value={startFloorId}
                        onChange={(e) => setStartFloorId(Number(e.target.value))}
                      >
                        <option value="">층 선택</option>
                        {startAreas.map((a) => (
                          <option key={a.id} value={a.id}>{a.FloorName}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={styles.startInput}
                        type="text"
                        placeholder="예: B1, 1F, 2F"
                        value={startFloorNew}
                        onChange={(e) => setStartFloorNew(e.target.value)}
                      />
                    )}
                    <button
                      className={styles.startToggleBtn}
                      onClick={() => setStartFloorMode(startFloorMode === "select" ? "new" : "select")}
                    >
                      {startFloorMode === "select" ? "직접 입력" : "목록 선택"}
                    </button>
                  </div>
                </div>
              </div>

              {/* 영역 섹션 */}
              <div className={styles.startSection}>
                <div className={styles.startSectionTitle}>
                  <span>영역 정보</span>
                  <div className={styles.startSectionLine} />
                </div>
                <div className={styles.startRow}>
                  <span className={styles.startLabel}>영역 이름 <span className={styles.startRequired}>*</span></span>
                  <div className={styles.startField}>
                    <input
                      className={styles.startInput}
                      type="text"
                      placeholder="영역 이름을 입력하세요"
                      value={startAreaName}
                      onChange={(e) => {
                        setStartAreaName(e.target.value);
                        setStartAreaChecked(null);
                      }}
                    />
                    <button
                      className={styles.startCheckBtn}
                      onClick={handleCheckAreaName}
                      disabled={!startAreaName.trim()}
                    >
                      중복 체크
                    </button>
                  </div>
                </div>
                {startAreaChecked === true && (
                  <div className={styles.startFieldMsg}>
                    <span className={styles.checkOk}>사용 가능한 이름입니다.</span>
                  </div>
                )}
                {startAreaChecked === false && (
                  <div className={styles.startFieldMsg}>
                    <span className={styles.checkFail}>이미 사용 중인 이름입니다.</span>
                  </div>
                )}
              </div>
            </div>

            {/* 푸터 */}
            <div className={styles.startFooter}>
              <button className={styles.startFooterBtn + " " + styles.startBtnCancel} onClick={() => setMappingState("idle")}>
                <img src="/icon/arrow-left.png" alt="" />
                취소
              </button>
              <button
                className={styles.startFooterBtn + " " + styles.startBtnConfirm}
                onClick={handleConfirmMappingStart}
                disabled={startAreaChecked !== true}
              >
                맵핑 시작
                <img src="/icon/arrow-right.png" alt="" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 맵핑 진행 모달 ── */}
      {mappingState === "mappingModal" && (
        <div className={styles.modalOverlay}>
          <div className={styles.mappingModal}>
            {/* 로딩 오버레이 */}
            {(isMappingStarting || isMappingEnding) && (
              <div className={styles.mappingLoadingOverlay}>
                <div className={styles.mappingLoadingSpinner} />
                <span className={styles.mappingLoadingText}>
                  {isMappingStarting ? "맵핑 준비 중..." : "맵 생성 중..."}
                </span>
              </div>
            )}

            {/* 좌측: 맵 시각화 */}
            <div className={styles.mappingModalLeft}>
              <div className={styles.mappingModalCanvas}>
                <canvas ref={mappingCanvasRef} className={styles.mappingCanvasEl} />
              </div>
            </div>

            {/* 우측: 정보 + 컨트롤 */}
            <div className={styles.mappingModalRight}>
              <div className={styles.mappingModalTitle}>맵핑</div>

              {/* 상태 표시 */}
              <div className={styles.mappingStatusSection}>
                <div className={styles.mappingStatusRow}>
                  <span className={styles.mappingStatusLabel}>상태</span>
                  <span className={`${styles.mappingStatusValue} ${isMappingRunning ? styles.statusRunning : styles.statusStopped}`}>
                    {isMappingRunning ? "진행 중" : "대기"}
                  </span>
                </div>
                <div className={styles.mappingStatusRow}>
                  <span className={styles.mappingStatusLabel}>영역</span>
                  <span className={styles.mappingStatusValue}>{saveAreaName}</span>
                </div>
              </div>

              {/* 맵핑 인디케이터 */}
              {isMappingRunning && (
                <div className={styles.mappingIndicator}>
                  <div className={styles.mappingPulse} />
                  <span>맵핑 데이터 수집 중...</span>
                </div>
              )}

              {/* 컨트롤 버튼 */}
              <div className={styles.mappingControls}>
                <button
                  className={`${styles.mappingCtrlBtn} ${styles.mappingCtrlStart}`}
                  onClick={handleMappingRun}
                  disabled={isMappingRunning}
                >
                  시작
                </button>
                <button
                  className={`${styles.mappingCtrlBtn} ${styles.mappingCtrlEnd}`}
                  onClick={handleMappingEnd}
                  disabled={isMappingEnding}
                >
                  종료
                </button>
              </div>

              <button
                className={styles.mappingCancelBtn}
                onClick={async () => {
                  await apiFetch(`/map/mapping/cancel`, { method: "POST" }).catch(() => {});
                  setIsMappingRunning(false);
                  setMappingState("idle");
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 성공 팝업 ── */}
      {mappingState === "success" && (
        <div className={styles.modalOverlay}>
          <div className={styles.successPopup}>
            <div className={styles.successIcon}>&#10003;</div>
            <div className={styles.successText}>
              성공적으로 맵이 저장되었습니다.
            </div>
            <button className={styles.btnConfirm} onClick={handleSuccessConfirm}>
              확인
            </button>
          </div>
        </div>
      )}

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
                  setSaveAreaId("");
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
                value={saveAreaId}
                onChange={(e) => setSaveAreaId(Number(e.target.value))}
              >
                <option value="">층 선택</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.FloorName}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>영역 이름</label>
              <input
                type="text"
                placeholder="영역 이름을 입력하세요"
                value={saveAreaName}
                onChange={(e) => setSaveAreaName(e.target.value)}
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
      {showRobotModal && (
        <div className={styles.startOverlay} onClick={() => setShowRobotModal(false)}>
          <div className={styles.robotModal} onClick={(e) => e.stopPropagation()}>
            {/* 헤더 */}
            <div className={styles.startHeader}>
              <div className={styles.startHeaderLeft}>
                <img src="/icon/robot_w.png" alt="" />
                <h2>로봇 연결</h2>
              </div>
              <button className={styles.startCloseBtn} onClick={() => setShowRobotModal(false)}>
                &times;
              </button>
            </div>

            {/* 본문 */}
            <div className={styles.robotBody}>
              {connectedRobot && (
                <div className={styles.robotConnectedBanner}>
                  <span className={styles.robotConnectedDot} />
                  <span>현재 연결: <strong>{connectedRobot.RobotName}</strong></span>
                </div>
              )}

              <div className={styles.startSection}>
                <div className={styles.startSectionTitle}>
                  <span>로봇 목록</span>
                  <div className={styles.startSectionLine} />
                </div>

                {robots.length === 0 ? (
                  <div className={styles.robotEmptyMsg}>등록된 로봇이 없습니다.</div>
                ) : (
                  <div className={styles.robotList}>
                    {robots.map((robot) => (
                      <button
                        key={robot.id}
                        className={`${styles.robotItem} ${connectedRobot?.id === robot.id ? styles.robotItemActive : ""}`}
                        onClick={() => handleConnectRobot(robot)}
                      >
                        <div className={styles.robotItemLeft}>
                          <img src="/icon/robot_icon(1).png" alt="" className={styles.robotItemIcon} />
                          <div>
                            <div className={styles.robotItemName}>{robot.RobotName}</div>
                            <div className={styles.robotItemInfo}>
                              {robot.ModelName && <span>{robot.ModelName}</span>}
                              {robot.SerialNumber && <span>SN: {robot.SerialNumber}</span>}
                            </div>
                          </div>
                        </div>
                        {connectedRobot?.id === robot.id && (
                          <span className={styles.robotItemBadge}>연결됨</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 푸터 */}
            <div className={styles.startFooter}>
              <button className={styles.startFooterBtn + " " + styles.startBtnCancel} onClick={() => setShowRobotModal(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── 동기화 모달 ── */}
      {showSyncModal && (
        <div className={styles.startOverlay} onClick={() => setShowSyncModal(false)}>
          <div className={styles.robotModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.startHeader}>
              <div className={styles.startHeaderLeft}>
                <img src="/icon/map_d.png" alt="" />
                <h2>맵 동기화</h2>
              </div>
              <button className={styles.startCloseBtn} onClick={() => setShowSyncModal(false)}>
                &times;
              </button>
            </div>

            <div className={styles.robotBody}>
              <div className={styles.startSection}>
                <div className={styles.startSectionTitle}>
                  <span>동기화할 로봇 선택</span>
                  <div className={styles.startSectionLine} />
                </div>

                {syncRobots.length === 0 ? (
                  <div className={styles.robotEmptyMsg}>등록된 로봇이 없습니다.</div>
                ) : (
                  <div className={styles.robotList}>
                    {syncRobots.map((robot) => (
                      <button
                        key={robot.id}
                        className={styles.robotItem}
                        onClick={() => handleSyncRobot(robot)}
                      >
                        <div className={styles.robotItemLeft}>
                          <img src="/icon/robot_icon(1).png" alt="" className={styles.robotItemIcon} />
                          <div>
                            <div className={styles.robotItemName}>{robot.RobotName}</div>
                            <div className={styles.robotItemInfo}>
                              {robot.ModelName && <span>{robot.ModelName}</span>}
                              {robot.SerialNumber && <span>SN: {robot.SerialNumber}</span>}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.startFooter}>
              <button className={styles.startFooterBtn + " " + styles.startBtnCancel} onClick={() => setShowSyncModal(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

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
          defaultRobotName={connectedRobot?.RobotName ?? ""}
          defaultFloor={
            selectedFloor !== ""
              ? areas.find((a) => a.id === selectedFloor)?.FloorName ?? ""
              : ""
          }
          lockCoords={isFromRobotPos}
          defaultYaw={isFromRobotPos && robotPos ? robotPos.yaw : undefined}
          onClose={() => {
            setShowPlaceModal(false);
            setPlaceClickCoords(null);
            setIsFromRobotPos(false);
          }}
          onConfirm={(place) => {
            setPendingPlaces((prev) => [...prev, place]);
            setUndoStack((prev) => [...prev, { type: "addPlace", tempId: place.tempId }]);
            if (isRouteMode && routeStartName) {
              setRouteEndName(place.LacationName);
            }
            setShowPlaceModal(false);
            setPlaceClickCoords(null);
            setIsFromRobotPos(false);
          }}
        />
      )}



    </div>
  );
}
