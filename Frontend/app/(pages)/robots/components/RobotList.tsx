"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from "next/navigation";
import styles from './RobotList.module.css';
import Pagination from "@/app/components/pagination";
import type { RobotRowData, BatteryItem, Camera, Floor, Video, NetworkItem, PowerItem, LocationItem } from '@/app/type';
import RobotInsertModal from "@/app/components/modal/RobotInsertModal";
import RobotDetailModal from "@/app/components/modal/RobotDetailModal";
import CancelConfirmModal from "@/app/components/modal/CancelConfirmModal";
import { apiFetch } from "@/app/lib/api";
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
import PathCrudModal, { type RouteRow } from "@/app/(pages)/robots/components/PathCrudModal";
import PathDeleteConfirmModal from "@/app/(pages)/robots/components/PathDeleteConfirmModal";
import { API_BASE } from "@/app/config";
import PathAlertsModal from "@/app/(pages)/robots/components/PathAlertsModal";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import RemoteMapModal from "@/app/components/modal/RemoteMapModal";
import {
  ROBOT_COLORS,
  getRobotIndexFromNo,
} from "@/app/constants/robotIcons";
import { useAuth } from "@/app/context/AuthContext";
import { useRobotStatus } from "@/app/hooks/useRobotStatus";
import BusinessList from './BusinessList';

const ROBOT_PAGE_SIZE = 6;

const STATUS_FILTER_ITEMS = [
  { id: 0, label: "운영" },
  { id: 1, label: "대기" },
  { id: 2, label: "충전" },
  { id: 3, label: "오프라인" },
];

interface RobotStats {
  total: number;
  operating: number;
  standby: number;
  offline: number;
  charging: number;
}

