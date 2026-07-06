"use client";

import React, { useState } from "react";
import styles from "./RobotCardList.module.css";
import type { RobotRowData, Camera, Video } from "@/app/types";
import { useAuth } from "@/app/context/AuthContext";
import {
  ROBOT_TYPE_COLOR,
  ROBOT_TYPE_INDEX,
  getBatteryColor,
  isCriticalBattery,
  isSingleBatteryMode,
} from "@/app/constants/robotIcons";
import { isDualBatteryType } from "@/app/constants/robotCapabilities";
import ChargingIcon from "@/app/components/common/ChargingIcon";
import { apiFetch } from "@/app/lib/api";
import { useModalAlert } from "@/app/hooks/useModalAlert";
import AlertModal from "@/app/components/modal/AlertModal";
import dynamic from "next/dynamic";

const PlacePathModal = dynamic(() => import("@/app/components/modal/PlacePathModal"), { ssr: false });
const BatteryPathModal = dynamic(() => import("@/app/components/modal/BatteryChargeModal"), { ssr: false });
const FloorChangeModal = dynamic(() => import("./FloorChangeModal"), { ssr: false });
const ReturnToWorkModal = dynamic(() => import("./ReturnToWorkModal"), { ssr: false });
const RemoteModal = dynamic(() => import("@/app/components/modal/remote/RemoteModal"), { ssr: false });

// 완충 판정 임계(%) — 이 이상이면 charge_state 5(도크·전류없음)를 트리클 off 정상(도크 유지)으로
// 보고 '충전 중'으로 표시한다. 완충 아닌데 state 5면 진짜 도킹 에러('전류 없음'). (백엔드 CHARGE_FULL_PCT 와 동일)
const CHARGE_FULL_PCT = 90;

type RobotLocation = {
  floor: string;
  placeName: string | null;
};

type RobotCardProps = {
  robot: RobotRowData;
  isSelected: boolean;
  onClick: () => void;
  robots: RobotRowData[];
  video: Video[];
  cameras: Camera[];
  robotLocation: RobotLocation;
  floors?: { id: number; label: string }[];
  canControlRobot?: boolean;
  hasActiveSchedule?: boolean;
};

const ROBOT_ICONS = [
  "/icon/robot_icon(1).png",
  "/icon/robot_icon(2).png",
  "/icon/robot_icon(3).png",
  "/icon/robot_icon(4).png",
];

