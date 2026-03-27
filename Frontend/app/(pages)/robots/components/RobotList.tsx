"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from "next/navigation";
import styles from './RobotList.module.css';
import Pagination from "@/app/components/pagination";
import type { RobotRowData, BatteryItem, Camera, Floor, Video, NetworkItem, PowerItem, LocationItem } from '@/app/type';
import { RobotCrudBtn } from "@/app/components/button";
import CameraViews from './CameraView';
import MapView from './MapView';
import RobotDetailModal from "@/app/components/modal/RobotDetailModal";
import RobotWorkScheduleModal from "@/app/components/modal/WorkScheduleModal";
import type { WorkScheduleCase } from "@/app/components/modal/WorkScheduleModal";
import PlacePathModal from "@/app/components/modal/PlacePathModal";
import BatteryPathModal from "@/app/components/modal/BatteryChargeModal";
import PathMoveModal from "@/app/components/modal/PathMoveModal";
import type { PlaceRow } from "@/app/mock/robotPlace_data";
import { mockPathRows } from "@/app/mock/robotPath_data";
import PlaceCrudModal, { type PlaceRowData } from "./PlaceCrudModal";
import PlaceDeleteConfirmModal from "./PlaceDeleteConfirmModal";
import PlaceMapView from "./PlaceMapView";
import PathMapView from "./PathMapView";
import PathCrudModal from "@/app/(pages)/robots/components/PathCrudModal";
import PathDeleteConfirmModal from "@/app/(pages)/robots/components/PathDeleteConfirmModal";
import { getApiBase } from "@/app/config";
import PathAlertsModal from "@/app/(pages)/robots/components/PathAlertsModal";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import {
  getBatteryIcon,
  getNetworkIcon,
  getPowerIcon,
  ROBOT_COLORS,
  getRobotIndexFromNo,
  buildRobotIconPath,
} from "@/app/constants/robotIcons";

// ── 경로 API 엔드포인트 (차후 백엔드 변경 시 여기만 수정) ──
const PATH_API = {
  LIST: `${getApiBase()}/DB/getpath`,
  CREATE: `${getApiBase()}/DB/path`,
  UPDATE: (id: number) => `${getApiBase()}/DB/path/${id}`,
  DELETE: (id: number) => `${getApiBase()}/DB/path/${id}`,
};
import type { FilterOption } from "@/app/components/button/FilterSelectBox";
import { useRobotStatus } from "@/app/hooks/useRobotStatus";

type FixedScrollbarArgs = {
  enabled: boolean;
  scrollRef: React.RefObject<HTMLElement | null>;
  trackRef: React.RefObject<HTMLElement | null>;
  thumbRef: React.RefObject<HTMLElement | null>;
  thumbHeight?: number;
  deps?: any[];
};

const robotTypes = ["task1", "task2", "task3"];

const parseUpdatedAt = (value: string) => {
  const trimmed = value.trim();
  const m = trimmed.match(
    /^(\d{4})\.(\d{2})\.(\d{2})\s+(오전|오후)\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const dd = Number(m[3]);
    const ampm = m[4];
    let hh = Number(m[5]);
    const mi = Number(m[6]);
    const ss = Number(m[7]);
    if (ampm === "오전") {
      if (hh === 12) hh = 0;
    } else {
      if (hh !== 12) hh += 12;
    }
    return new Date(yyyy, mm, dd, hh, mi, ss).getTime();
  }

  const fallback = Date.parse(trimmed.replace(/\./g, "-"));
  return Number.isNaN(fallback) ? 0 : fallback;
};