interface RobotStatusListProps {
  cameras: Camera[];
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

/** 로봇 상태를 계산하는 헬퍼 */
function getRobotStatus(r: RobotRowData): { label: string; className: string } {
  if (r.power === "Off" || r.power === "-") return { label: r.power === "-" ? "미확인" : "오프라인", className: styles.statusOffline };
  if (r.isCharging) return { label: "충전", className: styles.statusCharging };
  if (r.tasks.length > 0 && r.waitingTime === 0) return { label: "운영", className: styles.statusOperating };
  if (r.waitingTime > 0) return { label: "대기", className: styles.statusStandby };
  return { label: "대기", className: styles.statusStandby };
}

/** 로봇 현재 위치 표시 (API 준비 시 교체 예정) */
// TODO: 백엔드 로봇별 실시간 위치 API (/robot/positions) 완성 후
//       useRobotLocations(robots) 훅으로 교체하여 "1F 대기실" 형태로 표시
function getRobotLocation(r: RobotRowData): string {
  if (r.power === "Off" || r.power === "-") return "-";
  // 현재는 site 필드로 대체. API 연동 시 floor + placeName 조합으로 교체
  return r.site || "-";
}

/** 로봇 현재 작업 표시 */
function getRobotCurrentTask(r: RobotRowData): string {
  if (r.power === "Off" || r.power === "-") return "-";
  if (r.tasks.length === 0) return "-";
  return r.tasks[0].taskName;
}

/** 배터리 값으로 CSS 클래스 반환 */
function batColorClass(level: number): string {
  if (level > 25) return styles.batSuccess;
  if (level > 10) return styles.batWarning;
  return styles.batDanger;
}

/** 듀얼 배터리 여부 */
function isDualBattery(r: RobotRowData): boolean {
  return r.type === "QUADRUPED" && r.batteryLeft != null && r.batteryRight != null;
}

export default function RobotStatusList({
  cameras,
  floors,
  video,
  batteryStatus,
  networkStatus,
  powerStatus,
  locationStatus,
}: RobotStatusListProps) {

  const [initialRobots, setInitialRobots] = useState<RobotRowData[]>([]);
  const robots = useRobotStatus(initialRobots);
  const router = useRouter();
  const { isAdmin: admin } = useAuth();

  useEffect(() => {
    import("@/app/lib/robotInfo").then((mod) => mod.default()).then(setInitialRobots);
  }, []);

  // 탭 메뉴
  const [activeTab, setActiveTab] = useState<"robots" | "business">("robots");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "robots" || tab === "business") setActiveTab(tab);
    if (tab === "place" || tab === "path") router.replace(`/schedules?tab=${tab}`);
  }, []);

  const handleTabClick = (tab: "robots" | "business") => {
    setActiveTab(tab);
    setSelectedRobotId(null);
    setSelectedRobot(null);
    setCheckedRobotIds([]);
  };

  // ─── 필터 (3개: 검색, 상태, 전원) ───
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedPower, setSelectedPower] = useState<string | null>(null);

  // ─── 체크/선택 ───
  const [checkedRobotIds, setCheckedRobotIds] = useState<number[]>([]);
  const [selectedRobotId, setSelectedRobotId] = useState<number | null>(null);
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);
  const [robotDetailModalOpen, setRobotDetailModalOpen] = useState(false);
  const [robotDetailEditMode, setRobotDetailEditMode] = useState(false);

  // 등록 모달
  const [robotInsertModalOpen, setRobotInsertModalOpen] = useState(false);

  // 삭제 모드
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // 원격 모드 모달
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [remoteTargetRobot, setRemoteTargetRobot] = useState<RobotRowData | null>(null);

  // 페이지네이션
  const [robotsPage, setRobotsPage] = useState(1);
  const handleRobotsPageChange = (page: number) => {
    setRobotsPage(page);
    setCheckedRobotIds([]);
  };
  const resetCurrentPage = () => setRobotsPage(1);

  // ─── 필터 로직 ───
  const filteredRobots = robots.filter((robot) => {
    let matchSearch = true;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      matchSearch =
        robot.no.toLowerCase().includes(q) ||
        robot.serialNumber.toLowerCase().includes(q) ||
        robot.site.toLowerCase().includes(q);
    }

    let matchStatus = true;
    if (selectedStatus) {
      matchStatus = getRobotStatus(robot).label === selectedStatus;
    }

    let matchPower = true;
    if (selectedPower) {
      matchPower = robot.power === selectedPower;
    }

    return matchSearch && matchStatus && matchPower;
  });

  const totalItems = filteredRobots.length;
  const startIndex = (robotsPage - 1) * ROBOT_PAGE_SIZE;
  const currentItems = filteredRobots.slice(startIndex, startIndex + ROBOT_PAGE_SIZE);

  // ─── 체크 핸들러 ───
  const toggleRobotChecked = (robotId: number, checked: boolean) => {
    setCheckedRobotIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, robotId]))
        : prev.filter((id) => id !== robotId);
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
    const currentPageIds = currentItems.map((r) => r.id);
    setCheckedRobotIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, ...currentPageIds]))
        : prev.filter((id) => !currentPageIds.includes(id));
      setSelectedRobotId(next.length === 1 ? next[0] : null);
      return next;
    });
  };

  const isAllCurrentItemsChecked = currentItems.length > 0 && currentItems.every((r) => checkedRobotIds.includes(r.id));

  // viewInfo 클릭 (읽기 모드)
  const ViewInfoClick = (idx: number, robot: RobotRowData) => {
    setSelectedRobotId(robot.id);
    setSelectedRobot(robot);
    setRobotDetailEditMode(false);
    setRobotDetailModalOpen(true);
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
  const [routeRows, setRouteRows] = useState<RouteRow[]>([]);

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
      const res = await fetch(`${API_BASE}/DB/places`);
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

  const fetchRoutes = async () => {
    try {
      const res = await fetch(`${API_BASE}/DB/routes`);
      const data = await res.json();
      setRouteRows(data);
    } catch (e) {
      console.error("도로 목록 로드 실패", e);
      setRouteRows([]);
    }
  };

  useEffect(() => {
    if (activeTab !== "place" && activeTab !== "path") return;
    fetchPlaces();
    if (activeTab === "path") fetchRoutes();
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
  const enterDeleteMode = () => { setDeleteMode(true); setCheckedRobotIds([]); setSelectedRobotId(null); setSelectedRobot(null); };
  const exitDeleteMode = () => { setDeleteMode(false); setCheckedRobotIds([]); };

  const confirmDeleteRobots = async () => {
    if (checkedRobotIds.length === 0) return;
    try {
      await Promise.all(checkedRobotIds.map(id => apiFetch(`/DB/robots/${id}`, { method: "DELETE" })));
      setDeleteConfirmOpen(false); setDeleteMode(false); setCheckedRobotIds([]);
      setSelectedRobotId(null); setSelectedRobot(null);
      window.location.reload();
    } catch (err) { console.error("로봇 삭제 실패:", err); }
  };

  // 등록/수정 통합 버튼
  const handleRegisterOrEdit = () => {
    if (checkedRobotIds.length === 1) {
      // 1대 선택 → 수정 모드로 열기
      const robot = robots.find(r => r.id === checkedRobotIds[0]);
      if (robot) {
        setSelectedRobotId(robot.id);
        setSelectedRobot(robot);
        setRobotDetailEditMode(true);
        setRobotDetailModalOpen(true);
      }
    } else {
      // 선택 없음 → 등록
      setRobotInsertModalOpen(true);
    }
  };

  const isEditMode = checkedRobotIds.length === 1;

  // 원격 모드
  const handleRemoteClick = (robot: RobotRowData) => { setRemoteTargetRobot(robot); setRemoteModalOpen(true); };

  // colSpan
  const colCount = 8 + (deleteMode ? 1 : 0);

  return (
    <>
    <div className="page-header-tab">
        <h1>{activeTab === "robots" ? "로봇 목록" : "사업장 목록"}</h1>
        <div className={styles.robotListTab}>
            <div className={`${activeTab === "robots" ? styles.active : ""}`} onClick={() => handleTabClick("robots")}>로봇 목록</div>
            <div className={`${activeTab === "business" ? styles.active : ""}`} onClick={() => handleTabClick("business")}>사업장 목록</div>
        </div>
    </div>

    {activeTab === "robots" && (
    <div className={styles.RobotListTab}>
      <div className={styles.RobotStatusList}>
        <div className={styles.toolbarRow}>
          <div className={styles.filterRow}>
            <div className={styles.searchWrapper}>
              <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="로봇명, 시리얼, 사이트 검색"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); resetCurrentPage(); }}
              />
              {searchQuery && (
                <button className={styles.searchClear} onClick={() => { setSearchQuery(""); resetCurrentPage(); }}>✕</button>
              )}
            </div>

            <FilterSelectBox
              items={STATUS_FILTER_ITEMS}
              selectedLabel={selectedStatus}
              placeholder="상태"
              width={130}
              onSelect={(item) => { setSelectedStatus(item?.label ?? null); resetCurrentPage(); }}
            />

            <FilterSelectBox
              items={powerStatus.map(p => ({ id: p.id, label: p.label }))}
              selectedLabel={selectedPower}
              placeholder="전원"
              width={130}
              onSelect={(item) => { setSelectedPower(item?.label ?? null); resetCurrentPage(); }}
            />
          </div>

          <div className={styles.topRightGroup}>
            {deleteMode ? (
              <>
                <div
                  className={`${styles.placePrimaryBtn} ${checkedRobotIds.length === 0 ? styles.btnDisabled : ""}`}
                  onClick={() => { if (checkedRobotIds.length > 0) setDeleteConfirmOpen(true); }}
                >
                  <img src="/icon/delete_icon.png" alt="" />
                  <span>삭제 확인 ({checkedRobotIds.length})</span>
                </div>
                <div className={styles.robotWorkCommonBtn} onClick={exitDeleteMode}>취소</div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.primaryActionBtn}
                  onClick={() => setRobotInsertModalOpen(true)}
                >
                  <img src="/icon/edit_icon.png" alt="" />
                  등록
                </button>
                <div
                  className={`${styles.robotWorkCommonBtn} ${checkedRobotIds.length !== 1 ? styles.btnDisabled : ""}`}
                  onClick={() => {
                    if (checkedRobotIds.length === 1) {
                      const robot = robots.find(r => r.id === checkedRobotIds[0]);
                      if (robot) {
                        setSelectedRobotId(robot.id);
                        setSelectedRobot(robot);
                        setRobotDetailEditMode(true);
                        setRobotDetailModalOpen(true);
                      }
                    }
                  }}
                >
                  <img src="/icon/edit_icon.png" alt="" />
                  수정
                </div>
                <div className={styles.robotWorkCommonBtn} onClick={enterDeleteMode}>
                  <img src="/icon/delete_icon.png" alt="" />
                  삭제
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.statusListBox}>
          <table className={styles.status}>
            <thead>
                <tr>
                    {deleteMode && (
                      <th>
                        <img
                          src={isAllCurrentItemsChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                          alt="전체 선택" role="button" tabIndex={0} style={{ cursor: "pointer" }}
                          onClick={() => toggleAllCurrentItems(!isAllCurrentItemsChecked)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleAllCurrentItems(!isAllCurrentItemsChecked); }}
                        />
                      </th>
                    )}
                    <th>No</th>
                    <th>로봇명</th>
                    <th>상태</th>
                    <th>현재 위치</th>
                    <th>현재 작업</th>
                    <th>배터리 (복귀)</th>
                    <th>전원</th>
                    <th>정보</th>
                </tr>
            </thead>
            <tbody>
            {currentItems.length === 0 && (
              <tr><td colSpan={colCount} className={styles.emptyState}>표시할 로봇이 없습니다.</td></tr>
            )}
            {currentItems.map((r, idx) => {
              const robotIndex = getRobotIndexFromNo(r.no);
              const robotColor = ROBOT_COLORS[robotIndex];
              const status = getRobotStatus(r);

              return (
                <tr
                  key={r.no}
                  className={checkedRobotIds.includes(r.id) ? styles.selectedRow : undefined}
                  style={{ "--robot-color": robotColor } as React.CSSProperties}
                  onClick={() => {
                    if (deleteMode) return;
                    // 일반 모드: 행 클릭으로 단일 선택 토글
                    if (checkedRobotIds.includes(r.id)) {
                      setCheckedRobotIds([]);
                      setSelectedRobotId(null);
                      setSelectedRobot(null);
                    } else {
                      setCheckedRobotIds([r.id]);
                      setSelectedRobotId(r.id);
                      setSelectedRobot(r);
                    }
                  }}
                >
                  {deleteMode && (
                    <td>
                      <img
                        src={checkedRobotIds.includes(r.id) ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                        alt={`${r.no} 선택`} role="button" tabIndex={0} style={{ cursor: "pointer" }}
                        onClick={() => toggleRobotChecked(r.id, !checkedRobotIds.includes(r.id))}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleRobotChecked(r.id, !checkedRobotIds.includes(r.id)); }}
                      />
                    </td>
                  )}
                  <td>{startIndex + idx + 1}</td>
                  <td><div>{r.no}</div></td>
                  <td><span className={`${styles.statusBadge} ${status.className}`}>{status.label}</span></td>
                  <td className={styles.locationCell}>{getRobotLocation(r)}</td>
                  <td className={styles.taskCell}>{getRobotCurrentTask(r)}</td>
                  <td>
                    {isDualBattery(r) ? (
                      <>
                        <span className={batColorClass(r.batteryLeft!)}>L {r.batteryLeft}%</span>
                        <span style={{ color: "var(--text-muted)" }}> / </span>
                        <span className={batColorClass(r.batteryRight!)}>R {r.batteryRight}%</span>
                        <span style={{ color: "var(--text-muted)" }}> ({r.return}%)</span>
                      </>
                    ) : (
                      <>
                        <span className={batColorClass(r.battery)}>{r.battery}%</span>
                        <span style={{ color: "var(--text-muted)" }}> ({r.return}%)</span>
                      </>
                    )}
                  </td>
                  <td>{r.power}</td>
                  <td>
                    <div className={styles.infoBtnGroup}>
                      <div className={styles["info-box"]} onClick={(e) => { e.stopPropagation(); ViewInfoClick(idx, r); }}>상세보기</div>
                      <div
                        className={`${styles["viewMap"]} ${!admin || r.power !== "On" ? styles.btnDisabled : ""}`}
                        onClick={(e) => { e.stopPropagation(); if (admin && r.power === "On") handleRemoteClick(r); }}
                        title={r.power !== "On" ? "로봇 전원이 꺼져있습니다" : undefined}
                      >원격</div>
                    </div>
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        </div>

        <RobotInsertModal isOpen={robotInsertModalOpen} onClose={() => setRobotInsertModalOpen(false)} />
        <RobotDetailModal isOpen={robotDetailModalOpen} onClose={() => { setRobotDetailModalOpen(false); setRobotDetailEditMode(false); }} selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots} initialEditMode={robotDetailEditMode} />
        {remoteModalOpen && remoteTargetRobot && (
          <RemoteMapModal isOpen={remoteModalOpen} onClose={() => setRemoteModalOpen(false)} selectedRobots={remoteTargetRobot} robots={robots} video={video} camera={cameras} primaryView="map" />
        )}
        {deleteConfirmOpen && (
          <CancelConfirmModal
            message={checkedRobotIds.length <= 1 ? "선택한 로봇을 정말 삭제하시겠습니까?" : `${checkedRobotIds.length}대의 로봇을 정말 삭제하시겠습니까?`}
            onConfirm={confirmDeleteRobots} onCancel={() => setDeleteConfirmOpen(false)}
          />
        )}
        <div className={styles.pagePosition}>
          <Pagination totalItems={totalItems} currentPage={robotsPage} onPageChange={handleRobotsPageChange} pageSize={ROBOT_PAGE_SIZE} blockSize={5} />
        </div>
      </div>
    </div>
    )}

    {activeTab === "business" && <BusinessList />}

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
      routes={routeRows}
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
      routes={routeRows}
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
