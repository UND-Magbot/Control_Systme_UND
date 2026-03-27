"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from "next/navigation";
import styles from './RobotList.module.css';
import Pagination from "@/app/components/pagination";
import type { RobotRowData, BatteryItem, Camera, Floor, Video, NetworkItem, PowerItem, LocationItem } from '@/app/type';
import RobotInsertModal from "@/app/components/modal/RobotInsertModal";
import RobotDetailModal from "@/app/components/modal/RobotDetailModal";
import CancelConfirmModal from "@/app/components/modal/CancelConfirmModal";
import { API_BASE } from "@/app/config";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import RemoteMapModal from "@/app/components/modal/RemoteMapModal";
import {
  ROBOT_COLORS,
  getRobotIndexFromNo,
} from "@/app/constants/robotIcons";
import { isAdmin } from "@/app/utils/auth";
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

/** 로봇 상태를 계산하는 헬퍼 */
function getRobotStatus(r: RobotRowData): { label: string; className: string } {
  if (r.power === "Off") return { label: "오프라인", className: styles.statusOffline };
  if (r.isCharging) return { label: "충전", className: styles.statusCharging };
  if (r.tasks.length > 0 && r.waitingTime === 0) return { label: "운영", className: styles.statusOperating };
  if (r.waitingTime > 0) return { label: "대기", className: styles.statusStandby };
  return { label: "대기", className: styles.statusStandby };
}

/** 로봇 현재 위치 표시 (API 준비 시 교체 예정) */
// TODO: 백엔드 로봇별 실시간 위치 API (/robot/positions) 완성 후
//       useRobotLocations(robots) 훅으로 교체하여 "1F 대기실" 형태로 표시
function getRobotLocation(r: RobotRowData): string {
  if (r.power === "Off") return "-";
  // 현재는 site 필드로 대체. API 연동 시 floor + placeName 조합으로 교체
  return r.site || "-";
}

/** 로봇 현재 작업 표시 */
function getRobotCurrentTask(r: RobotRowData): string {
  if (r.power === "Off") return "-";
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
  robots: initialRobots,
  floors,
  video,
  batteryStatus,
  networkStatus,
  powerStatus,
  locationStatus,
  robotStats
}: RobotStatusListProps) {

  const robots = useRobotStatus(initialRobots);
  const router = useRouter();
  const admin = useMemo(() => isAdmin(), []);

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

  // 삭제 모드
  const enterDeleteMode = () => { setDeleteMode(true); setCheckedRobotIds([]); setSelectedRobotId(null); setSelectedRobot(null); };
  const exitDeleteMode = () => { setDeleteMode(false); setCheckedRobotIds([]); };

  const confirmDeleteRobots = async () => {
    if (checkedRobotIds.length === 0) return;
    try {
      await Promise.all(checkedRobotIds.map(id => fetch(`${API_BASE}/DB/robots/${id}`, { method: "DELETE" })));
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
        <h1>{activeTab === "robots" ? "로봇 목록" : "사업자 목록"}</h1>
        <div className={styles.robotListTab}>
            <div className={`${activeTab === "robots" ? styles.active : ""}`} onClick={() => handleTabClick("robots")}>로봇 목록</div>
            <div className={`${activeTab === "business" ? styles.active : ""}`} onClick={() => handleTabClick("business")}>사업자 목록</div>
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
                        className={`${styles["viewMap"]} ${!admin ? styles.btnDisabled : ""}`}
                        onClick={(e) => { e.stopPropagation(); if (admin) handleRemoteClick(r); }}
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
    </>
  );
}