const useFixedSelectScrollbar = ({
  enabled,
  scrollRef,
  trackRef,
  thumbRef,
  thumbHeight = 30,
  deps = [],
}: FixedScrollbarArgs) => {
  useEffect(() => {
    if (!enabled) return;

    const scrollEl = scrollRef.current;
    const trackEl = trackRef.current;
    const thumbEl = thumbRef.current;
    if (!scrollEl || !trackEl || !thumbEl) return;

    const resizeThumb = () => {
      const h = Math.min(thumbHeight, trackEl.clientHeight);
      thumbEl.style.height = `${h}px`;
      thumbEl.style.opacity =
        scrollEl.scrollHeight > scrollEl.clientHeight ? "1" : "0";
    };

    const syncThumb = () => {
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      const maxTop = trackEl.clientHeight - thumbEl.clientHeight;

      if (maxScroll <= 0) {
        thumbEl.style.top = "0px";
        return;
      }

      const ratio = scrollEl.scrollTop / maxScroll;
      thumbEl.style.top = `${ratio * maxTop}px`;
    };

    resizeThumb();
    syncThumb();

    scrollEl.addEventListener("scroll", syncThumb);
    window.addEventListener("resize", resizeThumb);

    const ro = new ResizeObserver(() => {
      resizeThumb();
      syncThumb();
    });
    ro.observe(scrollEl);
    ro.observe(trackEl);

    return () => {
      scrollEl.removeEventListener("scroll", syncThumb);
      window.removeEventListener("resize", resizeThumb);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, thumbHeight, ...deps]);
};

const ROBOT_PAGE_SIZE  = 6;
const PLACE_PAGE_SIZE = 6;
const PATH_PAGE_SIZE  = 6;

interface RobotStats {
  total: number;
  operating: number;
  standby: number;
  discharged: number;
  charging: number;
}

interface RobotStatusListProps {
  cameras: Camera[];
  robots: RobotRowData[];
  floors: Floor[];
  video: Video[];
  batteryStatus: BatteryItem[];
  networkStatus: NetworkItem[];
  powerStatus: PowerItem[];
  locationStatus: LocationItem[];
  robotStats: RobotStats;
}

export type RobotDraft = {
  operator: string;
  serialNumber: string;
  model: string;
  group: string;
  softwareVersion: string;
  site: string;
  registrationDateTime: string;
  returnBattery: number;
};

export type PlaceItem = {
    id: number;
    robotNo: string;
    cameraNo: string;
}

export type PathItem = {
    id: number;
    robotNo: string;
    cameraNo: string;
}

export type PathRow = {
  id: number;
  robotNo: string;
  workType: string;
  pathName: string;
  pathOrder: string;
  updatedAt: string;
};


export default function RobotStatusList({
  cameras,
  robots: initialRobots,
  floors,
  video,
  batteryStatus,
  networkStatus,
  powerStatus,
  locationStatus,
  robotStats
}:RobotStatusListProps) {

  const robots = useRobotStatus(initialRobots);
  const router = useRouter();

  const [robotActiveIndex, setRobotActiveIndex] = useState<number>(0);
  
  const [robotsActiveIndex, setRobotsActiveIndex] = useState<number>(0);
  const [batteryActiveIndex, setBatteryActiveIndex] = useState<number>(0);
  const [networkActiveIndex, setNetworkActiveIndex] = useState<number>(0);
  const [powerActiveIndex, setPowerActiveIndex] = useState<number>(0);
  const [locationActiveIndex, setLocationActiveIndex] = useState<number>(0);

  //체크된 로봇 id 리스트
  const [showConfirm, setShowConfirm] = useState(false);
  const [checkedRobotIds, setCheckedRobotIds] = useState<number[]>([]);
  const checkedCount = checkedRobotIds.length;

  // 정책 계산
  const isCrudDisabled = checkedCount >= 1;       // (요구1) 1개라도 체크되면 CRUD 비활성
  const isSingleChecked = checkedCount === 1;     // (요구2) 정확히 1개일 때만 활성
  const isAnyChecked = checkedCount >= 1;         // (요구3) 1개 이상이면 활성
  
  const isWorkScheduleDisabled = !isSingleChecked; // 0개 or 2개 이상 비활성
  const isPlaceMoveDisabled = !isSingleChecked;    // 0개 or 2개 이상 비활성
  const isPathMoveDisabled = !isSingleChecked;     // 0개 or 2개 이상 비활성
  const isChargeMoveDisabled = !isAnyChecked;      // 0개만 비활성

  // 경로 이동 모달용: 선택된 로봇명
  const selectedRobotNameForPathMove = isSingleChecked
    ? robots.find((r) => r.id === checkedRobotIds[0])?.no ?? ""
    : "";


  const [selectedRobots, setSelectedRobots] = useState<RobotRowData | null>(null);
  const [selectedBattery, setSelectedBattery] = useState<BatteryItem | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkItem | null>(null);
  const [selectedPower, setSelectedPower] = useState<PowerItem | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);


  const [robotDetailModalOpen, setRobotDetailModalOpen] = useState(false);
  const [robotWorkScheduleModalOpen, setRobotWorkScheduleModalOpen] = useState(false);
  const [placePathModalOpen, setPlacePathModalOpen] = useState(false);
  const [pathMoveModalOpen, setPathMoveModalOpen] = useState(false);

  const [workScheduleCase, setWorkScheduleCase] = useState<WorkScheduleCase>('none');
  const [completedPathText, setCompletedPathText] = useState<string>('');
  const [workScheduleLoading, setWorkScheduleLoading] = useState(false);
  const [workScheduleError, setWorkScheduleError] = useState<string | null>(null);

  
  // 여기 추가: 선택된 로봇 id (또는 전체 데이터)
  const [selectedRobotId, setSelectedRobotId] = useState<number | null>(null);

  // 필요하면 전체 데이터도 같이 보관
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);


  // 필터가 적용된 robots 배열
  const filteredRobots = robots.filter((robot) => {

    // 로봇명
    let matchRobots = true;
    if (selectedRobots) {
      matchRobots = robot.no === selectedRobots.no;
    }

    // 배터리 필터
    let matchBattery = true;

    const option = selectedBattery;

    if (!option) {
      matchBattery = true;
    } else if (option.charging) {
      matchBattery = robot.isCharging;
    } else if (option.min !== undefined && option.max !== undefined) {
      matchBattery =
        robot.battery >= option.min && robot.battery <= option.max;
    }

    // 네트워크
    let matchNetwork = true;
    if (selectedNetwork) {
      matchNetwork = robot.network === selectedNetwork.label;
    }

    // 전원
    let matchPower = true;
    if (selectedPower) {
      matchPower = robot.power === selectedPower.label;
    }

    // 위치 (mark: 'Yes' | 'No')
    let matchLocation = true;
    if (selectedLocation) {
      matchLocation = robot.mark === selectedLocation.label;
    }

    return matchRobots && matchBattery && matchNetwork && matchPower && matchLocation;
  });

  // 탭메뉴
  const [activeTab, setActiveTab] = useState<"robots" | "place" | "path">("robots");
  const pathname = usePathname();
  
  // 탭별 페이지 상태
  const [robotsPage, setRobotsPage] = useState(1);
  const [placePage, setPlacePage] = useState(1);
  const [pathPage, setPathPage] = useState(1);
  const handleRobotsPageChange = (page: number) => {
    setRobotsPage(page);
    setCheckedRobotIds([]);
  };
  const handlePlacePageChange = (page: number) => {
    setPlacePage(page);
    setCheckedPlaceIds([]);
    setSelectedPlaceId(null);
  };
  const handlePathPageChange = (page: number) => {
    setPathPage(page);
    setCheckedPathIds([]);
  };

  const placeData:PlaceItem[] = [];
  const pathData:PathItem[] = [];

  let currentPage: number;
  let currentData: any[]; // 필요하면 타입 좁혀도 됨

  switch (activeTab) {
    case "robots":
      currentPage = robotsPage;
      currentData = filteredRobots; // ✅ filteredRobots는 항상 배열
      break;
    case "place":
      currentPage = placePage;
      currentData = placeData;
      break;
    case "path":
      currentPage = pathPage;
      currentData = pathData;
      break;
  }

  const totalItems = currentData.length;
  const startIndex = (currentPage - 1) * ROBOT_PAGE_SIZE;
  const currentItems = currentData.slice(startIndex, startIndex + ROBOT_PAGE_SIZE);

  const handleTabClick = (tab: "robots" | "place" | "path") => {
    setActiveTab(tab);

    // 선택/체크 상태 초기화
    setSelectedRobotId(null);
    setSelectedRobot(null);
    setCheckedRobotIds([]);

    // 삭제 모드 초기화
    if (placeDeleteMode) {
      setPlaceDeleteMode(false);
      setCheckedPlaceIds([]);
    }
    if (pathDeleteMode) {
      setPathDeleteMode(false);
      setCheckedPathIds([]);
    }

    if (tab === "robots" && activeTab !== "robots") {
        setRobotsPage(1);
    } else if (tab === "place" && activeTab !== "place") {
        setPlacePage(1);
        setCheckedPlaceIds([]);
        setSelectedPlaceId(null);
    } else if (tab === "path") {
        setPathPage(1);
        setCheckedPathIds([]);
      }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "robots" || tab === "place" || tab === "path") {
      setActiveTab(tab);
      if (tab === "robots") {
        setRobotsPage(1);
      } else if (tab === "place") {
        setPlacePage(1);
      } else if (tab === "path") {
        setPathPage(1);
      }
    }
  }, []);

  // 페이지 이탈(새로고침/다른 페이지 이동) 시 장소 삭제 모드 초기화
  useEffect(() => {
    const handleBeforeUnload = () => {
      setPlaceDeleteMode(false);
      setCheckedPlaceIds([]);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // 경로 변경 시 장소 삭제 모드 초기화
  useEffect(() => {
    if (placeDeleteMode) {
      setPlaceDeleteMode(false);
      setCheckedPlaceIds([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

const getPageSetter = () => {
    switch (activeTab) {
        case "robots":
            return setRobotsPage;
        case "place":
            return setPlacePage;
        case "path":
            return setPathPage;
    }
};

const resetCurrentPage = () => {
  const setPage = getPageSetter();
  setPage?.(1);
};

  const robotInfoIcons = {
    info: (robotNo: string) => buildRobotIconPath(robotNo, "icon"),
    battery: getBatteryIcon,
    network: getNetworkIcon,
    power: getPowerIcon,
    mark: (robotNo: string) => buildRobotIconPath(robotNo, "location"),
  };

  // Location 클릭 시 실행되는 핸들러
  const handleLocationClick = (idx: number, robot: RobotRowData) => {
    setRobotActiveIndex(idx);       // row 하이라이트 줄 때 사용 가능
    setSelectedRobotId(robot.id);   // 카메라 / 맵에서 쓸 핵심 값
    setSelectedRobot(robot);        // 필요하면 전체 정보도 내려줌

    console.log("선택된 로봇 (Location 클릭):", robot.id, robot.no);
  };

  // viewInfo 클릭 시 실행되는 핸들러
  const ViewInfoClick = (idx: number, robot: RobotRowData) => {
    setRobotActiveIndex(idx);       // row 하이라이트 줄 때 사용 가능
    setSelectedRobotId(robot.id);   // 카메라 / 맵에서 쓸 핵심 값
    setSelectedRobot(robot);        // 필요하면 전체 정보도 내려줌
    setRobotDetailModalOpen(true)

    console.log("선택된 로봇 (Location 클릭):", robot.id, robot.no);
  };


  const toggleRobotChecked = (robotId: number, checked: boolean) => {
    setCheckedRobotIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, robotId]))
        : prev.filter((id) => id !== robotId);

      // 1개 체크 시 모니터링(카메라/맵) 표시
      if (next.length === 1) {
        const robot = robots.find(r => r.id === next[0]);
        setSelectedRobotId(next[0]);
        setSelectedRobot(robot ?? null);
      } else {
        setSelectedRobotId(null);
        setSelectedRobot(null);
      }

      return next;
    });
  };

  const toggleAllCurrentItems = (checked: boolean) => {
    const currentPageIds = currentItems.map((r) => r.id); // 현재 페이지 로봇 id들

    setCheckedRobotIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, ...currentPageIds]))
        : prev.filter((id) => !currentPageIds.includes(id));

      setSelectedRobotId(next.length === 1 ? next[0] : null);

      return next;
    });
  };

  const isAllCurrentItemsChecked = currentItems.length > 0 && currentItems.every((r) => checkedRobotIds.includes(r.id));

  // 작업일정 복귀 시 조건에 따라 분기 처리
  const scheduleAbortRef = useRef<AbortController | null>(null);

  const openWorkScheduleModal = async () => {
    // 이전 fetch 취소
    scheduleAbortRef.current?.abort();

    setWorkScheduleError(null);

    const targetRobotId = checkedRobotIds.length === 1 ? checkedRobotIds[0] : selectedRobotId;
    if (targetRobotId == null) {
      setWorkScheduleCase('none');
      setCompletedPathText('');
      setRobotWorkScheduleModalOpen(true);
      return;
    }

    const robotName = robots.find(r => r.id === targetRobotId)?.no ?? '';
    setWorkScheduleLoading(true);
    setRobotWorkScheduleModalOpen(true);

    const controller = new AbortController();
    scheduleAbortRef.current = controller;

    // ── 테스트용 mock 데이터 (백엔드 연결 후 이 블록 삭제) ──
    // robotName을 직접 사용하여 어떤 로봇이든 매칭되도록 처리
    const MOCK_SCHEDULES = [
      { RobotName: robotName, TaskStatus: '진행', WayName: '대기실 - 1층 복도 - A구역 - B구역 - 2층 복도 - C구역 - 대기실' },
      { RobotName: robotName, TaskStatus: '완료', WayName: '대기실 - 안내데스크 - D구역 - 대기실', EndDate: '2026-03-19T18:00:00' },
    ];
    // ── mock 끝 ──

    try {
      let robotSchedules: any[] = [];

      try {
        const res = await fetch(`${getApiBase()}/DB/schedule`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('스케줄 조회 실패');
        const schedules = await res.json();
        robotSchedules = schedules.filter((s: any) => s.RobotName === robotName);
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError') return;
        console.warn("API 실패 → mock 데이터 사용", fetchErr);
      }

      // DB에 해당 로봇 스케줄 없으면 mock으로 보충 (테스트용, 백엔드 연결 후 삭제)
      if (robotSchedules.length === 0) {
        robotSchedules = MOCK_SCHEDULES.filter(s => s.RobotName === robotName);
      }

      // 진행 중인 작업 찾기
      const ongoing = robotSchedules.find(
        (s: any) => s.TaskStatus === '진행'
      );
      if (ongoing) {
        setWorkScheduleCase('ongoing');
        setCompletedPathText(ongoing.WayName ?? '');
        return;
      }

      // 최근 완료 작업 찾기
      const completed = robotSchedules
        .filter((s: any) => s.TaskStatus === '완료')
        .sort((a: any, b: any) =>
          new Date(b.EndDate).getTime() - new Date(a.EndDate).getTime()
        );
      if (completed.length > 0) {
        setWorkScheduleCase('recent');
        setCompletedPathText(completed[0].WayName ?? '');
        return;
      }

      setWorkScheduleCase('none');
      setCompletedPathText('');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error(err);
      setWorkScheduleError('작업일정을 불러오지 못했습니다.');
      setWorkScheduleCase('none');
    } finally {
      setWorkScheduleLoading(false);
    }
  };

  const handleSendLogOk = () => {
    // ✅ 여기서 checkedRobotIds를 사용해서 전송
    console.log("충전소 이동 robots:", checkedRobotIds);

    // TODO: API/WS 호출 (checkedRobotIds 전체 대상)

    setShowConfirm(false);

    // 선택을 유지할지/초기화할지 정책 결정:
    // setCheckedRobotIds([]); // 필요 시 초기화
  };

  const handleSendLogCancel = () => {
    setShowConfirm(false);
  };

   // 장소관리
  const [placeRows, setPlaceRows] = useState<PlaceRow[]>([]);

  const [selectedPlaceRobot, setSelectedPlaceRobot] = useState<string | null>(null); // null=Total
  const [selectedPlaceFloor, setSelectedPlaceFloor] = useState<string | null>(null); // null=Total
  const [selectedPlaceId, setSelectedPlaceId] = useState<number | null>(null);

  // ✅ 로봇 탭 checkedRobotIds와 동일 패턴
  const [checkedPlaceIds, setCheckedPlaceIds] = useState<number[]>([]);
  const placeCheckedCount = checkedPlaceIds.length;

  // ✅ 조건4 정책 (요구대로)
  const isPlaceCreateEnabled = placeCheckedCount === 0;
  const isPlaceEditEnabled = placeCheckedCount === 1;
  const isPlaceDeleteEnabled = placeCheckedCount >= 1;

  // ✅ 체크 1개일 때만 선택 장소(단일) 계산
  const singleCheckedPlaceRow = useMemo(() => {
    if (checkedPlaceIds.length !== 1) return null;
    const id = checkedPlaceIds[0];
    return placeRows.find((r) => r.id === id) ?? null;
  }, [checkedPlaceIds, placeRows]);

  const [places, setPlaces] = useState<PlaceRowData[]>([
    {
      id: 1,
      robotNo: "Robot 1",
      floor: "1F",
      name: "병원대기 2",
      x: "62.2803218070417",
      y: "51.71609980765794",
      direction: "0",
      desc: "대학병원 대기공간",
      updatedAt: "2025.12.12 오전 10:35:47",
    },
  ]);

  const placeRobotOptions = useMemo(() => {
    const set = new Set(robots.map((r) => r.no));
    return Array.from(set);
  }, [robots]);

  const placeFloorOptions = useMemo(() => {
    const set = new Set(floors.map((f) => f.label));
    // 층 정렬(원하면 커스텀)
    return Array.from(set);
  }, [floors]);


  const fetchPlaces = async () => {
    try {
      const res = await fetch(`${getApiBase()}/DB/places`);
      const data = await res.json();
      const mapped: PlaceRow[] = data.map((p: any) => ({
        id: p.id,
        robotNo: p.RobotName ?? "",
        floor: p.Floor ?? "",
        placeName: p.LacationName ?? "",
        x: p.LocationX ?? 0,
        y: p.LocationY ?? 0,
        direction: p.LocationDir ?? 0,
        updatedAt: p.UpdatedAt
          ? new Date(p.UpdatedAt).toLocaleString("ko-KR")
          : "",
      }));
      setPlaceRows(mapped);
    } catch (e) {
      console.error("장소 목록 로드 실패", e);
      setPlaceRows([]);
    }
  };

  useEffect(() => {
    if (activeTab !== "place" && activeTab !== "path") return;
    fetchPlaces();
  }, [activeTab]);


  const toPlaceRowData = (row: PlaceRow): PlaceRowData => ({
    id: row.id,
    robotNo: row.robotNo,
    floor: row.floor,
    name: row.placeName,
    x: String(row.x),
    y: String(row.y),
    direction: String(row.direction ?? 0),
    desc: "",
    updatedAt: row.updatedAt,
  });

  // place 탭 데이터 필터
  const filteredPlaceRows = useMemo(() => {
    return placeRows
      .filter((r) => {
        const robotOk = !selectedPlaceRobot || r.robotNo === selectedPlaceRobot;
        const floorOk = !selectedPlaceFloor || r.floor === selectedPlaceFloor;
        return robotOk && floorOk;
      })
      // .sort((a, b) => {
      //   return parseUpdatedAt(b.updatedAt) - parseUpdatedAt(a.updatedAt);
      // });
  }, [placeRows, selectedPlaceRobot, selectedPlaceFloor]);

  const selectedPlaceRow = useMemo(() => {
    if (selectedPlaceId == null) return null;
    return filteredPlaceRows.find(r => r.id === selectedPlaceId) ?? null;
  }, [selectedPlaceId, filteredPlaceRows]);

  const selectedPlace = useMemo(
    () => places.find((p) => p.id === selectedPlaceId) ?? null,
    [places, selectedPlaceId]
  );

  // 삭제 모드
  const [placeDeleteMode, setPlaceDeleteMode] = useState(false);

  // 모달 open/close
  const [placeCreateOpen, setPlaceCreateOpen] = useState(false);
  const [placeEditOpen, setPlaceEditOpen] = useState(false);
  const [placeDeleteConfirmOpen, setPlaceDeleteConfirmOpen] = useState(false);

  const FLOORS = ["B1", "1F", "2F", "3F", "4F"];

  const openPlaceCreate = () => {
    if (!isPlaceCreateEnabled) return;
    setPlaceCreateOpen(true);
  };

  const openPlaceEdit = () => {
    if (!isPlaceEditEnabled) {return;}
    setPlaceEditOpen(true);
  };

  const openPlaceDelete = () => {
    if (!isPlaceDeleteEnabled) {return;}
    setPlaceDeleteConfirmOpen(true);
  };

  const upsertPlace = (payload: PlaceRowData) => {
    console.log(payload);
    const nextRow: PlaceRow = {
      id: payload.id,
      robotNo: payload.robotNo,
      floor: payload.floor,
      placeName: payload.name,
      x: Number(payload.x),
      y: Number(payload.y),
      direction: Number(payload.direction ?? 0),
      updatedAt: payload.updatedAt,
    };

    setPlaceRows((prev) => {
      const exists = prev.some((p) => p.id === nextRow.id);
      if (exists) return prev.map((p) => (p.id === nextRow.id ? nextRow : p));
      return [nextRow, ...prev];
    });

    // 수정/등록 후 선택 정책(원하면 1건만 선택 상태로)
    setCheckedPlaceIds([nextRow.id]);

    setPlaceCreateOpen(false);
    setPlaceEditOpen(false);
  };

  const confirmDeletePlace = async () => {
    if (checkedPlaceIds.length === 0) return;

    try {
      await Promise.all(
        checkedPlaceIds.map((id) =>
          fetch(`${getApiBase()}/DB/places/${id}`, { method: "DELETE" })
        )
      );
    } catch (err) {
      console.error("장소 삭제 실패:", err);
    }

    const del = new Set(checkedPlaceIds);
    setPlaceRows((prev) => prev.filter((p) => !del.has(p.id)));
    setCheckedPlaceIds([]);
    setPlaceDeleteConfirmOpen(false);
    setPlaceDeleteMode(false);
  };

  const placeTotalItems = filteredPlaceRows.length;
  const placeStartIndex = (placePage - 1) * PLACE_PAGE_SIZE;
  const currentPlaceItems = filteredPlaceRows.slice(
    placeStartIndex,
    placeStartIndex + PLACE_PAGE_SIZE
  );

  const selectPlace = (placeId: number) => {
    if (selectedPlaceId === placeId) {
      setSelectedPlaceId(null);
      setCheckedPlaceIds([]);
    } else {
      setSelectedPlaceId(placeId);
      setCheckedPlaceIds([placeId]);
    }
  };

  // 삭제 모드 다중 선택
  const toggleDeleteCheck = (placeId: number, checked: boolean) => {
    setCheckedPlaceIds((prev) =>
      checked
        ? Array.from(new Set([...prev, placeId]))
        : prev.filter((id) => id !== placeId)
    );
  };

  const toggleDeleteCheckAll = (checked: boolean) => {
    const ids = currentPlaceItems.map((r) => r.id);
    setCheckedPlaceIds((prev) =>
      checked
        ? Array.from(new Set([...prev, ...ids]))
        : prev.filter((id) => !ids.includes(id))
    );
  };

  const isAllDeleteChecked =
    currentPlaceItems.length > 0 &&
    currentPlaceItems.every((r) => checkedPlaceIds.includes(r.id));

  const enterDeleteMode = () => {
    setPlaceDeleteMode(true);
    setCheckedPlaceIds([]);
    setSelectedPlaceId(null);
  };

  const exitDeleteMode = () => {
    setPlaceDeleteMode(false);
    setCheckedPlaceIds([]);
  };

  // =========================
  // 경로 관리 (Path)
  // =========================
  const [pathRows, setPathRows] = useState<PathRow[]>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathAlertMessage, setPathAlertMessage] = useState<string | null>(null);
  const [selectedPathId, setSelectedPathId] = useState<number | null>(null);

  const [selectedPathRobot, setSelectedPathRobot] = useState<string | null>(null);   // null=Total
  const [selectedPathWorkType, setSelectedPathWorkType] = useState<string | null>(null); // null=Total

  const [checkedPathIds, setCheckedPathIds] = useState<number[]>([]);
  const pathCheckedCount = checkedPathIds.length;
  const [pathDeleteMode, setPathDeleteMode] = useState(false);

  // 버튼 정책 (장소 목록과 동일 패턴)
  // - 등록: 항상 활성
  // - 수정: 행 1개 선택(selectedPathId) 시 활성
  // - 삭제: 삭제 모드 진입 후 체크 1개 이상 시 활성
  const isPathCreateEnabled = true;
  const isPathEditEnabled = !!selectedPathId;
  const isPathDeleteEnabled = pathDeleteMode && pathCheckedCount >= 1;

  // 옵션 리스트
  const pathRobotOptions = useMemo(() => {
    const set = new Set(robots.map(r => r.no));
    return Array.from(set);
  }, [robots]);

  const pathWorkTypeOptions = useMemo(() => {
    const set = new Set(robotTypes);
    return Array.from(set);
  }, [robotTypes]);


  // 필터 적용 + 최신순 정렬
  const filteredPathRows = useMemo(() => {
    return pathRows
      .filter((r) => {
        const robotOk = !selectedPathRobot || r.robotNo === selectedPathRobot;
        const typeOk = !selectedPathWorkType || r.workType === selectedPathWorkType;
        return robotOk && typeOk;
      })
      .sort((a, b) => {
        const ta = new Date(a.updatedAt).getTime() || 0;
        const tb = new Date(b.updatedAt).getTime() || 0;
        return tb - ta;
      });
  }, [pathRows, selectedPathRobot, selectedPathWorkType]);

  // 페이지 데이터
  const pathTotalItems = filteredPathRows.length;
  const pathStartIndex = (pathPage - 1) * PATH_PAGE_SIZE;
  const currentPathItems = filteredPathRows.slice(pathStartIndex, pathStartIndex + PATH_PAGE_SIZE);

  // 선택된 경로 (행 클릭으로 지도 미리보기용)
  const selectedPathRow = useMemo(() => {
    if (selectedPathId == null) return null;
    return pathRows.find((r) => r.id === selectedPathId) ?? null;
  }, [selectedPathId, pathRows]);


  // 체크 토글
  const togglePathChecked = (pathId: number, checked: boolean) => {
    setCheckedPathIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, pathId]))
        : prev.filter((id) => id !== pathId);
      return next;
    });
  };

  const toggleAllCurrentPathItems = (checked: boolean) => {
    const currentPageIds = currentPathItems.map((r) => r.id);

    setCheckedPathIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, ...currentPageIds]))
        : prev.filter((id) => !currentPageIds.includes(id));
      return next;
    });
  };  // ✅ 행 선택(selectedPathId) 기준 수정용 단일 row
  const singleCheckedPathRow = useMemo(() => {
    if (selectedPathId == null) return null;
    return pathRows.find((r) => r.id === selectedPathId) ?? null;
  }, [selectedPathId, pathRows]);

  // ✅ 모달 상태
  const [pathCreateOpen, setPathCreateOpen] = useState(false);
  const [pathEditOpen, setPathEditOpen] = useState(false);
  const [pathDeleteConfirmOpen, setPathDeleteConfirmOpen] = useState(false);

  const fetchPathsFromDB = async () => {
    setPathLoading(true);
    try {
      const res = await fetch(PATH_API.LIST);
      if (!res.ok) throw new Error("경로 목록 조회 실패");

      const data = await res.json();

      const mapped: PathRow[] = data.map((p: any) => ({
        id: p.id,
        robotNo: p.RobotName,
        workType: p.TaskType,
        pathName: p.WayName,
        pathOrder: p.WayPoints,
        updatedAt: p.UpdateTime
        ? new Date(p.UpdateTime).toLocaleString("ko-KR")
        : "-",
      }));

      setPathRows(mapped);
    } catch (err) {
      console.error("경로 목록 로드 실패", err);
    } finally {
      setPathLoading(false);
    }
  };

  // ✅ 등록/수정 저장 (차후 PUT 엔드포인트 추가 시 method 분기 자동 적용)
  const savePathToDB = async (payload: {
    id?: number;
    robotNo: string;
    workType: string;
    pathName: string;
    pathOrder: string;
  }) => {
    setPathLoading(true);
    try {
      const isEdit = payload.id != null;
      const url = isEdit ? PATH_API.UPDATE(payload.id!) : PATH_API.CREATE;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RobotName: payload.robotNo,
          TaskType: payload.workType,
          WayName: payload.pathName,
          WayPoints: payload.pathOrder,
        }),
      });

      if (!res.ok) throw new Error("경로 저장 실패");

      await fetchPathsFromDB();

      setCheckedPathIds([]);
      setSelectedPathId(null);
      setPathPage(1);

    } catch (err) {
      console.error("경로 DB 저장 실패", err);
      throw err; // 모달에서 에러를 처리하도록 re-throw
    } finally {
      setPathLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "path") return;
    fetchPathsFromDB();
  }, [activeTab]);

  // 경로 이동 모달 열릴 때 pathRows가 비어있으면 자동 fetch
  useEffect(() => {
    if (pathMoveModalOpen && pathRows.length === 0) {
      fetchPathsFromDB();
    }
  }, [pathMoveModalOpen]);

  const confirmDeletePath = async () => {
    if (checkedPathIds.length === 0) return;
    setPathLoading(true);
    try {
      await Promise.all(
        checkedPathIds.map((id) =>
          fetch(PATH_API.DELETE(id), { method: "DELETE" })
        )
      );

      const del = new Set(checkedPathIds);
      setPathRows((prev) => prev.filter((p) => !del.has(p.id)));

      // 삭제 후 페이지네이션 보정
      const remaining = filteredPathRows.length - del.size;
      const maxPage = Math.max(1, Math.ceil(remaining / PATH_PAGE_SIZE));
      if (pathPage > maxPage) setPathPage(maxPage);

      setCheckedPathIds([]);
      setSelectedPathId(null);
      setPathDeleteConfirmOpen(false);

      await fetchPathsFromDB();
    } catch (err) {
      console.error("경로 삭제 실패", err);
      setPathAlertMessage("경로 삭제에 실패했습니다.");
    } finally {
      setPathLoading(false);
    }
  };

  // ✅ 버튼 핸들러 교체
  const openPathCreate = () => {
    if (!isPathCreateEnabled) return;
    if (placeRows.length === 0) fetchPlaces();
    setPathCreateOpen(true);
  };

  const openPathEdit = () => {
    if (!isPathEditEnabled) return;
    if (placeRows.length === 0) fetchPlaces();
    setPathEditOpen(true);
  };

  const openPathDelete = () => {
    if (!isPathDeleteEnabled) return;
    setPathDeleteConfirmOpen(true);
  };

  const isAllCurrentPathItemsChecked =
    currentPathItems.length > 0 && currentPathItems.every((r) => checkedPathIds.includes(r.id));

  // 필터 변경 시 페이지/체크/선택 초기화
  const resetPathSelection = () => {
    setCheckedPathIds([]);
    setSelectedPathId(null);
    setPathPage(1);
  };




  return (
    <>

    <div className="page-header-tab">
        <h1>로봇 관리</h1>
        <div className={styles.robotListTab}>
            <div className={`${activeTab === "robots" ? styles.active : ""}`} onClick={() => handleTabClick("robots")}>로봇 목록</div>
            <div className={`${activeTab === "place" ? styles.active : ""}`} onClick={() => handleTabClick("place")}>장소 목록</div>
            <div className={`${activeTab === "path" ? styles.active : ""}`} onClick={() => handleTabClick("path")}>경로 목록</div>
        </div>
    </div>

    {activeTab === "robots" && (
    <div className={styles.RobotListTab}>
      <div className={styles.RobotStatusList}>
        <div className={styles.RobotStatusTopPosition}>
            <h2>로봇 목록</h2>
            <div className={styles.RobotSearch}>
              {/* 로봇 검색 필터 */}
              <FilterSelectBox
                items={robots.map(r => ({ id: r.id, label: r.no }))}
                selectedLabel={selectedRobots?.no ?? null}
                placeholder="로봇명"
                showTotal={robots.length > 0}
                width={170}
                onSelect={(item) => {
                  if (item) {
                    const robot = robots.find(r => r.no === item.label);
                    if (robot) { setRobotsActiveIndex(robots.indexOf(robot)); setSelectedRobots(robot); }
                  } else {
                    setRobotsActiveIndex(-1); setSelectedRobots(null);
                  }
                  resetCurrentPage();
                }}
              />

              {/* 배터리 검색 필터 */}
              <FilterSelectBox
                items={batteryStatus.map(b => ({ id: b.id, label: b.label }))}
                selectedLabel={selectedBattery?.label ?? null}
                placeholder="배터리"
                width={145}
                onSelect={(item) => {
                  if (item) {
                    const bat = batteryStatus.find(b => b.label === item.label);
                    if (bat) { setBatteryActiveIndex(batteryStatus.indexOf(bat)); setSelectedBattery(bat); }
                  } else {
                    setBatteryActiveIndex(-1); setSelectedBattery(null);
                  }
                  resetCurrentPage();
                }}
              />

              {/* 네트워크 검색 필터 */}
              <FilterSelectBox
                items={networkStatus.map(n => ({ id: n.id, label: n.label }))}
                selectedLabel={selectedNetwork?.label ?? null}
                placeholder="네트워크"
                width={110}
                onSelect={(item) => {
                  if (item) {
                    const net = networkStatus.find(n => n.label === item.label);
                    if (net) { setNetworkActiveIndex(networkStatus.indexOf(net)); setSelectedNetwork(net); }
                  } else {
                    setNetworkActiveIndex(-1); setSelectedNetwork(null);
                  }
                  resetCurrentPage();
                }}
              />

              {/* 전원 검색 필터 */}
              <FilterSelectBox
                items={powerStatus.map(p => ({ id: p.id, label: p.label }))}
                selectedLabel={selectedPower?.label ?? null}
                placeholder="전원"
                width={100}
                onSelect={(item) => {
                  if (item) {
                    const pw = powerStatus.find(p => p.label === item.label);
                    if (pw) { setPowerActiveIndex(powerStatus.indexOf(pw)); setSelectedPower(pw); }
                  } else {
                    setPowerActiveIndex(-1); setSelectedPower(null);
                  }
                  resetCurrentPage();
                }}
              />

              {/* 위치 검색 필터 */}
              <FilterSelectBox
                items={locationStatus.map(l => ({ id: l.id, label: l.label }))}
                selectedLabel={selectedLocation?.label ?? null}
                placeholder="위치"
                width={100}
                onSelect={(item) => {
                  if (item) {
                    const loc = locationStatus.find(l => l.label === item.label);
                    if (loc) { setLocationActiveIndex(locationStatus.indexOf(loc)); setSelectedLocation(loc); }
                  } else {
                    setLocationActiveIndex(-1); setSelectedLocation(null);
                  }
                  resetCurrentPage();
                }}
              />
            </div>
        </div>

        <div className={styles.statusListBox}>
          <table className={styles.status}>
            <thead>
                <tr>
                    <th>
                        <img
                          src={
                            isAllCurrentItemsChecked
                              ? "/icon/robot_chk.png"
                              : "/icon/robot_none_chk.png"
                          }
                          alt="현재 페이지 로봇 전체 선택"
                          role="button"
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={() => toggleAllCurrentItems(!isAllCurrentItemsChecked)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              toggleAllCurrentItems(!isAllCurrentItemsChecked);
                            }
                          }}
                        />
                    </th>
                    <th>로봇명</th>
                    <th>배터리 (복귀)</th>
                    <th>네트워크</th>
                    <th>전원</th>
                    <th>위치표시</th>
                    <th>정보</th>
                </tr>
            </thead>
            <tbody>
            {currentItems.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.emptyState}>표시할 로봇이 없습니다.</td>
              </tr>
            )}
            {currentItems.map((r, idx) => {
              const robotIndex = getRobotIndexFromNo(r.no);
              const robotColor = ROBOT_COLORS[robotIndex];

              return (
                <tr
                  key={r.no}
                  className={
                    checkedRobotIds.includes(r.id)
                      ? styles.selectedRow
                      : undefined
                  }
                  style={
                    {
                      "--robot-color": robotColor,
                    } as React.CSSProperties
                  }
                >
                  <td>
                      <img
                        src={
                          checkedRobotIds.includes(r.id)
                            ? "/icon/robot_chk.png"
                            : "/icon/robot_none_chk.png"
                        }
                        alt={`${r.no} 선택`}
                        role="button"
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          toggleRobotChecked(r.id, !checkedRobotIds.includes(r.id))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            toggleRobotChecked(r.id, !checkedRobotIds.includes(r.id));
                          }
                        }}
                      />
                  </td>
                  <td>
                    <div>{r.no}</div>
                  </td>
                  <td>{r.battery}% ({r.return}%)</td>
                  <td>{r.network}</td>
                  <td>{r.power}</td>
                  <td>{r.mark}</td>
                  <td>
                    <div
                      className={styles["info-box"]}
                      onClick={() => ViewInfoClick(idx, r)}
                    >
                      상세보기
                    </div>
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        </div>
        <RobotDetailModal isOpen={robotDetailModalOpen} onClose={() => setRobotDetailModalOpen(false)}  selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots} />
        <div className={styles.bottomPosition}>
            <div className={isCrudDisabled ? styles.btnDisabled : ""}
                  aria-disabled={isCrudDisabled}>
              <RobotCrudBtn />
            </div>
            <div className={styles.robotWorkBox}>
              <div className={`${styles.robotWorkCommonBtn} ${isWorkScheduleDisabled ? styles.btnDisabled : ""}`}
                onClick={() => {
                  if (isWorkScheduleDisabled) return;
                  openWorkScheduleModal();
                }}
                aria-disabled={isWorkScheduleDisabled}>
                <img src="/icon/robot_schedule_w.png" alt="" />
                작업일정 복귀
              </div>
              <div className={`${styles.robotWorkCommonBtn} ${isPlaceMoveDisabled ? styles.btnDisabled : ""}`}
                onClick={() => {
                  if (isPlaceMoveDisabled) return;
                  setPlacePathModalOpen(true);
                }}
                aria-disabled={isPlaceMoveDisabled}>
                <img src="/icon/robot_place_w.png" alt="" />
                장소 이동
              </div>
              <div className={`${styles.robotWorkCommonBtn} ${isPathMoveDisabled ? styles.btnDisabled : ""}`}
                onClick={() => {
                  if (isPathMoveDisabled) return;
                  setPathMoveModalOpen(true);
                }}
                aria-disabled={isPathMoveDisabled}>
                <img src="/icon/path_w.png" alt="" />
                경로 이동
              </div>
              <div className={`${styles.robotWorkCommonBtn} ${isChargeMoveDisabled ? styles.btnDisabled : ""}`}
                onClick={() => {
                  if (isChargeMoveDisabled) return;
                  setShowConfirm(true);
                  console.log("충전소 이동 robots:", checkedRobotIds);
                }}
                aria-disabled={isChargeMoveDisabled}>
                <img src="/icon/robot_battery_place_w.png" alt="" />
                충전소 이동
              </div>
            </div>
        </div>
        <div className={styles.pagePosition}>
          <Pagination totalItems={totalItems} currentPage={currentPage} onPageChange={handleRobotsPageChange} pageSize={ROBOT_PAGE_SIZE} blockSize={5} />
        </div>
      </div>
      <RobotWorkScheduleModal
        isOpen={robotWorkScheduleModalOpen}
        onClose={() => {
          setRobotWorkScheduleModalOpen(false);
          setWorkScheduleError(null);
        }}
        selectedRobotIds={checkedRobotIds}
        scheduleCase={workScheduleCase}
        completedPathText={completedPathText}
        loading={workScheduleLoading}
        error={workScheduleError}
        onConfirmReturn={() => {
          const robotName = robots.find(r => r.id === selectedRobotId)?.no ?? '';
          console.log("작업스케줄 복귀 실행:", robotName);
          // TODO: 실제 엔드포인트 확정 후 교체
          fetch(`${getApiBase()}/nav/startmove`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ robotName, action: "schedule_return" }),
          }).catch((err) => console.error("작업일정 복귀 명령 실패", err));
        }}
        onConfirmWhenNone={() => {
          router.push("/schedules");
        }}
        onRetry={openWorkScheduleModal}
      />
      <PlacePathModal isOpen={placePathModalOpen} onClose={() => setPlacePathModalOpen(false)} selectedRobotIds={checkedRobotIds}/>
      <PathMoveModal
        isOpen={pathMoveModalOpen}
        onClose={() => setPathMoveModalOpen(false)}
        robotName={selectedRobotNameForPathMove}
        pathRows={pathRows}
        onConfirm={async (path) => {
          try {
            const res = await fetch(`${getApiBase()}/nav/pathmove/${path.id}`, {
              method: "POST",
            });
            const data = await res.json();
            console.log("경로 이동 명령 전송:", data.msg ?? data.status);
          } catch (err) {
            console.error("경로 이동 실패:", err);
          }
          setPathMoveModalOpen(false);
        }}
      />
      {showConfirm && (
        <BatteryPathModal
          isOpen={showConfirm}
          message="배터리 충전소로 이동하시겠습니까?"
          onConfirm={handleSendLogOk}
          onCancel={handleSendLogCancel}
        />
      )}
        

      <div className={styles.cameraMapView}>
          {/* 범례 */}
          <div className={styles.countBox}>
              <div className={styles.robotCount}>
                  <div className={styles.countItem}>
                      <div>전체</div>
                      <div className={styles.totalNumber}>{robotStats.total}</div>
                  </div>
                  <div className={styles.divider}>|</div>
                  <div className={styles.countItem}>
                      <div>운영</div>
                      <div className={styles.itemNumber}>{robotStats.operating}</div>
                  </div>
                  <div className={styles.divider}>|</div>
                  <div className={styles.countItem}>
                      <div>대기</div>
                      <div className={styles.itemNumber}>{robotStats.standby}</div>
                  </div>
                  <div className={styles.divider}>|</div>
                  <div className={styles.countItem}>
                      <div>비운영</div>
                      <div className={styles.itemNumber}>{robotStats.discharged}</div>
                  </div>
              </div>
              <div className={styles.batteryCount}>
                  <div>배터리</div>
                  <div className={styles.countItem}>
                      <div>방전</div>
                      <div className={styles.itemNumber}>{robotStats.charging}</div>
                  </div>
                  <div className={styles.divider}>|</div>
                  <div className={styles.countItem}>
                      <div>충전</div>
                      <div className={styles.itemNumber}>{robotStats.charging}</div>
                  </div>
              </div>
          </div>

          {/* 모니터링 영역 */}
          {selectedRobotId == null ? (
            <div className={styles.monitoringPlaceholder}>
              <span>목록에서 로봇을 선택하면 카메라와 맵이 표시됩니다.</span>
            </div>
          ) : (
            <>
              <CameraViews selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots} floors={floors} video={video} cameras={cameras}/>
              <MapView selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots} floors={floors} video={video} cameras={cameras}/>
            </>
          )}
      </div>
    </div>
  )}

  {activeTab === "place" && (
      <div className={styles.placeWrap}>
        {/* LEFT: 장소 목록 */}
        <div className={styles.placeLeft}>
          <div className={styles.placeTopBar}>
            <h2>장소 목록</h2>

            <div className={styles.placeFilters}>
              {/* 로봇명 선택 */}
              <FilterSelectBox
                items={placeRobotOptions.map((no, i) => ({ id: i, label: no }))}
                selectedLabel={selectedPlaceRobot}
                placeholder="로봇명"
                showTotal={placeRobotOptions.length > 0}
                width={170}
                onSelect={(item) => {
                  setSelectedPlaceRobot(item?.label ?? null);
                  setSelectedPlaceId(null);
                }}
              />

              {/* 층별 선택 */}
              <FilterSelectBox
                items={placeFloorOptions.map((f, i) => ({ id: i, label: f }))}
                selectedLabel={selectedPlaceFloor}
                placeholder="층"
                width={80}
                onSelect={(item) => {
                  setSelectedPlaceFloor(item?.label ?? null);
                  setSelectedPlaceId(null);
                }}
              />
            </div>
          </div>

          <div className={styles.placeListBox}>
            <table className={`${styles.status} ${placeDeleteMode ? styles.placeTableDelete : styles.placeTable}`}>
              <thead>
                <tr>
                  {placeDeleteMode && (
                    <th>
                      <img
                        src={isAllDeleteChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                        alt=""
                        style={{ cursor: "pointer" }}
                        onClick={() => toggleDeleteCheckAll(!isAllDeleteChecked)}
                      />
                    </th>
                  )}
                  <th>로봇명</th>
                  <th>층별</th>
                  <th>장소명</th>
                  <th>좌표(X, Y, D)</th>
                </tr>
              </thead>

              <tbody>
                {currentPlaceItems.length === 0 && (
                  <tr>
                    <td colSpan={placeDeleteMode ? 5 : 4} className={styles.emptyState}>등록된 장소가 없습니다.</td>
                  </tr>
                )}
                {currentPlaceItems.map((row) => {
                  const selected = selectedPlaceId === row.id;
                  const deleteChecked = checkedPlaceIds.includes(row.id);

                  return (
                    <tr
                      key={row.id}
                      className={placeDeleteMode ? (deleteChecked ? styles.selectedRow : undefined) : (selected ? styles.selectedRow : undefined)}
                      style={{ cursor: "pointer" }}
                      onClick={() => placeDeleteMode ? toggleDeleteCheck(row.id, !deleteChecked) : selectPlace(row.id)}
                    >
                      {placeDeleteMode && (
                        <td>
                          <img
                            src={deleteChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                            alt=""
                          />
                        </td>
                      )}
                      <td>{row.robotNo}</td>
                      <td>{row.floor}</td>
                      <td>{row.placeName}</td>
                      <td>
                        X {typeof row.x === "number" ? row.x.toFixed(2) : "-"},
                        Y {typeof row.y === "number" ? row.y.toFixed(2) : "-"},
                        D {typeof row.direction === "number" ? row.direction.toFixed(0) + "°" : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={`${styles.bottomPosition} ${styles.placeBottomPosition}`}>
            {placeDeleteMode ? (
              <>
                <div
                  className={`${styles.placePrimaryBtn} ${checkedPlaceIds.length === 0 ? styles.btnDisabled : ""}`}
                  onClick={() => { if (checkedPlaceIds.length > 0) setPlaceDeleteConfirmOpen(true); }}
                >
                  <img src="/icon/delete_icon.png" alt="" />
                  <span>삭제 확인 ({checkedPlaceIds.length})</span>
                </div>
                <div className={styles.robotWorkBox}>
                  <div className={styles.robotWorkCommonBtn} onClick={exitDeleteMode}>
                    취소
                  </div>
                </div>
              </>
            ) : (
              <>
                <div
                  className={`${styles.placePrimaryBtn} ${!isPlaceCreateEnabled ? styles.btnDisabled : ""}`}
                  aria-disabled={!isPlaceCreateEnabled}
                  onClick={openPlaceCreate}
                >
                  <img src="/icon/check.png" alt="" />
                  <span>장소 등록</span>
                </div>
                <div className={styles.robotWorkBox}>
                  <div className={styles.robotWorkCommonBtn} onClick={enterDeleteMode}>
                    <img src="/icon/delete_icon.png" alt="" />
                    장소 삭제
                  </div>
                  <div
                    className={`${styles.robotWorkCommonBtn} ${selectedPlaceId == null ? styles.btnDisabled : ""}`}
                    onClick={openPlaceEdit}
                    aria-disabled={selectedPlaceId == null}
                  >
                    <img src="/icon/edit_icon.png" alt="" />
                    장소 수정
                  </div>
                </div>
              </>
            )}
          </div>
          <div className={styles.placePagination}>
            <Pagination totalItems={placeTotalItems} currentPage={placePage} onPageChange={handlePlacePageChange} pageSize={PLACE_PAGE_SIZE} blockSize={5} />
          </div>
        </div>
        <PlaceCrudModal
          isOpen={placeCreateOpen}
          mode="create"
          robots={robots}
          floors={FLOORS}
          initial={null}
          existingPlaces={placeRows}
          onClose={() => setPlaceCreateOpen(false)}
          onSubmit={upsertPlace}
        />

        <PlaceCrudModal
          isOpen={placeEditOpen}
          mode="edit"
          robots={robots}
          floors={FLOORS}
          initial={singleCheckedPlaceRow ? toPlaceRowData(singleCheckedPlaceRow) : null}
          existingPlaces={placeRows}
          onClose={() => setPlaceEditOpen(false)}
          onSubmit={upsertPlace}
        />

        <PlaceDeleteConfirmModal
          isOpen={placeDeleteConfirmOpen}
          message={
            checkedPlaceIds.length <= 1
              ? "선택한 장소를 정말 삭제하시겠습니까?"
              : `${checkedPlaceIds.length}개의 장소를 정말 삭제하시겠습니까?`
          }
          onCancel={() => setPlaceDeleteConfirmOpen(false)}
          onConfirm={confirmDeletePlace}
        />

        {/* RIGHT: 장소 위치 */}
        <div className={styles.placeRight}>
          <div className={styles.robotPlaceBox}>
            <h2>장소 위치</h2>
            <span className={styles.placeHintInline}>해당 장소의 좌표(X, Y, D) 입력은 "장소 등록" 화면에서 작성하실 수 있습니다.</span>
          </div>

          {selectedPlaceId == null ? (
            <div className={styles.monitoringPlaceholder}>
              <span>목록에서 장소를 선택하면 지도가 표시됩니다.</span>
            </div>
          ) : (
            <div className={styles.placeMapCard}>
              <PlaceMapView
                selectedPlaceId={selectedPlaceId}
                selectedPlace={singleCheckedPlaceRow}
                placeRows={placeRows}
              />
            </div>
          )}
        </div>
      </div>
    )}

    {activeTab === "path" && (
      <div className={styles.pathWrap}>
        {/* LEFT: 경로 목록 */}
        <div className={styles.pathLeft}>
          <div className={styles.pathTopBar}>
            <h2>경로 목록</h2>

            <div className={styles.pathFilters}>
              <FilterSelectBox
                items={pathRobotOptions.map((no, i) => ({ id: i, label: no }))}
                selectedLabel={selectedPathRobot}
                placeholder="로봇명"
                showTotal={pathRobotOptions.length > 0}
                width={170}
                onSelect={(item) => {
                  setSelectedPathRobot(item?.label ?? null);
                  resetPathSelection();
                }}
              />

              <FilterSelectBox
                items={pathWorkTypeOptions.map((t, i) => ({ id: i, label: t }))}
                selectedLabel={selectedPathWorkType}
                placeholder="작업유형"
                width={130}
                onSelect={(item) => {
                  setSelectedPathWorkType(item?.label ?? null);
                  resetPathSelection();
                }}
              />
            </div>
          </div>

          {/* table + 로딩 오버레이 */}
          <div className={styles.pathListBoxWrap}>
            {pathLoading && (
              <div className={styles.pathLoadingOverlay}>
                <div className={styles.pathSpinner} />
              </div>
            )}
            <div className={styles.pathListBox}>
              <table className={`${styles.status} ${pathDeleteMode ? styles.pathTableDelete : styles.pathTable}`}>
                <thead>
                  <tr>
                    {pathDeleteMode && (
                      <th>
                        <img
                          src={isAllCurrentPathItemsChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                          alt="현재 페이지 경로 전체 선택"
                          style={{ cursor: "pointer" }}
                          onClick={() => toggleAllCurrentPathItems(!isAllCurrentPathItemsChecked)}
                        />
                      </th>
                    )}
                    <th>로봇명</th>
                    <th>작업유형</th>
                    <th>경로명</th>
                    <th>경로순서</th>
                  </tr>
                </thead>

                <tbody>
                  {currentPathItems.length === 0 && !pathLoading && (
                    <tr>
                      <td colSpan={pathDeleteMode ? 5 : 4}>
                        <div className={styles.pathEmptyWrap}>
                          <div className={styles.pathEmptyIcon}>!</div>
                          <div className={styles.pathEmptyTitle}>등록된 경로가 없습니다.</div>
                          <div className={styles.pathEmptyDesc}>경로 등록 버튼을 클릭하여 새 경로를 등록해 주세요.</div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {currentPathItems.map((row) => {
                    const deleteChecked = checkedPathIds.includes(row.id);
                    const isRowSelected = selectedPathId === row.id;

                    return (
                      <tr
                        key={row.id}
                        className={pathDeleteMode ? (deleteChecked ? styles.selectedRow : undefined) : (isRowSelected ? styles.selectedRow : undefined)}
                        style={{ cursor: "pointer" }}
                        onClick={() => pathDeleteMode ? togglePathChecked(row.id, !deleteChecked) : setSelectedPathId(isRowSelected ? null : row.id)}
                      >
                        {pathDeleteMode && (
                          <td>
                            <img
                              src={deleteChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                              alt=""
                            />
                          </td>
                        )}
                        <td>{row.robotNo}</td>
                        <td>{row.workType}</td>
                        <td>{row.pathName}</td>
                        <td className={styles.pathOrderCell}>
                          <div className={styles.pathOrderText} title={row.pathOrder}>{row.pathOrder}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* bottom buttons */}
          <div className={styles.pathBottomBar}>
            {pathDeleteMode ? (
              <>
                <div
                  className={`${styles.pathPrimaryBtn} ${!isPathDeleteEnabled ? styles.btnDisabled : ""}`}
                  onClick={() => { if (isPathDeleteEnabled) openPathDelete(); }}
                >
                  <img src="/icon/delete_icon.png" alt="" />
                  <span>삭제 확인 ({pathCheckedCount})</span>
                </div>
                <div className={styles.robotWorkBox}>
                  <div
                    className={styles.robotWorkCommonBtn}
                    onClick={() => { setPathDeleteMode(false); setCheckedPathIds([]); }}
                  >
                    <img src="/icon/close_btn.png" alt="" />
                    취소
                  </div>
                </div>
              </>
            ) : (
              <>
                <div
                  className={styles.pathPrimaryBtn}
                  onClick={openPathCreate}
                >
                  <img src="/icon/check.png" alt="check" />
                  <span>경로 등록</span>
                </div>

                <div className={styles.robotWorkBox}>
                  <div
                    className={styles.robotWorkCommonBtn}
                    onClick={() => { setPathDeleteMode(true); setCheckedPathIds([]); setSelectedPathId(null); }}
                  >
                    <img src="/icon/delete_icon.png" alt="" />
                    경로 삭제
                  </div>

                  <div
                    className={`${styles.robotWorkCommonBtn} ${!isPathEditEnabled ? styles.btnDisabled : ""}`}
                    onClick={openPathEdit}
                    aria-disabled={!isPathEditEnabled}
                  >
                    <img src="/icon/edit_icon.png" alt="" />
                    경로 수정
                  </div>
                </div>
              </>
            )}
          </div>
          <div className={styles.pathPagination}>
            <Pagination
              totalItems={pathTotalItems}
              currentPage={pathPage}
              onPageChange={handlePathPageChange}
              pageSize={PATH_PAGE_SIZE}
              blockSize={5}
            />
          </div>
        </div>

        {/* RIGHT: 경로 미리보기 */}
        <div className={styles.pathRight}>
          <div className={styles.robotPlaceBox}>
            <h2>경로 미리보기</h2>
            <span className={styles.pathHintInline}>목록에서 경로를 클릭하면 경로가 지도에 표시됩니다.</span>
          </div>

          {selectedPathRow == null ? (
            <div className={styles.monitoringPlaceholder}>
              <span>목록에서 경로를 선택하면 경로가 표시됩니다.</span>
            </div>
          ) : (
            <div className={styles.pathMapCard}>
              <PathMapView
                selectedPath={selectedPathRow}
                placeRows={placeRows}
              />
            </div>
          )}
        </div>
      </div>
    )}

    <PathCrudModal
      isOpen={pathCreateOpen}
      mode="create"
      placeRows={placeRows}
      existingPaths={pathRows}
      initial={null}
      onClose={() => setPathCreateOpen(false)}
      onSubmit={savePathToDB}
      robots={robots}
      floors={floors}
    />

    <PathCrudModal
      isOpen={pathEditOpen}
      mode="edit"
      placeRows={placeRows}
      existingPaths={pathRows}
      robots={robots}
      floors={floors}
      initial={singleCheckedPathRow}
      onClose={() => setPathEditOpen(false)}
      onSubmit={savePathToDB}
    />

    <PathDeleteConfirmModal
      isOpen={pathDeleteConfirmOpen}
      message={
        checkedPathIds.length <= 1
          ? "선택한 경로를 정말 삭제하시겠습니까?"
          : `${checkedPathIds.length}개의 경로를 정말 삭제하시겠습니까?`
      }
      onCancel={() => setPathDeleteConfirmOpen(false)}
      onConfirm={confirmDeletePath}
    />

    {/* 경로 관리 알림 모달 */}
    <PathAlertsModal
      isOpen={!!pathAlertMessage}
      message={pathAlertMessage ?? ""}
      onCancel={() => setPathAlertMessage(null)}
      onConfirm={() => setPathAlertMessage(null)}
    />
    </>
  );
}
