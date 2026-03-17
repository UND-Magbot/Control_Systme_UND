"use client";

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from "next/navigation";
import styles from './RobotList.module.css';
import Pagination from "@/app/components/pagination";
import type { RobotRowData, BatteryItem, Camera, Floor, Video, NetworkItem, PowerItem, LocationItem } from '@/app/type';
import { RobotCrudBtn, RemoteBtn, RobotPathBtn } from "@/app/components/button";
import CameraViews from './CameraView';
import MapView from './MapView';
import RobotDetailModal from "@/app/components/modal/RobotDetailModal";
import RobotWorkScheduleModal from "@/app/components/modal/WorkScheduleModal";
import type { WorkScheduleCase } from "@/app/components/modal/WorkScheduleModal";
import PlacePathModal from "@/app/components/modal/PlacePathModal";
import BatteryPathModal from "@/app/components/modal/BatteryChargeModal";
import { mockPlaceRows, type PlaceRow } from "@/app/mock/robotPlace_data";
import { mockPathRows } from "@/app/mock/robotPath_data";
import PlaceCrudModal, { type PlaceRowData } from "./PlaceCrudModal";
import PlaceDeleteConfirmModal from "./PlaceDeleteConfirmModal";
import PlaceMapView from "./PlaceMapView";
import PathCrudModal from "@/app/(pages)/robots/components/PathCrudModal";
import PathDeleteConfirmModal from "@/app/(pages)/robots/components/PathDeleteConfirmModal";
import { API_BASE } from "@/app/config";

type FixedScrollbarArgs = {
  enabled: boolean;
  scrollRef: React.RefObject<HTMLElement | null>;
  trackRef: React.RefObject<HTMLElement | null>;
  thumbRef: React.RefObject<HTMLElement | null>;
  thumbHeight?: number;
  deps?: any[];
};

const robotTypes = ["환자 모니터링", "순찰/보안", "물품/약품 운반"];

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

const ROBOT_PAGE_SIZE  = 10;
const PLACE_PAGE_SIZE = 10;
const PATH_PAGE_SIZE  = 10;

