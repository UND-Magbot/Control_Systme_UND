"use client";

import React, { useState } from "react";
import styles from "./RobotCardList.module.css";
import type { RobotRowData } from "@/app/types";
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

type RobotLocation = {
  floor: string;
  placeName: string | null;
};

type RobotCardProps = {
  robot: RobotRowData;
  isSelected: boolean;
  onClick: () => void;
  robots: RobotRowData[];
  video: unknown[];
  cameras: unknown[];
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
    if (robot.network === "Error") return { label: "오류", className: styles.taskError, tooltip: "" };
    // 충전 관련 상태 (chargeState: 1=부두 이동, 2=충전 중, 3=나가기, 4=오류, 5=전류 없음)
    if (robot.chargeState === 4) return { label: "충전 오류", className: styles.taskError, tooltip: robot.chargeErrorMsg ?? "" };
    if (robot.chargeState === 5) return { label: "전류 없음", className: styles.taskError, tooltip: "부두에 있지만 전류가 흐르지 않음" };
    if (robot.chargeState === 1) return { label: "부두로 이동", className: styles.taskDocking, tooltip: "" };
    if (robot.chargeState === 2) return { label: "충전 중", className: styles.taskCharging, tooltip: "" };
    if (robot.chargeState === 3) return { label: "부두에서 나가기", className: styles.taskDocking, tooltip: "" };
    if (robot.isCharging) return { label: "충전 중", className: styles.taskCharging, tooltip: "" };
    if (robot.dockingTime > 0) return { label: "도킹 중", className: styles.taskDocking, tooltip: "" };
    if (hasActiveSchedule || robot.tasks.length > 0) return { label: "작업 중", className: styles.taskWorking, tooltip: "" };
    return { label: "대기 중", className: styles.taskIdle, tooltip: "" };
  })();

  const [placeModalOpen, setPlaceModalOpen] = useState(false);
  const [chargeConfirmOpen, setChargeConfirmOpen] = useState(false);
  const [emergencyConfirmOpen, setEmergencyConfirmOpen] = useState(false);
  const [floorChangeOpen, setFloorChangeOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);

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
      .then((res) => {
        if (res.ok) modalAlert("작업이 중지되었습니다.");
      })
      .catch((err) => console.error("긴급 정지 실패", err));
    setEmergencyConfirmOpen(false);
  };

  const handleChargeMove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (robot.isCharging) {
      modalAlert("이미 충전 중입니다.");
      return;
    }
    setChargeConfirmOpen(true);
  };

  const handleChargeConfirm = () => {
    apiFetch(`/robot/return-to-charge`, {
      method: "POST",
    }).catch((err) => console.error("충전소 이동 실패", err));
    setChargeConfirmOpen(false);
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
            <span className={`${styles.networkBadge} ${badgeClass}`}>
              <span className={`${styles.dot} ${dotClass}`} />
              {isUnregistered ? "Offline" : robot.network}
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
                {robot.isCharging && isOnline && <ChargingIcon size={12} style={{ marginLeft: 0, marginRight: 3 }} />}
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
                  <button className={styles.actionBtn} onClick={handleChargeMove} disabled={!isOnline}>충전소 이동</button>
                  <button className={styles.actionBtn} onClick={handlePlaceMove} disabled={!isOnline}>장소 이동</button>
                </>
              )}
              <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleEmergencyStop} disabled={!isOnline}>긴급 정지</button>
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
          message="현재 진행 중인 작업을 중단하고, 충전소로 이동하시겠습니까?"
          onConfirm={handleChargeConfirm}
          onCancel={() => setChargeConfirmOpen(false)}
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
