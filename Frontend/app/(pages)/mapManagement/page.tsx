"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "./mapManagement.module.css";
import PlaceList from "@/app/(pages)/schedules/components/PlaceList";
import PathList from "@/app/(pages)/schedules/components/PathList";
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
    { id: "1", label: "B2" },
    { id: "2", label: "B1" },
    { id: "3", label: "1F" },
    { id: "4", label: "2F" },
    { id: "5", label: "3F" },
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
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsPanning(true);
    panStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setOffset({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  };
  const handleMouseUp = () => setIsPanning(false);

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
            <button className={styles.toolbarBtn}>저장</button>
            <button className={styles.toolbarBtn} onClick={handleOpenSyncModal}>동기화</button>
            <button className={styles.toolbarBtn}>위치재조정</button>
            <button className={styles.toolbarBtn}>삭제</button>
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
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom}) rotate(${rotation})`}>
                  <image
                    href={processedImg.url}
                    x={-processedImg.w / 2}
                    y={-processedImg.h / 2}
                    width={processedImg.w}
                    height={processedImg.h}
                  />
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

          </div>

          {/* 격자 버튼 (좌측 상단 모서리) */}
          <button className={styles.gridBtn}>
            <span>&#9638;</span>
          </button>

          {/* 상단 가로 도구바 (오버레이) */}
          <div className={styles.topTools}>
            <button className={styles.topToolBtn}>
              <span className={styles.topToolIcon}>&#8634;</span>
              <span>되돌리기</span>
            </button>
            <button className={styles.topToolBtn}>
              <span className={styles.topToolIcon}>&#9733;</span>
              <span>충전소 생성</span>
            </button>
            <button className={styles.topToolBtn}>
              <span className={styles.topToolIcon}>&#9673;</span>
              <span>현 위치에서 장소 생성</span>
            </button>
          </div>

          {/* 좌측 세로 도구 (오버레이) */}
          <div className={styles.leftTools}>
            <button className={styles.toolBtn}>
              <img src="/icon/path_way.png" alt="경로" className={styles.toolBtnImg} />
              <span>경로</span>
            </button>
            <button className={styles.toolBtn}>
              <img src="/icon/place_point.png" alt="장소" className={styles.toolBtnImg} />
              <span>장소</span>
            </button>
            <button className={styles.toolBtn}>
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
              <div className={styles.panelTitle}>맵 편집</div>

              <div className={styles.mappingBtns}>
                <button
                  className={`${styles.btnMapping} ${styles.btnMappingStart}`}
                  onClick={handleMappingStart}
                >
                  맵핑 시작
                </button>
                <button
                  className={`${styles.btnMapping} ${styles.btnMappingReset}`}
                >
                  맵 초기화
                </button>
              </div>
            </div>
          </div>
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
    </div>
  );
}