interface RobotStatusListProps {
  cameras: Camera[];
  robots: RobotRowData[];
  floors: Floor[];
  video: Video[];
  batteryStatus: BatteryItem[];
  networkStatus: NetworkItem[];
  powerStatus: PowerItem[];
  locationStatus: LocationItem[];
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
  robots,
  floors,
  video,
  batteryStatus,
  networkStatus,
  powerStatus,
  locationStatus
}:RobotStatusListProps) {

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
  const isChargeMoveDisabled = !isAnyChecked;      // 0개만 비활성


  const [selectedRobots, setSelectedRobots] = useState<RobotRowData | null>(null);
  const [selectedBattery, setSelectedBattery] = useState<BatteryItem | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkItem | null>(null);
  const [selectedPower, setSelectedPower] = useState<PowerItem | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);


  const [robotDetailModalOpen, setRobotDetailModalOpen] = useState(false);
  const [robotWorkScheduleModalOpen, setRobotWorkScheduleModalOpen] = useState(false);
  const [placePathModalOpen, setPlacePathModalOpen] = useState(false);

  const [workScheduleCase, setWorkScheduleCase] = useState<WorkScheduleCase>('none');
  const [completedPathText, setCompletedPathText] = useState<string>('');

  const [robotsIsOpen, setRobotsIsOpen] = useState(false);
  const robotsWrapperRef = useRef<HTMLDivElement>(null);
  const robotsScrollRef = useRef<HTMLDivElement>(null);
  const robotsTrackRef = useRef<HTMLDivElement>(null);
  const robotsThumbRef = useRef<HTMLDivElement>(null);

  const [batteryIsOpen, setBatteryIsOpen] = useState(false);
  const batteryWrapperRef = useRef<HTMLDivElement>(null);
  const batteryScrollRef = useRef<HTMLDivElement>(null);
  const batteryTrackRef = useRef<HTMLDivElement>(null);
  const batteryThumbRef = useRef<HTMLDivElement>(null);

  const [networkIsOpen, setNetworkIsOpen] = useState(false);
  const networkWrapperRef = useRef<HTMLDivElement>(null);
  const networkScrollRef = useRef<HTMLDivElement>(null);
  const networkTrackRef = useRef<HTMLDivElement>(null);
  const networkThumbRef = useRef<HTMLDivElement>(null);

  const [powerIsOpen, setPowerIsOpen] = useState(false);
  const powerWrapperRef = useRef<HTMLDivElement>(null);
  const powerScrollRef = useRef<HTMLDivElement>(null);
  const powerTrackRef = useRef<HTMLDivElement>(null);
  const powerThumbRef = useRef<HTMLDivElement>(null);

  const [locationIsOpen, setLocationIsOpen] = useState(false);
  const locationWrapperRef = useRef<HTMLDivElement>(null);
  const locationScrollRef = useRef<HTMLDivElement>(null);
  const locationTrackRef = useRef<HTMLDivElement>(null);
  const locationThumbRef = useRef<HTMLDivElement>(null);
  
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
  const searchParams = useSearchParams();
  
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

    if (tab === "robots" && activeTab !== "robots") {
        setRobotsPage(1);

    } else if (tab === "place" && activeTab !== "place") {
        setPlacePage(1);

      } else if (tab === "path") {
        setPathPage(1);
      }
  };

  useEffect(() => {
    const tab = searchParams.get("tab");
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
  }, [searchParams]);

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

  // 로봇 아이콘 개수
  const ROBOT_ICON_COUNT = 7;

  const robotColors = [
    "#ed1c24", "#059fd7", "#92d050", "#f7941d",
    "#d65bdb", "#0fc6cc", "#51b77c"
  ];

  function getRobotIndexFromNo(robotNo: string): number {
    const match = robotNo.match(/\d+/); // "Robot 1" → ["1"]
    const num = match ? Number(match[0]) : 1; // 못 찾으면 1번 로봇으로 가정
    const idx = num - 1;

    // 순환시키려면 이렇게:
    return ((idx % robotColors.length) + robotColors.length) % robotColors.length;
  }

  function buildRobotIconPath(robotNo: string, kind: "icon" | "location"): string {
    const idx = getRobotIndexFromNo(robotNo);
    const iconNo = idx + 1;

    if (kind === "icon") {
      return `/icon/robot_icon(${iconNo}).png`;
    }
    return `/icon/robot_location(${iconNo}).png`;
  }

  const robotInfoIcons = {
    
    info: (robotNo: string) => buildRobotIconPath(robotNo, "icon"),

    battery: (battery: number, isCharging?: boolean) => {
      if (isCharging) return "/icon/battery_charging.png";
      if (battery >= 100) return "/icon/battery_full.png";
      if (battery > 75) return "/icon/battery_high.png";
      if (battery > 50) return "/icon/battery_half.png";
      if (battery > 25) return "/icon/battery_low.png";
      return "/icon/battery_empty.png";
    },

    network: (status: string) => {
      if (status === "Error") return "/icon/status(2).png";
      if (status === "Offline") return "/icon/status(3).png";
      return "/icon/status(1).png";
    },

    power: (power: string) => {
      return power === "On" ? "/icon/power_on.png" : "/icon/power_off.png";
    },

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

  const robotsClick = (idx: number, option: RobotRowData) => {
    setRobotsActiveIndex(idx);     // 선택된 로봇명 옵션 저장
    setSelectedRobots(option);  
    setRobotsIsOpen(false);       // 드롭다운 닫기
    resetCurrentPage();
  };

  const batteryStatusClick = (idx: number, option: BatteryItem) => {
    setBatteryActiveIndex(idx);     // 선택된 배터리 옵션 저장
    setSelectedBattery(option);  
    setBatteryIsOpen(false);       // 드롭다운 닫기
    resetCurrentPage();
  };

  const networkStatusClick = (idx: number, option: NetworkItem) => {
    setNetworkActiveIndex(idx);
    setSelectedNetwork(option);  
    setNetworkIsOpen(false);
    resetCurrentPage();
  };
  const powerStatusClick = (idx: number, option: PowerItem) => {
    setPowerActiveIndex(idx);     // 선택된 전원 옵션 저장
    setSelectedPower(option);  
    setPowerIsOpen(false);       // 드롭다운 닫기
    resetCurrentPage();
  };
  const locationStatusClick = (idx: number, option: LocationItem) => {
    setLocationActiveIndex(idx);     // 선택된 위치 옵션 저장
    setSelectedLocation(option);  
    setLocationIsOpen(false);       // 드롭다운 닫기
    resetCurrentPage();
  };

  const toggleRobotChecked = (robotId: number, checked: boolean) => {
    setCheckedRobotIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, robotId]))
        : prev.filter((id) => id !== robotId);

      // ✅ 체크 1개면 그 로봇을 "선택 로봇"으로 저장
      setSelectedRobotId(next.length === 1 ? next[0] : null);

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
  const openWorkScheduleModal = () => {

    // 예시(임시): selectedRobotId가 없으면 none
    if (selectedRobotId == null) {
      setWorkScheduleCase('none');
      setCompletedPathText('');
      setRobotWorkScheduleModalOpen(true);
      return;
    }

    // 예시(임시 목업): 짝수 id는 ongoing, 홀수 id는 recent
    if (selectedRobotId % 2 === 0) {
      setWorkScheduleCase('ongoing');
      setCompletedPathText('데스크 - 커피로봇 - 맥봇제품 - 교육용로봇 - 부스입구 - 교육용로봇 - 맥봇제품 - 커피로봇 - 데스크 - 부스입구 - 교육용로봇 - 맥봇제품 - 커피로봇 - 데스크 - 부스입구 - 교육용로봇 - 맥봇제품 - 커피로봇 - 데스크 - 부스입구 - 교육용로봇 - 맥봇제품 - 커피로봇 - 데스크');
    } else {
      setWorkScheduleCase('recent');
      setCompletedPathText('데스크 - 안내데스크 - 민원창구 - 부스입구');
    }

    setRobotWorkScheduleModalOpen(true);
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
  const [placeRobotOpen, setPlaceRobotOpen] = useState(false);
  const [placeFloorOpen, setPlaceFloorOpen] = useState(false);
  const [placeRows, setPlaceRows] = useState<PlaceRow[]>([]);
  const placeRobotWrapperRef = useRef<HTMLDivElement>(null);
  const placeFloorWrapperRef = useRef<HTMLDivElement>(null);
  const placeRobotScrollRef = useRef<HTMLDivElement>(null);
  const placeRobotTrackRef = useRef<HTMLDivElement>(null);
  const placeRobotThumbRef = useRef<HTMLDivElement>(null);
  const placeFloorScrollRef = useRef<HTMLDivElement>(null);
  const placeFloorTrackRef = useRef<HTMLDivElement>(null);
  const placeFloorThumbRef = useRef<HTMLDivElement>(null);

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


  useEffect(() => {
  if (activeTab !== "place") return;

  const fetchPlaces = async () => {
    try {
      const res = await fetch(`${API_BASE}/DB/places`);
      const data = await res.json();
      console.log(data)
      const mapped: PlaceRow[] = data.map((p: any) => ({
        id: p.id,
        robotNo: p.RobotName,
        floor: p.Floor,
        placeName: p.LacationName,
        x: p.LocationX,
        y: p.LocationY,
        updatedAt: new Date(p.UpdatedAt).toLocaleString("ko-KR"),
      }));

      setPlaceRows(mapped);
    } catch (e) {
      console.error("장소 목록 로드 실패", e);
    }
  };

  fetchPlaces();
}, [activeTab]);
  const shouldShowPlaceRobotScroll = placeRobotOptions.length + 1 >= 5;
  const shouldShowPlaceFloorScroll = placeFloorOptions.length + 1 >= 5;
  const shouldShowRobotFilterScroll = robots.length + 1 >= 5;
  const shouldShowBatteryFilterScroll = batteryStatus.length + 1 >= 5;
  const shouldShowNetworkFilterScroll = networkStatus.length + 1 >= 5;
  const shouldShowPowerFilterScroll = powerStatus.length + 1 >= 5;
  const shouldShowLocationFilterScroll = locationStatus.length + 1 >= 5;

  useFixedSelectScrollbar({
    enabled: placeRobotOpen && shouldShowPlaceRobotScroll,
    scrollRef: placeRobotScrollRef,
    trackRef: placeRobotTrackRef,
    thumbRef: placeRobotThumbRef,
    deps: [placeRobotOptions.length, placeRobotOpen],
  });

  useFixedSelectScrollbar({
    enabled: placeFloorOpen && shouldShowPlaceFloorScroll,
    scrollRef: placeFloorScrollRef,
    trackRef: placeFloorTrackRef,
    thumbRef: placeFloorThumbRef,
    deps: [placeFloorOptions.length, placeFloorOpen],
  });

  useFixedSelectScrollbar({
    enabled: robotsIsOpen && shouldShowRobotFilterScroll,
    scrollRef: robotsScrollRef,
    trackRef: robotsTrackRef,
    thumbRef: robotsThumbRef,
    deps: [robots.length, robotsIsOpen],
  });

  useFixedSelectScrollbar({
    enabled: batteryIsOpen && shouldShowBatteryFilterScroll,
    scrollRef: batteryScrollRef,
    trackRef: batteryTrackRef,
    thumbRef: batteryThumbRef,
    deps: [batteryStatus.length, batteryIsOpen],
  });

  useFixedSelectScrollbar({
    enabled: networkIsOpen && shouldShowNetworkFilterScroll,
    scrollRef: networkScrollRef,
    trackRef: networkTrackRef,
    thumbRef: networkThumbRef,
    deps: [networkStatus.length, networkIsOpen],
  });

  useFixedSelectScrollbar({
    enabled: powerIsOpen && shouldShowPowerFilterScroll,
    scrollRef: powerScrollRef,
    trackRef: powerTrackRef,
    thumbRef: powerThumbRef,
    deps: [powerStatus.length, powerIsOpen],
  });

  useFixedSelectScrollbar({
    enabled: locationIsOpen && shouldShowLocationFilterScroll,
    scrollRef: locationScrollRef,
    trackRef: locationTrackRef,
    thumbRef: locationThumbRef,
    deps: [locationStatus.length, locationIsOpen],
  });

  const toPlaceRowData = (row: PlaceRow): PlaceRowData => ({
    id: row.id,
    robotNo: row.robotNo,
    floor: row.floor,
    name: row.placeName,
    x: String(row.x),
    y: String(row.y),
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

  const confirmDeletePlace = () => {
    if (checkedPlaceIds.length === 0) return;
    const del = new Set(checkedPlaceIds);

    setPlaceRows((prev) => prev.filter((p) => !del.has(p.id)));
    setCheckedPlaceIds([]);
    setPlaceDeleteConfirmOpen(false);
  };

  const placeTotalItems = filteredPlaceRows.length;
  const placeStartIndex = (placePage - 1) * PLACE_PAGE_SIZE;
  const currentPlaceItems = filteredPlaceRows.slice(
    placeStartIndex,
    placeStartIndex + PLACE_PAGE_SIZE
  );

  const togglePlaceChecked = (placeId: number, checked: boolean) => {
    setCheckedPlaceIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, placeId]))
        : prev.filter((id) => id !== placeId);

      // 1개만 체크됐을 때만 “선택 장소”로 인정
      setSelectedPlaceId(next.length === 1 ? next[0] : null);

      return next;
    });
  };

  const toggleAllCurrentPlaceItems = (checked: boolean) => {
    const currentPageIds = currentPlaceItems.map((r) => r.id);

    setCheckedPlaceIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, ...currentPageIds]))
        : prev.filter((id) => !currentPageIds.includes(id));

      setSelectedPlaceId(next.length === 1 ? next[0] : null);
      return next;
    });
  };

  const isAllCurrentPlaceItemsChecked = currentPlaceItems.length > 0 && currentPlaceItems.every((r) => checkedPlaceIds.includes(r.id));

  // =========================
  // 경로 관리 (Path)
  // =========================
  const [pathRows, setPathRows] = useState<PathRow[]>([]);

  const [pathRobotOpen, setPathRobotOpen] = useState(false);
  const [pathWorkTypeOpen, setPathWorkTypeOpen] = useState(false);
  const pathRobotWrapperRef = useRef<HTMLDivElement>(null);
  const pathWorkTypeWrapperRef = useRef<HTMLDivElement>(null);
  const pathRobotScrollRef = useRef<HTMLDivElement>(null);
  const pathRobotTrackRef = useRef<HTMLDivElement>(null);
  const pathRobotThumbRef = useRef<HTMLDivElement>(null);
  const pathWorkTypeScrollRef = useRef<HTMLDivElement>(null);
  const pathWorkTypeTrackRef = useRef<HTMLDivElement>(null);
  const pathWorkTypeThumbRef = useRef<HTMLDivElement>(null);

  const [selectedPathRobot, setSelectedPathRobot] = useState<string | null>(null);   // null=Total
  const [selectedPathWorkType, setSelectedPathWorkType] = useState<string | null>(null); // null=Total

  const [checkedPathIds, setCheckedPathIds] = useState<number[]>([]);
  const pathCheckedCount = checkedPathIds.length;

  // 버튼 정책(이미지 동일)
  // - 등록: 아무것도 선택 안했을 때만 활성
  // - 수정: 1개 선택일 때만 활성
  // - 삭제: 1개 이상 선택일 때 활성
  const isPathCreateEnabled = pathCheckedCount === 0;
  const isPathEditEnabled = pathCheckedCount === 1;
  const isPathDeleteEnabled = pathCheckedCount >= 1;

  // 옵션 리스트
  const pathRobotOptions = useMemo(() => {
    const set = new Set(robots.map(r => r.no));
    return Array.from(set);
  }, [robots]);

  const pathWorkTypeOptions = useMemo(() => {
    const set = new Set(robotTypes);
    return Array.from(set);
  }, [robotTypes]);

  const shouldShowPathRobotScroll = pathRobotOptions.length + 1 >= 5;
  const shouldShowPathWorkTypeScroll = pathWorkTypeOptions.length + 1 >= 5;

  // 필터 적용
  const filteredPathRows = useMemo(() => {
    return pathRows
      .filter((r) => {
        const robotOk = !selectedPathRobot || r.robotNo === selectedPathRobot;
        const typeOk = !selectedPathWorkType || r.workType === selectedPathWorkType;
        return robotOk && typeOk;
      })
      // .sort((a, b) => {
      //   return parseUpdatedAt(b.updatedAt) - parseUpdatedAt(a.updatedAt);
      // });
  }, [pathRows, selectedPathRobot, selectedPathWorkType]);

  // 페이지 데이터
  const pathTotalItems = filteredPathRows.length;
  const pathStartIndex = (pathPage - 1) * PATH_PAGE_SIZE;
  const currentPathItems = filteredPathRows.slice(pathStartIndex, pathStartIndex + PATH_PAGE_SIZE);

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
  };  // ✅ 체크 1개일 때만 수정용 단일 row
  const singleCheckedPathRow = useMemo(() => {
    if (checkedPathIds.length !== 1) return null;
    const id = checkedPathIds[0];
    return pathRows.find((r) => r.id === id) ?? null;
  }, [checkedPathIds, pathRows]);

  // ✅ 모달 상태
  const [pathCreateOpen, setPathCreateOpen] = useState(false);
  const [pathEditOpen, setPathEditOpen] = useState(false);
  const [pathDeleteConfirmOpen, setPathDeleteConfirmOpen] = useState(false);

  const fetchPathsFromDB = async () => {
    console.log("🚀 fetchPathsFromDB 호출됨");
    try {
      const res = await fetch(`${API_BASE}/DB/getpath`);
      if (!res.ok) throw new Error("경로 목록 조회 실패");

      const data = await res.json();
      console.log("✅ DB paths data:", data);

      const mapped: PathRow[] = data.map((p: any) => ({
        id: p.id,
        robotNo: p.RobotName,
        workType: p.TaskType,
        pathName: p.WayName,
        pathOrder: p.WayPoints,
        updatedAt: p.UpdateTime
        ? new Date(p.UpdateTime).toLocaleString("ko-KR")
        : "-",   // 안전 처리
      }));

      setPathRows(mapped);
    } catch (err) {
      console.error("경로 목록 로드 실패", err);
    }
  };

  // ✅ 등록/수정 저장
  const savePathToDB = async (payload: {
    id?: number;
    robotNo: string;
    workType: string;
    pathName: string;
    pathOrder: string;
  }) => {
    try {
      const res = await fetch(`${API_BASE}/DB/path`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          RobotName: payload.robotNo,
          TaskType: payload.workType,
          WayName: payload.pathName,
          WayPoints: payload.pathOrder,
        }),
      });

      if (!res.ok) throw new Error("경로 저장 실패");

      // ✅ 저장 성공 → DB에서 다시 목록 조회
      await fetchPathsFromDB();

      // UI 정리
      setCheckedPathIds([]);
      setPathPage(1);
      setPathCreateOpen(false);
      setPathEditOpen(false);

    } catch (err) {
      console.error("경로 DB 저장 실패", err);
      alert("경로 저장에 실패했습니다.");
    }
  };

  useEffect(() => {
    if (activeTab !== "path") return;
    fetchPathsFromDB();
  }, [activeTab]);

  // ✅ 삭제 확정
  const confirmDeletePath = () => {
    if (checkedPathIds.length === 0) return;
    const del = new Set(checkedPathIds);
    setPathRows((prev) => prev.filter((p) => !del.has(p.id)));
    setCheckedPathIds([]);
    setPathDeleteConfirmOpen(false);
  };

  // ✅ 버튼 핸들러 교체
  const openPathCreate = () => {
    if (!isPathCreateEnabled) return;
    setPathCreateOpen(true);
  };

  const openPathEdit = () => {
    if (!isPathEditEnabled) return;
    setPathEditOpen(true);
  };

  const openPathDelete = () => {
    if (!isPathDeleteEnabled) return;
    setPathDeleteConfirmOpen(true);
  };

  const isAllCurrentPathItemsChecked =
    currentPathItems.length > 0 && currentPathItems.every((r) => checkedPathIds.includes(r.id));

  // 필터 변경 시 페이지/체크 초기화
  const resetPathSelection = () => {
    setCheckedPathIds([]);
    setPathPage(1);
  };

  useFixedSelectScrollbar({
    enabled: pathRobotOpen && shouldShowPathRobotScroll,
    scrollRef: pathRobotScrollRef,
    trackRef: pathRobotTrackRef,
    thumbRef: pathRobotThumbRef,
    deps: [pathRobotOptions.length, pathRobotOpen],
  });

  useFixedSelectScrollbar({
    enabled: pathWorkTypeOpen && shouldShowPathWorkTypeScroll,
    scrollRef: pathWorkTypeScrollRef,
    trackRef: pathWorkTypeTrackRef,
    thumbRef: pathWorkTypeThumbRef,
    deps: [pathWorkTypeOptions.length, pathWorkTypeOpen],
  });

    useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        robotsWrapperRef.current &&
        !robotsWrapperRef.current.contains(e.target as Node)
      ) {
        setRobotsIsOpen(false); // 외부 클릭 → 닫기
      }

      if (
        batteryWrapperRef.current &&
        !batteryWrapperRef.current.contains(e.target as Node)
      ) {
        setBatteryIsOpen(false); // 외부 클릭 → 닫기
      }

      if (
        networkWrapperRef.current &&
        !networkWrapperRef.current.contains(e.target as Node)
      ) {
        setNetworkIsOpen(false); // 외부 클릭 → 닫기
      }

      if (
        powerWrapperRef.current &&
        !powerWrapperRef.current.contains(e.target as Node)
      ) {
        setPowerIsOpen(false); // 외부 클릭 → 닫기
      }

      if (
        locationWrapperRef.current &&
        !locationWrapperRef.current.contains(e.target as Node)
      ) {
        setLocationIsOpen(false); // 외부 클릭 → 닫기
      }

      if (placeRobotWrapperRef.current && !placeRobotWrapperRef.current.contains(e.target as Node)) {
        setPlaceRobotOpen(false);
      }
      
      if (placeFloorWrapperRef.current && !placeFloorWrapperRef.current.contains(e.target as Node)) {
        setPlaceFloorOpen(false);
      }

      if (pathRobotWrapperRef.current && !pathRobotWrapperRef.current.contains(e.target as Node)) {
        setPathRobotOpen(false);
      }

      if (pathWorkTypeWrapperRef.current && !pathWorkTypeWrapperRef.current.contains(e.target as Node)) {
        setPathWorkTypeOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);


  return (
    <>

    <div className={styles.robotListTab}>
        <div className={`${activeTab === "robots" ? styles.active : ""}`} onClick={() => handleTabClick("robots")}>로봇 관리</div>
        <div className={`${activeTab === "place" ? styles.active : ""}`} onClick={() => handleTabClick("place")}>장소 관리</div>
        <div className={`${activeTab === "path" ? styles.active : ""}`} onClick={() => handleTabClick("path")}>경로 관리</div>
    </div>

    {activeTab === "robots" && (
    <div className={styles.RobotListTab}>
      <div className={styles.RobotStatusList}>
        <div className={styles.RobotStatusTopPosition}>
            <h2>로봇 목록</h2>
            <div className={styles.RobotSearch}>
              {/* 로봇 검색 필터 */}
              <div ref={robotsWrapperRef} className={`${styles.selecteWrapper}`} >
                  <div className={styles.selecte} onClick={() => setRobotsIsOpen(!robotsIsOpen)}>
                    <span>{robotsActiveIndex === -1 ? "Total" : selectedRobots?.no ?? "로봇명 선택"}</span>
                    {robotsIsOpen ? (
                      <img src="/icon/arrow_up.png" alt="arrow_up" />
                    ) : (
                      <img src="/icon/arrow_down.png" alt="arrow_down" />
                    )}
                  </div> 
                  {robotsIsOpen && (
                    <div className={styles.selectebox}>
                      <div ref={robotsScrollRef} className={styles.selecteInner} role="listbox">
                        {/* Total을 맨 위에 직접 추가 */}
                        <div
                          className={robotsActiveIndex === -1 ? styles.active : ""}
                          onClick={() => {
                            setRobotsActiveIndex(-1);
                            setSelectedRobots(null);   // null → 전체 조건 의미
                            setRobotsIsOpen(false);
                          }}
                        >
                          Total
                        </div>

                        {/* 실제 옵션들 */}
                        {robots.map((item, idx) => (
                          <div
                            key={item.id}
                            className={robotsActiveIndex === idx ? styles.active : ""}
                            onClick={ () => { robotsClick(idx, item); } }
                          >
                            {item.no}
                          </div>
                        ))}
                      </div>
                      {shouldShowRobotFilterScroll && (
                        <div ref={robotsTrackRef} className={styles.selecteScrollTrack}>
                          <div ref={robotsThumbRef} className={styles.selecteScrollThumb} />
                        </div>
                      )}
                  </div>
                  )}
              </div>

              {/* 배터리 검색 필터 */}
              <div ref={batteryWrapperRef} className={`${styles.selecteWrapper}`} >
                  <div className={styles.selecte} onClick={() => setBatteryIsOpen(!batteryIsOpen)}>
                    <span>{batteryActiveIndex === -1 ? "Total" : selectedBattery?.label ?? "배터리 상태"}</span>
                    {batteryIsOpen ? (
                      <img src="/icon/arrow_up.png" alt="arrow_up" />
                    ) : (
                      <img src="/icon/arrow_down.png" alt="arrow_down" />
                    )}
                  </div> 
                  {batteryIsOpen && (
                    <div className={styles.selectebox}>
                      <div ref={batteryScrollRef} className={styles.selecteInner} role="listbox">
                        {/* Total을 맨 위에 직접 추가 */}
                        <div
                          className={batteryActiveIndex === -1 ? styles.active : ""}
                          onClick={() => {
                            setBatteryActiveIndex(-1);
                            setSelectedBattery(null);   // null → 전체 조건 의미
                            setBatteryIsOpen(false);
                          }}
                        >
                          Total
                        </div>

                        {/* 실제 옵션들 */}
                        {batteryStatus.map((item, idx) => (
                          <div
                            key={item.id}
                            className={batteryActiveIndex === idx ? styles.active : ""}
                            onClick={ () => { batteryStatusClick(idx, item); } }
                          >
                            {item.label}
                          </div>
                        ))}
                      </div>
                      {shouldShowBatteryFilterScroll && (
                        <div ref={batteryTrackRef} className={styles.selecteScrollTrack}>
                          <div ref={batteryThumbRef} className={styles.selecteScrollThumb} />
                        </div>
                      )}
                  </div>
                  )}
              </div>

              {/* 네트워크 검색 필터 */}
              <div ref={networkWrapperRef} className={styles.selecteWrapper}>
                    <div className={styles.selecte} 
                      onClick={() => setNetworkIsOpen(!networkIsOpen)}>
                      <span>{networkActiveIndex === -1 ? "Total" : selectedNetwork?.label ?? "네트워크 상태"}</span>
                      {networkIsOpen ? (
                        <img src="/icon/arrow_up.png" alt="arrow_up" />
                      ) : (
                        <img src="/icon/arrow_down.png" alt="arrow_down" />
                      )}
                    </div> 
                    {networkIsOpen && (
                      <div className={styles.selectebox}>
                        <div ref={networkScrollRef} className={styles.selecteInner} role="listbox">
                          {/* Total */}
                          <div
                            className={networkActiveIndex === -1 ? styles.active : ""}
                            onClick={() => {
                              setNetworkActiveIndex(-1);
                              setSelectedNetwork(null); // 전체
                              setNetworkIsOpen(false);
                              resetCurrentPage();
                            }}
                          >
                            Total
                          </div>

                          {/* 실제 네트워크 옵션들 */}
                          {networkStatus.map((item, idx) => (
                            <div
                              key={item.id}
                              className={networkActiveIndex === idx ? styles.active : ""}
                              onClick={ () => { networkStatusClick(idx, item); } }
                            >
                              {item.label}
                            </div>
                          ))}
                        </div>
                        {shouldShowNetworkFilterScroll && (
                          <div ref={networkTrackRef} className={styles.selecteScrollTrack}>
                            <div ref={networkThumbRef} className={styles.selecteScrollThumb} />
                          </div>
                        )}
                      </div>
                    )}
              </div>
              
              <div ref={powerWrapperRef} className={styles.selecteWrapper}>
                  <div className={styles.selecte} 
                    onClick={() => setPowerIsOpen(!powerIsOpen)}>
                    <span>{powerActiveIndex === -1 ? "Total" : selectedPower?.label ?? "전원 상태"}</span>
                    {powerIsOpen ? (
                      <img src="/icon/arrow_up.png" alt="arrow_up" />
                    ) : (
                      <img src="/icon/arrow_down.png" alt="arrow_down" />
                    )}
                  </div> 
                  {powerIsOpen && (
                    <div className={styles.selectebox}>
                      <div ref={powerScrollRef} className={styles.selecteInner} role="listbox">
                        {/* Total */}
                        <div
                          className={powerActiveIndex === -1 ? styles.active : ""}
                          onClick={() => {
                            setPowerActiveIndex(-1);
                            setSelectedPower(null);
                            setPowerIsOpen(false);
                            resetCurrentPage();
                          }}
                        >
                          Total
                        </div>

                        {/* 실제 전원 옵션들 */}
                        {powerStatus.map((item, idx) => (
                          <div
                            key={item.id}
                            className={powerActiveIndex === idx ? styles.active : ""}
                            onClick={ () => { powerStatusClick(idx, item); } }
                          >
                            {item.label}
                          </div>
                        ))}
                      </div>
                      {shouldShowPowerFilterScroll && (
                        <div ref={powerTrackRef} className={styles.selecteScrollTrack}>
                          <div ref={powerThumbRef} className={styles.selecteScrollThumb} />
                        </div>
                      )}
                    </div>
                  )}
              </div>

              <div ref={locationWrapperRef} className={styles.selecteWrapper}>
                <div className={styles.selecte} 
                  onClick={() => setLocationIsOpen(!locationIsOpen)}>
                  <span>{locationActiveIndex === -1 ? "Total" : selectedLocation?.label ?? "위치 상태"}</span>
                  {locationIsOpen ? (
                    <img src="/icon/arrow_up.png" alt="arrow_up" />
                  ) : (
                    <img src="/icon/arrow_down.png" alt="arrow_down" />
                  )}
                </div> 
                {locationIsOpen && (
                  <div className={styles.selectebox}>
                    <div ref={locationScrollRef} className={styles.selecteInner} role="listbox">
                      {/* Total */}
                      <div
                        className={locationActiveIndex === -1 ? styles.active : ""}
                        onClick={() => {
                          setLocationActiveIndex(-1);
                          setSelectedLocation(null);
                          setLocationIsOpen(false);
                          resetCurrentPage();
                        }}
                      >
                        Total
                      </div>

                      {/* 실제 위치 옵션들 */}
                      {locationStatus.map((item, idx) => (
                        <div
                          key={item.id}
                          className={locationActiveIndex === idx ? styles.active : ""}
                          onClick={ () => { locationStatusClick(idx, item);} }
                        >
                          {item.label}
                        </div>
                      ))}
                    </div>
                    {shouldShowLocationFilterScroll && (
                      <div ref={locationTrackRef} className={styles.selecteScrollTrack}>
                        <div ref={locationThumbRef} className={styles.selecteScrollThumb} />
                      </div>
                    )}
                  </div>
                )}
              </div>
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
                    <th>Robot No</th>
                    <th>Robot Info</th>
                    <th>Battery (Return)</th>
                    <th>Network</th>
                    <th>Power</th>
                    <th>Mark</th>
                    <th>Location</th>
                </tr>
            </thead>
            <tbody>
            {currentItems.map((r, idx) => {
              const robotIndex = getRobotIndexFromNo(r.no);
              const robotColor = robotColors[robotIndex];

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
                  <td>
                    <div className={styles.robot_status_icon_div}>
                      <img src={robotInfoIcons.info(r.no)} alt="robot_icon" />
                      <div
                        className={styles["info-box"]}
                        onClick={() => ViewInfoClick(idx, r)}
                      >
                        View Info
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className={styles.robot_status_icon_div}>
                      <img
                        src={robotInfoIcons.battery(r.battery, r.isCharging)}
                        alt="battery"
                      />
                      {r.battery}% ({r.return}%)
                    </div>
                  </td>
                  <td>
                    <div className={styles.robot_status_icon_div}>
                      <img src={robotInfoIcons.network(r.network)} alt="network" />
                      {r.network}
                    </div>
                  </td>
                  <td>
                    <div className={styles.robot_status_icon_div}>
                      <img src={robotInfoIcons.power(r.power)} alt="power" />
                      {r.power}
                    </div>
                  </td>
                  <td>
                    <div className={styles.robot_status_icon_div}>
                      <img src={robotInfoIcons.mark(r.no)} alt="mark" />
                      {r.mark}
                    </div>
                  </td>
                  <td>
                    <div
                      className={`${styles.robot_status_icon_div} ${styles.viewMap}`}
                      onClick={() => {
                        handleLocationClick(idx, r);
                      }}
                    >
                      <div>View Map</div>
                      <div>→</div>
                    </div>
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        </div>
        <RobotDetailModal isOpen={robotDetailModalOpen} onClose={() => setRobotDetailModalOpen(false)}  selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots} />
        <div className={styles.pagePosition}>
          <Pagination totalItems={totalItems} currentPage={currentPage} onPageChange={handleRobotsPageChange} pageSize={ROBOT_PAGE_SIZE} blockSize={5} />
        </div>
        <div className={styles.bottomPosition}>
            <div style={{pointerEvents: isCrudDisabled ? "none" : "auto", opacity: isCrudDisabled ? 0.4 : 1, cursor:"pointer" }}
                  aria-disabled={isCrudDisabled}>
              <RobotCrudBtn />
            </div>
            <div className={styles.robotWorkBox}>
              <div className={styles.robotWorkCommonBtn}
                onClick={() => {
                  if (isWorkScheduleDisabled) return;
                  openWorkScheduleModal();
                }}
                aria-disabled={isWorkScheduleDisabled}
                style={{
                  pointerEvents: isWorkScheduleDisabled ? "none" : "auto",
                  opacity: isWorkScheduleDisabled ? 0.4 : 1,
                }}>
                <img src="/icon/robot_schedule_w.png" alt="" />
                작업일정 복귀
              </div>
              <div className={styles.robotWorkCommonBtn}
                onClick={() => {
                  if (isPlaceMoveDisabled) return;
                  setPlacePathModalOpen(true);
                }}
                aria-disabled={isPlaceMoveDisabled}
                style={{
                  pointerEvents: isPlaceMoveDisabled ? "none" : "auto",
                  opacity: isPlaceMoveDisabled ? 0.4 : 1,
                }}>
                <img src="/icon/robot_place_w.png" alt="" />
                장소 이동
              </div>
              <div className={styles.robotWorkCommonBtn}
                onClick={() => {
                  if (isChargeMoveDisabled) return;
                  setShowConfirm(true);
                  console.log("충전소 이동 robots:", checkedRobotIds);
                }}
                aria-disabled={isChargeMoveDisabled}
                style={{
                  pointerEvents: isChargeMoveDisabled ? "none" : "auto",
                  opacity: isChargeMoveDisabled ? 0.4 : 1,
                }}>
                <img src="/icon/robot_battery_place_w.png" alt="" />
                충전소 이동
              </div>
            </div>
        </div>
        <div></div>
      </div>
      <RobotWorkScheduleModal
        isOpen={robotWorkScheduleModalOpen}
        onClose={() => setRobotWorkScheduleModalOpen(false)}
        selectedRobotIds={checkedRobotIds}
        scheduleCase={workScheduleCase}
        completedPathText={completedPathText}
        onConfirmReturn={() => {
          // TODO: 실제 “작업스케줄 복귀” 명령 API/WS 호출
          console.log("작업스케줄 복귀 실행:", selectedRobotId);
        }}
        onConfirmWhenNone={() => {
          // TODO: 작업일정 등록 페이지 이동 등
          console.log("등록된 작업일정 없음 확인");
          }}
      />
      <PlacePathModal isOpen={placePathModalOpen} onClose={() => setPlacePathModalOpen(false)} selectedRobotIds={checkedRobotIds}/>
      {showConfirm && (
        <BatteryPathModal
          isOpen={showConfirm}
          message="배터리 충전소로 이동하시겠습니까?"
          onConfirm={handleSendLogOk}
          onCancel={handleSendLogCancel}
        />
      )}
        

      <div className={styles.cameraMapView}>
          <h2>위치 맵 & 실시간 카메라</h2>
          <MapView selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots} floors={floors} video={video} cameras={cameras}/>
          <br />
          <CameraViews selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots} floors={floors} video={video} cameras={cameras}/>
          <br />
          <div className={styles.modalOpenBox}>
              <RemoteBtn className={styles.customRemoteDiv} selectedRobots={selectedRobot} robots={robots} video={video} cameras={cameras}/>
              <RobotPathBtn  className={styles.customPathDiv} selectedRobots={selectedRobot} robots={robots} video={video} camera={cameras}/>
          </div>        
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
              <div ref={placeRobotWrapperRef} className={styles.selecteWrapper}>
                <div className={styles.selecte} onClick={() => setPlaceRobotOpen(v => !v)}>
                  <span>{selectedPlaceRobot ?? "로봇명 선택"}</span>
                  <img src={placeRobotOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                </div>
                {placeRobotOpen && (
                  <div className={styles.selectebox}>
                    <div ref={placeRobotScrollRef} className={styles.selecteInner} role="listbox">
                      <div
                        className={!selectedPlaceRobot ? styles.active : ""}
                        onClick={() => { setSelectedPlaceRobot(null); setPlaceRobotOpen(false); setSelectedPlaceId(null); }}
                      >
                        Total
                      </div>
                      {placeRobotOptions.map((no) => (
                        <div
                          key={no}
                          className={selectedPlaceRobot === no ? styles.active : ""}
                          onClick={() => { setSelectedPlaceRobot(no); setPlaceRobotOpen(false); setSelectedPlaceId(null); }}
                        >
                          {no}
                        </div>
                      ))}
                    </div>
                    {shouldShowPlaceRobotScroll && (
                      <div ref={placeRobotTrackRef} className={styles.selecteScrollTrack}>
                        <div ref={placeRobotThumbRef} className={styles.selecteScrollThumb} />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 층별 선택 */}
              <div ref={placeFloorWrapperRef} className={styles.selecteWrapper}>
                <div className={styles.selecte} onClick={() => setPlaceFloorOpen(v => !v)}>
                  <span>{selectedPlaceFloor ?? "층별 선택"}</span>
                  <img src={placeFloorOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                </div>
                {placeFloorOpen && (
                  <div className={styles.selectebox}>
                    <div ref={placeFloorScrollRef} className={styles.selecteInner} role="listbox">
                      <div
                        className={!selectedPlaceFloor ? styles.active : ""}
                        onClick={() => { setSelectedPlaceFloor(null); setPlaceFloorOpen(false); setSelectedPlaceId(null); }}
                      >
                        Total
                      </div>
                      {placeFloorOptions.map((f) => (
                        <div
                          key={f}
                          className={selectedPlaceFloor === f ? styles.active : ""}
                          onClick={() => { setSelectedPlaceFloor(f); setPlaceFloorOpen(false); setSelectedPlaceId(null); }}
                        >
                          {f}
                        </div>
                      ))}
                    </div>
                    {shouldShowPlaceFloorScroll && (
                      <div ref={placeFloorTrackRef} className={styles.selecteScrollTrack}>
                        <div ref={placeFloorThumbRef} className={styles.selecteScrollThumb} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.placeListBox}>
            <table className={`${styles.status} ${styles.placeTable}`}>
              <thead>
                <tr>
                  <th>
                      <img
                        src={
                          isAllCurrentPlaceItemsChecked
                            ? "/icon/robot_chk.png"
                            : "/icon/robot_none_chk.png"
                        }
                        alt="현재 페이지 장소 전체 선택"
                        role="button"
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                        onClick={() => toggleAllCurrentPlaceItems(!isAllCurrentPlaceItemsChecked)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            toggleAllCurrentPlaceItems(!isAllCurrentPlaceItemsChecked);
                          }
                        }}
                      />
                  </th>
                  <th>로봇명</th>
                  <th>층별</th>
                  <th>장소명</th>
                  <th>좌표(X, Y)</th>
                </tr>
              </thead>

              <tbody>
                {currentPlaceItems.map((row) => {
                  const checked = checkedPlaceIds.includes(row.id);

                  return (
                    <tr
                      key={row.id}
                      className={checked ? styles.selectedRow : undefined}
                    >
                      <td>
                        <img
                          src={checked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                          alt=""
                          role="button"
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={() => togglePlaceChecked(row.id, !checked)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              togglePlaceChecked(row.id, !checked);
                            }
                          }}
                        />
                      </td>
                      <td>{row.robotNo}</td>
                      <td>{row.floor}</td>
                      <td>{row.placeName}</td>
                      <td>
                        X {typeof row.x === "number" ? row.x.toFixed(2) : "-"},
                        Y {typeof row.y === "number" ? row.y.toFixed(2) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* pagination(필요 시 Robot 탭과 동일 Pagination 컴포넌트 연결) */}
          <div className={styles.placePagination}>
            <Pagination totalItems={placeTotalItems} currentPage={placePage} onPageChange={handlePlacePageChange} pageSize={PLACE_PAGE_SIZE} blockSize={5} />
          </div>

          <div className={`${styles.bottomPosition} ${styles.placeBottomPosition}`}>
            <div
              className={styles.placePrimaryBtn}
              aria-disabled={!isPlaceCreateEnabled}
              style={{
                pointerEvents: isPlaceCreateEnabled ? "auto" : "none",
                opacity: isPlaceCreateEnabled ? 1 : 0.4,
              }}
              onClick={openPlaceCreate}
            >
              <img src="/icon/check.png" alt="check" />
              <span>장소 등록</span>
            </div>

            <div className={styles.robotWorkBox}>
              <div
                className={styles.robotWorkCommonBtn}
                onClick={openPlaceDelete}
                aria-disabled={!isPlaceDeleteEnabled}
                style={{
                  pointerEvents: isPlaceDeleteEnabled ? "auto" : "none",
                  opacity: isPlaceDeleteEnabled ? 1 : 0.4,
                }}
              >
                {/* 아이콘이 있으면 img로 교체 */}
                <img src="/icon/delete_icon.png" alt="" />
                장소 삭제
              </div>

              <div
                className={styles.robotWorkCommonBtn}
                onClick={openPlaceEdit}
                aria-disabled={selectedPlaceId == null}
                style={{
                  pointerEvents: selectedPlaceId == null ? "none" : "auto",
                  opacity: selectedPlaceId == null ? 0.4 : 1,
                }}
              >
                <img src="/icon/edit_icon.png" alt="" />
                장소 수정
              </div>
            </div>
          </div>
        </div>
        <PlaceCrudModal
          isOpen={placeCreateOpen}
          mode="create"
          robots={robots}
          floors={FLOORS}
          initial={null}
          onClose={() => setPlaceCreateOpen(false)}
          onSubmit={upsertPlace}
        />

        <PlaceCrudModal
          isOpen={placeEditOpen}
          mode="edit"
          robots={robots}
          floors={FLOORS}
          initial={singleCheckedPlaceRow ? toPlaceRowData(singleCheckedPlaceRow) : null}
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

        {/* RIGHT: 위치 맵 */}
        <div className={styles.placeRight}>
          <div className={styles.robotPlaceBox}>
            <h2>위치 맵</h2>
          </div>

          <div className={styles.placeMapCard}>
            <PlaceMapView
              selectedPlaceId={selectedPlaceId}
              selectedPlace={singleCheckedPlaceRow}   // 이미 memo로 계산해둔 값
              placeRows={placeRows}                   // 전체 장소 목록
            />
          </div>
            <div className={styles.placeHint}>
              • 해당 장소의 좌표(X, Y) 입력은 “장소 등록” 화면에서 작성하실 수 있습니다.
            </div>
        </div>
      </div>
    )}

    {activeTab === "path" && (
      <div className={styles.pathWrap}>
        <div className={styles.pathTopBar}>
          <h2>경로 목록</h2>

          <div className={styles.pathFilters}>
            {/* 로봇명 선택 */}
            <div ref={pathRobotWrapperRef} className={styles.selecteWrapper}>
              <div className={styles.selecte} onClick={() => setPathRobotOpen(v => !v)}>
                <span>{selectedPathRobot ?? "로봇명 선택"}</span>
                <img src={pathRobotOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
              </div>

              {pathRobotOpen && (
                <div className={styles.selectebox}>
                  <div ref={pathRobotScrollRef} className={styles.selecteInner} role="listbox">
                    <div
                      className={!selectedPathRobot ? styles.active : ""}
                      onClick={() => {
                        setSelectedPathRobot(null);
                        setPathRobotOpen(false);
                        resetPathSelection();
                      }}
                    >
                      Total
                    </div>

                    {pathRobotOptions.map((no) => (
                      <div
                        key={no}
                        className={selectedPathRobot === no ? styles.active : ""}
                        onClick={() => {
                          setSelectedPathRobot(no);
                          setPathRobotOpen(false);
                          resetPathSelection();
                        }}
                      >
                        {no}
                      </div>
                    ))}
                  </div>
                  {shouldShowPathRobotScroll && (
                    <div ref={pathRobotTrackRef} className={styles.selecteScrollTrack}>
                      <div ref={pathRobotThumbRef} className={styles.selecteScrollThumb} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 작업유형 선택 */}
            <div ref={pathWorkTypeWrapperRef} className={styles.selecteWrapper}>
              <div className={styles.selecte} onClick={() => setPathWorkTypeOpen(v => !v)}>
                <span>{selectedPathWorkType ?? "작업유형 선택"}</span>
                <img src={pathWorkTypeOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
              </div>

              {pathWorkTypeOpen && (
                <div className={styles.selectebox}>
                  <div ref={pathWorkTypeScrollRef} className={styles.selecteInner} role="listbox">
                    <div
                      className={!selectedPathWorkType ? styles.active : ""}
                      onClick={() => {
                        setSelectedPathWorkType(null);
                        setPathWorkTypeOpen(false);
                        resetPathSelection();
                      }}
                    >
                      Total
                    </div>

                    {pathWorkTypeOptions.map((t) => (
                      <div
                        key={t}
                        className={selectedPathWorkType === t ? styles.active : ""}
                        onClick={() => {
                          setSelectedPathWorkType(t);
                          setPathWorkTypeOpen(false);
                          resetPathSelection();
                        }}
                      >
                        {t}
                      </div>
                    ))}
                  </div>
                  {shouldShowPathWorkTypeScroll && (
                    <div ref={pathWorkTypeTrackRef} className={styles.selecteScrollTrack}>
                      <div ref={pathWorkTypeThumbRef} className={styles.selecteScrollThumb} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* table */}
        <div className={styles.pathListBox}>
          <table className={`${styles.status} ${styles.pathTable}`}>
            <thead>
              <tr>
                <th>
                  <img
                    src={isAllCurrentPathItemsChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                    alt="현재 페이지 경로 전체 선택"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    onClick={() => toggleAllCurrentPathItems(!isAllCurrentPathItemsChecked)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        toggleAllCurrentPathItems(!isAllCurrentPathItemsChecked);
                      }
                    }}
                  />
                </th>
                <th>로봇명</th>
                <th>작업유형</th>
                <th>경로명</th>
                <th>경로순서</th>
                <th>변경일시</th>
              </tr>
            </thead>

            <tbody>
              {currentPathItems.map((row) => {
                const checked = checkedPathIds.includes(row.id);

                return (
                  <tr key={row.id} className={checked ? styles.selectedRow : undefined}>
                    <td>
                      <img
                        src={checked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                        alt=""
                        role="button"
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                        onClick={() => togglePathChecked(row.id, !checked)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            togglePathChecked(row.id, !checked);
                          }
                        }}
                      />
                    </td>
                    <td>{row.robotNo}</td>
                    <td>{row.workType}</td>
                    <td>{row.pathName}</td>
                    <td className={styles.pathOrderCell}>
                      <div className={styles.pathOrderText}>{row.pathOrder}</div>
                    </td>
                    <td>{row.updatedAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        <div className={styles.pathPagination}>
          <Pagination
            totalItems={pathTotalItems}
            currentPage={pathPage}
            onPageChange={handlePathPageChange}
            pageSize={PATH_PAGE_SIZE}
            blockSize={5}
          />
        </div>

        {/* bottom buttons */}
        <div className={styles.pathBottomBar}>
          <div
            className={styles.pathPrimaryBtn}
            aria-disabled={!isPathCreateEnabled}
            style={{
              pointerEvents: isPathCreateEnabled ? "auto" : "none",
              opacity: isPathCreateEnabled ? 1 : 0.4,
            }}
            onClick={openPathCreate}
          >
            <img src="/icon/check.png" alt="check" />
            <span>경로 등록</span>
          </div>

          <div className={styles.robotWorkBox}>
            <div
              className={styles.robotWorkCommonBtn}
              onClick={openPathDelete}
              aria-disabled={!isPathDeleteEnabled}
              style={{
                pointerEvents: isPathDeleteEnabled ? "auto" : "none",
                opacity: isPathDeleteEnabled ? 1 : 0.4,
              }}
            >
              <img src="/icon/delete_icon.png" alt="" />
              경로 삭제
            </div>

            <div
              className={styles.robotWorkCommonBtn}
              onClick={openPathEdit}
              aria-disabled={!isPathEditEnabled}
              style={{
                pointerEvents: isPathEditEnabled ? "auto" : "none",
                opacity: isPathEditEnabled ? 1 : 0.4,
              }}
            >
              <img src="/icon/edit_icon.png" alt="" />
              경로 수정
            </div>
          </div>
        </div>
      </div>
    )}
    <PathCrudModal
      isOpen={pathCreateOpen}
      mode="create"
      placeRows={placeRows}
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
    </>
  );
}