export default function RobotCard({ robot, isSelected, onClick, robots, video, cameras, robotLocation, floors = [], canControlRobot = true, hasActiveSchedule = false }: RobotCardProps) {
  const { modal, modalAlert, closeModal } = useModalAlert();
  const { user } = useAuth();
  // 원격 제어 노출 기준 — 운영관리 "원격" 버튼과 동일하게 role 1(관리자)·2(매니저) 허용
  const canRemote = user?.role === 1 || user?.role === 2;
  const currentFloorName = floors.find((f) => f.id === robot.currentFloorId)?.label ?? "층";
  const typeIdx = ROBOT_TYPE_INDEX[robot.type] ?? 0;
  const isUnregistered = robot.power === "-";
  const isPowerOff = robot.power === "Off";
  const isInactive = isUnregistered || isPowerOff;
  const dotClass = styles[`dot${robot.network}`] ?? styles.dotOffline;
  const badgeClass = styles[`badge${robot.network}`] ?? styles.badgeOffline;
  const isOnline = robot.network === "Online";

  // 작업 상태 파생
  const taskStatus = (() => {
    if (robot.power === "-") return { label: "미확인", className: styles.taskIdle, tooltip: "" };
    if (robot.network === "Offline") return { label: "-", className: styles.taskIdle, tooltip: "" };
    // 전환 구간의 Error 는 '통신 끊김'을 뜻한다(전원 off 는 백엔드에서 Online 유지 → 여기 안 옴).
    if (robot.network === "Error") return { label: "끊김", className: styles.taskError, tooltip: "통신 연결이 끊겼습니다." };
    // 충전 관련 상태 (chargeState: 1=도크 이동, 2=충전 중, 3=나가기, 4=오류, 5=전류 없음)
    if (robot.chargeState === 4) return { label: "충전 오류", className: styles.taskError, tooltip: robot.chargeErrorMsg ?? "" };
    if (robot.chargeState === 5) {
      // state 5(도크·전류없음): 완충이면 트리클 off 정상(도크 유지) → '충전 중'.
      // 미완충이면 '전류 없음'이나, 완충 트리클 오실레이션(정상)과 시각적으로 구분되지 않아
      // 사용자가 오류로 오인하므로 색은 '충전 중'과 동일(초록)으로 두고 라벨/툴팁으로만 구분한다.
      const battPct = isDualBatteryType(robot.type)
        ? Math.min(robot.batteryLeft ?? 0, robot.batteryRight ?? 0)
        : (robot.battery ?? 0);
      if (battPct >= CHARGE_FULL_PCT) return { label: "충전 중", className: styles.taskCharging, tooltip: "완충 — 충전소 도킹 유지 중" };
      return { label: "전류 없음", className: styles.taskCharging, tooltip: "도크에 있지만 전류가 흐르지 않음" };
    }
    if (robot.chargeState === 1) return { label: "도크로 이동", className: styles.taskDocking, tooltip: "" };
    if (robot.chargeState === 2) return { label: "충전 중", className: styles.taskCharging, tooltip: "" };
    if (robot.chargeState === 3) return { label: "도크에서 나가기", className: styles.taskDocking, tooltip: "" };
    // charge_state(relay 수신)가 충전/완충/도킹 상태(2·5·1·3)를 이미 표시하므로, is_charging/atDock
    // 폴백은 제거한다. (이전엔 언도킹 직후 charge_state=0(대기)인데 is_charging 이 sticky 로 남아
    //  '충전 중'이 잠깐 잘못 표시되는 잔상이 있었다.)
    if (robot.dockingTime > 0) return { label: "도킹 중", className: styles.taskDocking, tooltip: "" };
    if (hasActiveSchedule || robot.tasks.length > 0 || robot.isNavigating) return { label: "작업 중", className: styles.taskWorking, tooltip: "" };
    return { label: "대기 중", className: styles.taskIdle, tooltip: "" };
  })();

  const [placeModalOpen, setPlaceModalOpen] = useState(false);
  const [chargeConfirmOpen, setChargeConfirmOpen] = useState(false);
  const [undockConfirmOpen, setUndockConfirmOpen] = useState(false);
  const [emergencyConfirmOpen, setEmergencyConfirmOpen] = useState(false);
  const [floorChangeOpen, setFloorChangeOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);

  const handleScheduleReturn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setReturnModalOpen(true);
  };

  const handleReturnSelect = (mode: "direct" | "retrace") => {
    apiFetch(`/robot/return-to-work?mode=${mode}`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "error") modalAlert(data.msg);
      })
      .catch((err) => console.error("작업 복귀 실패", err));
    setReturnModalOpen(false);
  };

  const handlePlaceMove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPlaceModalOpen(true);
  };

  const handleEmergencyStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEmergencyConfirmOpen(true);
  };

  const handleEmergencyConfirm = () => {
    apiFetch(`/nav/stopmove`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        modalAlert(data?.was_active ? "작업이 중지되었습니다." : "진행 중인 작업이 없습니다.");
      })
      .catch((err) => console.error("긴급 정지 실패", err));
    setEmergencyConfirmOpen(false);
  };

  const handleChargeMove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (robot.atDock) {
      // 도킹 점유(충전 중 + 완충 후 대기) → 도킹에서 빠져나오기(언도킹)
      setUndockConfirmOpen(true);
      return;
    }
    // 도킹 밖 → 충전소로 이동
    setChargeConfirmOpen(true);
  };

  const handleChargeConfirm = () => {
    apiFetch(`/robot/return-to-charge`, {
      method: "POST",
    }).catch((err) => console.error("충전소 이동 실패", err));
    setChargeConfirmOpen(false);
  };

  const handleUndockConfirm = () => {
    apiFetch(`/robot/undock`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "error") modalAlert(data.msg);
      })
      .catch((err) => console.error("언도킹 실패", err));
    setUndockConfirmOpen(false);
  };

  return (
    <>
      <div
        className={`${styles.card} ${isSelected ? styles.cardSelected : ""} ${isInactive ? styles.cardPowerOff : ""}`}
        onClick={isInactive ? undefined : onClick}
      >
        <div className={styles.cardInfo}>
          <div className={styles.cardTop}>
            <span className={styles.robotName}>
              {robot.no}
            </span>
            <button
              className={`${styles.floorChangeBtn} ${isInactive ? styles.floorChangeBtnDisabled : ""}`}
              onClick={(e) => { e.stopPropagation(); if (!isInactive) setFloorChangeOpen(true); }}
              title="현재 층 변경"
              disabled={isInactive}
            >
              현재 층 변경
            </button>
            {/* 원격 제어 — 운영관리를 거치지 않고 카드에서 바로 진입 (role 1·2 + 전원 On) */}
            {canRemote && (
              <button
                className={`${styles.floorChangeBtn} ${robot.power !== "On" ? styles.floorChangeBtnDisabled : ""}`}
                onClick={(e) => { e.stopPropagation(); if (robot.power === "On") setRemoteOpen(true); }}
                title={robot.power === "On" ? "원격 제어" : "로봇 전원이 꺼져있습니다"}
                disabled={robot.power !== "On"}
              >
                원격 제어
              </button>
            )}
            <span className={`${styles.networkBadge} ${badgeClass}`}>
              <span className={`${styles.dot} ${dotClass}`} />
              {isUnregistered ? "Offline" : robot.network === "Error" ? "끊김" : robot.network}
            </span>
          </div>

          <div className={styles.cardBottom}>
            <span className={isCriticalBattery(robot) ? styles.criticalBattery : ""}>
              {isDualBatteryType(robot.type) ? (
                isSingleBatteryMode(robot) ? (
                  (() => {
                    const left = robot.batteryLeft ?? 0;
                    const right = robot.batteryRight ?? 0;
                    const isLeft = left >= right;
                    const single = isLeft ? robot.batteryLeft : robot.batteryRight;
                    return single != null ? (
                      <>
                        <span style={{ color: "var(--text-primary)" }}>{isLeft ? "L" : "R"} </span>
                        <span style={{ color: getBatteryColor(single, robot.return, isOnline) }}>{single}%</span>
                        <span style={{ color: "var(--text-muted)" }}> ({robot.return}%)</span>
                      </>
                    ) : (
                      <span>- ({robot.return}%)</span>
                    );
                  })()
                ) : (
                  (() => {
                    const hasLeft = robot.batteryLeft != null;
                    const hasRight = robot.batteryRight != null;
                    if (hasLeft && hasRight) {
                      return (
                        <>
                          <span style={{ color: "var(--text-primary)" }}>L </span>
                          <span style={{ color: getBatteryColor(robot.batteryLeft!, robot.return, isOnline) }}>{robot.batteryLeft}%</span>
                          <span style={{ color: "var(--text-muted)" }}> / </span>
                          <span style={{ color: "var(--text-primary)" }}>R </span>
                          <span style={{ color: getBatteryColor(robot.batteryRight!, robot.return, isOnline) }}>{robot.batteryRight}%</span>
                          <span style={{ color: "var(--text-muted)" }}> ({robot.return}%)</span>
                        </>
                      );
                    }
                    const active = hasLeft ? robot.batteryLeft! : hasRight ? robot.batteryRight! : null;
                    const label = hasLeft ? "L" : "R";
                    return active != null ? (
                      <>
                        <span style={{ color: "var(--text-primary)" }}>{label} </span>
                        <span style={{ color: getBatteryColor(active, robot.return, isOnline) }}>{active}%</span>
                        <span style={{ color: "var(--text-muted)" }}> ({robot.return}%)</span>
                      </>
                    ) : (
                      <span>- ({robot.return}%)</span>
                    );
                  })()
                )
              ) : (
                <span style={{ color: getBatteryColor(robot.battery, robot.return, isOnline) }}>
                  {robot.battery}% ({robot.return}%)
                </span>
              )}
            </span>
            <span className={styles.floorLabel}>
              {isUnregistered ? "-" : (
                <>{robotLocation.floor}{robotLocation.placeName ? ` · ${robotLocation.placeName}` : ""}</>
              )}
            </span>
            {(!isPowerOff && !isUnregistered) && (
              <span className={`${styles.taskBadge} ${taskStatus.className}`} title={taskStatus.tooltip || undefined}>
                {taskStatus.label === "충전 중" && isOnline && <ChargingIcon size={12} style={{ marginLeft: 0, marginRight: 3 }} />}
                {taskStatus.label}
              </span>
            )}
          </div>

          {/* 선택된 카드에만 액션 버튼 표시 */}
          {isSelected && (
            <div className={styles.actionRow}>
              {canControlRobot && (
                <>
                  <button className={styles.actionBtn} onClick={handleScheduleReturn} disabled={!isOnline}>작업 복귀</button>
                  <button className={styles.actionBtn} onClick={handleChargeMove} disabled={!isOnline}>{robot.atDock ? "충전 해제" : "충전소 이동"}</button>
                  <button className={styles.actionBtn} onClick={handlePlaceMove} disabled={!isOnline}>장소 이동</button>
                </>
              )}
              <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleEmergencyStop} disabled={!isOnline || !(robot.isNavigating || hasActiveSchedule)}>긴급 정지</button>
            </div>
          )}
        </div>
      </div>

      {placeModalOpen && (
        <PlacePathModal
          isOpen={placeModalOpen}
          onClose={() => setPlaceModalOpen(false)}
          selectedRobotIds={[robot.id]}
        />
      )}

      {chargeConfirmOpen && (
        <BatteryPathModal
          isOpen={chargeConfirmOpen}
          message={(robot.isNavigating || hasActiveSchedule)
            ? "현재 진행 중인 작업을 중단하고, 충전소로 이동하시겠습니까?"
            : "충전소로 이동하시겠습니까?"}
          onConfirm={handleChargeConfirm}
          onCancel={() => setChargeConfirmOpen(false)}
        />
      )}

      {undockConfirmOpen && (
        <BatteryPathModal
          isOpen={undockConfirmOpen}
          message={robot.isCharging
            ? "현재 로봇이 충전 중입니다.\n충전을 해제하시겠습니까?"
            : "충전을 해제하고 도킹에서 나옵니다.\n이동하시겠습니까?"}
          onConfirm={handleUndockConfirm}
          onCancel={() => setUndockConfirmOpen(false)}
        />
      )}

      {emergencyConfirmOpen && (
        <BatteryPathModal
          isOpen={emergencyConfirmOpen}
          message="긴급 정지하시겠습니까?"
          onConfirm={handleEmergencyConfirm}
          onCancel={() => setEmergencyConfirmOpen(false)}
        />
      )}

      {returnModalOpen && (
        <ReturnToWorkModal
          isOpen={returnModalOpen}
          onSelect={handleReturnSelect}
          onCancel={() => setReturnModalOpen(false)}
        />
      )}

      {floorChangeOpen && (
        <FloorChangeModal
          isOpen={floorChangeOpen}
          robotId={robot.id}
          robotName={robot.no}
          currentFloorId={robot.currentFloorId}
          currentMapId={robot.currentMapId}
          onClose={() => setFloorChangeOpen(false)}
          onComplete={() => {}}
        />
      )}

      {remoteOpen && (
        <RemoteModal
          isOpen={remoteOpen}
          onClose={() => setRemoteOpen(false)}
          selectedRobots={robot}
          robots={robots}
          video={video}
          camera={cameras}
          primaryView="map"
        />
      )}

      <AlertModal
        open={modal.open}
        message={modal.message}
        mode={modal.mode}
        onConfirm={closeModal}
        onClose={closeModal}
      />
    </>
  );
}
