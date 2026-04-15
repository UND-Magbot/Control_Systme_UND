"use client";

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from "next/dynamic";
import styles from '../../OperationManagementTabs.module.css';
import Pagination from "@/app/components/common/Pagination";
import { usePaginatedList } from "@/app/hooks/usePaginatedList";
import type { RobotRowData, Camera, Video, PowerItem } from '@/app/types';
import { apiFetch } from "@/app/lib/api";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";

const RobotInsertModal = dynamic(() => import("@/app/components/modal/RobotInsertModal"), { ssr: false });
const RobotDetailModal = dynamic(() => import("./RobotDetailModal"), { ssr: false });
const CancelConfirmModal = dynamic(() => import("@/app/components/modal/CancelConfirmModal"), { ssr: false });
const RemoteMapModal = dynamic(() => import("./RemoteMapModal"), { ssr: false });
const ModuleManageModal = dynamic(() => import("./ModuleManageModal"), { ssr: false });
import {
  ROBOT_COLORS,
  getRobotIndexFromNo,
} from "@/app/constants/robotIcons";
import ChargingIcon from "@/app/components/common/ChargingIcon";
import { useAuth } from "@/app/context/AuthContext";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import { usePageReady } from "@/app/context/PageLoadingContext";

const ROBOT_PAGE_SIZE = 6;

const STATUS_FILTER_ITEMS = [
  { id: 0, label: "작업 중" },
  { id: 1, label: "대기 중" },
  { id: 2, label: "충전 중" },
  { id: 3, label: "오프라인" },
  { id: 4, label: "오류" },
  { id: 5, label: "도킹 중" },
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
  video: Video[];
  powerStatus: PowerItem[];
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

/** 로봇 상태를 계산하는 헬퍼 (대시보드와 통일) */
function getRobotStatus(r: RobotRowData, hasActiveSchedule = false): { label: string; className: string; tooltip: string } {
  if (r.power === "-") return { label: "미확인", className: styles.statusOffline, tooltip: "" };
  if (r.network === "Offline" || r.power === "Off") return { label: "오프라인", className: styles.statusOffline, tooltip: "" };
  if (r.network === "Error") return { label: "오류", className: styles.statusError, tooltip: "" };
  // 충전 관련 상태 (chargeState: 1=부두 이동, 2=충전 중, 3=나가기, 4=오류, 5=전류 없음)
  if (r.chargeState === 4) return { label: "충전 오류", className: styles.statusError, tooltip: r.chargeErrorMsg ?? "" };
  if (r.chargeState === 5) return { label: "전류 없음", className: styles.statusError, tooltip: "부두에 있지만 전류가 흐르지 않음" };
  if (r.chargeState === 1) return { label: "부두로 이동", className: styles.statusDocking, tooltip: "" };
  if (r.chargeState === 2) return { label: "충전 중", className: styles.statusCharging, tooltip: "" };
  if (r.chargeState === 3) return { label: "부두에서 나가기", className: styles.statusDocking, tooltip: "" };
  if (r.dockingTime > 0) return { label: "도킹 중", className: styles.statusDocking, tooltip: "" };
  if (hasActiveSchedule || r.tasks.length > 0) return { label: "작업 중", className: styles.statusOperating, tooltip: "" };
  return { label: "대기 중", className: styles.statusStandby, tooltip: "" };
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
  if (r.power === "Off" || r.power === "-") return "";
  if (r.tasks.length === 0) return "-";
  return r.tasks[0].taskName;
}

/** 배터리 값으로 CSS 클래스 반환 */
function batColorClass(level: number): string {
  if (level > 25) return styles.batSuccess;
  if (level > 10) return styles.batWarning;
  return styles.batDanger;
}

/** 듀얼 배터리 여부 (4족이면 통신 여부와 무관하게 L/R 표시) */
function isDualBattery(r: RobotRowData): boolean {
  return r.type === "QUADRUPED";
}

export default function RobotManageTab({
  cameras,
  video,
  powerStatus,
}: RobotStatusListProps) {

  const { robots, loaded } = useRobotStatusContext();

  const { user } = useAuth();
  const admin = user?.role === 1 || user?.role === 2;
  const setPageReady = usePageReady();

  useEffect(() => {
    if (loaded) setPageReady();
  }, [loaded, setPageReady]);

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

  // 진행 중인 스케줄 (5초 폴링)
  type ActiveSchedule = {
    id: number;
    RobotName: string;
    WorkName: string;
    TaskType: string;
    TaskStatus: string;
    WayName: string;
    StartDate: string;
    EndDate: string;
    Repeat: string;
    Repeat_Day: string | null;
    ScheduleMode?: string;
    ExecutionTime?: string | null;
    ActiveStartTime?: string | null;
    ActiveEndTime?: string | null;
    IntervalMinutes?: number | null;
  };
  const [activeSchedules, setActiveSchedules] = useState<ActiveSchedule[]>([]);

  useEffect(() => {
    const fetchActive = () => {
      apiFetch(`/DB/schedule`)
        .then((res) => res.json())
        .then((data: ActiveSchedule[]) => {
          setActiveSchedules(
            Array.isArray(data)
              ? data.filter((s) => s.TaskStatus === "진행중" || s.TaskStatus === "진행")
              : []
          );
        })
        .catch(() => setActiveSchedules([]));
    };
    fetchActive();
    const timer = setInterval(fetchActive, 5_000);
    return () => clearInterval(timer);
  }, []);

  const getActiveScheduleForRobot = (robotName: string): ActiveSchedule | null => {
    return activeSchedules.find((s) => s.RobotName === robotName) ?? null;
  };

  // 원격 모드 모달
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [remoteTargetRobot, setRemoteTargetRobot] = useState<RobotRowData | null>(null);

  // 장치관리 모달
  const [moduleModalOpen, setModuleModalOpen] = useState(false);
  const [moduleTargetRobot, setModuleTargetRobot] = useState<RobotRowData | null>(null);

  // ─── 필터 로직 (메모이제이션) ───
  const filteredRobots = useMemo(() => robots.filter((robot) => {
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
      matchStatus = getRobotStatus(robot, !!activeSchedules.find(s => s.RobotName === robot.no)).label === selectedStatus;
    }

    let matchPower = true;
    if (selectedPower) {
      matchPower = robot.power === selectedPower;
    }

    return matchSearch && matchStatus && matchPower;
  }), [robots, searchQuery, selectedStatus, selectedPower, activeSchedules]);

  // 페이지네이션
  const { currentPage: robotsPage, setPage: setRobotsPage, resetPage: resetCurrentPage, pagedItems: currentItems, totalItems } = usePaginatedList(filteredRobots, {
    pageSize: ROBOT_PAGE_SIZE,
    resetDeps: [searchQuery, selectedStatus, selectedPower],
  });

  const handleRobotsPageChange = (page: number) => {
    setRobotsPage(page);
    setCheckedRobotIds([]);
  };

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

  // 장치관리
  const handleModuleClick = (robot: RobotRowData) => { setModuleTargetRobot(robot); setModuleModalOpen(true); };

  // colSpan
  const colCount = 8 + (deleteMode ? 1 : 0);

  return (
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
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className={styles.searchClear} onClick={() => setSearchQuery("")}>✕</button>
              )}
            </div>

            <FilterSelectBox
              items={STATUS_FILTER_ITEMS}
              selectedLabel={selectedStatus}
              placeholder="상태"
              width={130}
              onSelect={(item) => setSelectedStatus(item?.label ?? null)}
            />

            <FilterSelectBox
              items={powerStatus.map(p => ({ id: p.id, label: p.label }))}
              selectedLabel={selectedPower}
              placeholder="전원"
              width={130}
              onSelect={(item) => setSelectedPower(item?.label ?? null)}
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
              const status = getRobotStatus(r, !!getActiveScheduleForRobot(r.no));

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
                  <td>{(robotsPage - 1) * ROBOT_PAGE_SIZE + idx + 1}</td>
                  <td><div>{r.no}</div></td>
                  <td><span className={`${styles.statusBadge} ${status.className}`} title={status.tooltip}>{status.label}</span></td>
                  <td className={styles.locationCell}>{getRobotLocation(r)}</td>
                  <td className={styles.taskCell}>
                    {(() => {
                      const active = getActiveScheduleForRobot(r.no);
                      if (!active) return getRobotCurrentTask(r);
                      const mode = active.ScheduleMode || (active.Repeat === "Y" ? "weekly" : "once");
                      const modeLabel = mode === "weekly" ? "요일반복" : mode === "interval" ? "주기반복" : "단일";
                      const modeBadgeClass = mode === "weekly" ? styles.taskCellBadgeWeekly : mode === "interval" ? styles.taskCellBadgeInterval : styles.taskCellBadgeOnce;
                      // 현재 실행 중인 시각 계산
                      let time: string;
                      if (mode === "weekly" && active.ExecutionTime) {
                        const now = new Date();
                        const nowMin = now.getHours() * 60 + now.getMinutes();
                        const times = active.ExecutionTime.split(",").map((t: string) => {
                          const [h, m] = t.trim().split(":").map(Number);
                          return { min: h * 60 + m, str: `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}` };
                        }).sort((a, b) => a.min - b.min);
                        let current = times[0];
                        for (let i = times.length - 1; i >= 0; i--) {
                          if (times[i].min <= nowMin) { current = times[i]; break; }
                        }
                        time = current.str;
                      } else if (mode === "interval") {
                        time = active.ActiveStartTime || `${String(new Date(active.StartDate).getHours()).padStart(2,"0")}:${String(new Date(active.StartDate).getMinutes()).padStart(2,"0")}`;
                      } else {
                        const dt = new Date(active.StartDate);
                        time = `${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
                      }
                      return (
                        <div className={styles.taskCellActive}>
                          <div className={styles.taskCellRow}>
                            <span className={styles.taskCellName}>{active.WorkName}</span>
                          </div>
                          <div className={styles.taskCellRow}>
                            <span className={`${styles.taskCellBadge} ${modeBadgeClass}`}>{modeLabel}</span>
                            <span className={`${styles.taskCellBadge} ${styles.taskCellBadgeType}`}>{active.TaskType}</span>
                            <span className={styles.taskCellSub}>{time} 실행</span>
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    {isDualBattery(r) ? (
                      <>
                        <span style={{ color: "#e0e0e0" }}>L </span><span className={r.batteryLeft != null ? batColorClass(r.batteryLeft) : ""}>{r.batteryLeft != null ? `${r.batteryLeft}%` : "-"}</span>
                        <span style={{ color: "var(--text-muted)" }}> / </span>
                        <span style={{ color: "#e0e0e0" }}>R </span><span className={r.batteryRight != null ? batColorClass(r.batteryRight) : ""}>{r.batteryRight != null ? `${r.batteryRight}%` : "-"}</span>
                        <span style={{ color: "var(--text-muted)" }}> ({r.return}%)</span>
                      </>
                    ) : (
                      <>
                        <span className={batColorClass(r.battery)}>{r.battery}%</span>
                        <span style={{ color: "var(--text-muted)" }}> ({r.return}%)</span>
                      </>
                    )}
                  </td>
                  <td>{r.network === "Online" ? r.power : "Off"}</td>
                  <td>
                    <div className={styles.infoBtnGroup}>
                      <div className={styles["info-box"]} onClick={(e) => { e.stopPropagation(); ViewInfoClick(idx, r); }}>상세보기</div>
                      <div
                        className={styles["viewMap"]}
                        onClick={(e) => { e.stopPropagation(); handleModuleClick(r); }}
                      >장치관리</div>
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
        <RobotDetailModal isOpen={robotDetailModalOpen} onClose={() => { setRobotDetailModalOpen(false); setRobotDetailEditMode(false); }} selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots} initialEditMode={robotDetailEditMode} activeSchedule={selectedRobot ? getActiveScheduleForRobot(selectedRobot.no) : null} />
        {remoteModalOpen && remoteTargetRobot && (
          <RemoteMapModal isOpen={remoteModalOpen} onClose={() => setRemoteModalOpen(false)} selectedRobots={remoteTargetRobot} robots={robots} video={video} camera={cameras} primaryView="map" />
        )}
        {moduleModalOpen && moduleTargetRobot && (
          <ModuleManageModal
            isOpen={moduleModalOpen}
            onClose={() => setModuleModalOpen(false)}
            robotId={moduleTargetRobot.id}
            robotName={moduleTargetRobot.no}
            isAdmin={admin}
          />
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
  );
}
