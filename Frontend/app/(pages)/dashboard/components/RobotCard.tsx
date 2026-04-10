"use client";

import React, { useState } from "react";
import styles from "./RobotCardList.module.css";
import type { RobotRowData } from "@/app/type";
import {
  ROBOT_TYPE_COLOR,
  ROBOT_TYPE_INDEX,
  getBatteryColor,
  isCriticalBattery,
} from "@/app/constants/robotIcons";
import { apiFetch } from "@/app/lib/api";
import dynamic from "next/dynamic";

const PlacePathModal = dynamic(() => import("@/app/components/modal/PlacePathModal"), { ssr: false });
const BatteryPathModal = dynamic(() => import("@/app/components/modal/BatteryChargeModal"), { ssr: false });

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
  canControlRobot?: boolean;
  hasActiveSchedule?: boolean;
};

const ROBOT_ICONS = [
  "/icon/robot_icon(1).png",
  "/icon/robot_icon(2).png",
  "/icon/robot_icon(3).png",
  "/icon/robot_icon(4).png",
];

export default function RobotCard({ robot, isSelected, onClick, robots, video, cameras, robotLocation, canControlRobot = true, hasActiveSchedule = false }: RobotCardProps) {
  const typeIdx = ROBOT_TYPE_INDEX[robot.type] ?? 0;
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
    if (robot.dockingTime > 0) return { label: "도킹 중", className: styles.taskDocking, tooltip: "" };
    if (hasActiveSchedule || robot.tasks.length > 0) return { label: "작업 중", className: styles.taskWorking, tooltip: "" };
    return { label: "대기 중", className: styles.taskIdle, tooltip: "" };
  })();

  const [placeModalOpen, setPlaceModalOpen] = useState(false);
  const [chargeModalOpen, setChargeModalOpen] = useState(false);

  const handleScheduleReturn = (e: React.MouseEvent) => {
    e.stopPropagation();
    apiFetch(`/nav/startmove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ robotName: robot.no, action: "schedule_return" }),
    }).catch((err) => console.error("작업일정 복귀 실패", err));
  };

  const handlePlaceMove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPlaceModalOpen(true);
  };

  const handleEmergencyStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    apiFetch(`/nav/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ robotName: robot.no }),
    }).catch((err) => console.error("긴급 정지 실패", err));
  };

  const handleChargeMove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setChargeModalOpen(true);
  };

  const handleChargeConfirm = () => {
    console.log("충전소 이동:", robot.no);
    setChargeModalOpen(false);
  };

  return (
    <>
      <div
        className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
        onClick={onClick}
      >
        <div className={styles.cardInfo}>
          <div className={styles.cardTop}>
            <span
              className={styles.robotName}
            >
              {robot.no}
            </span>
            <span className={`${styles.networkBadge} ${badgeClass}`}>
              <span className={`${styles.dot} ${dotClass}`} />
              {robot.network}
            </span>
          </div>

          <div className={styles.cardBottom}>
            <span className={isCriticalBattery(robot) ? styles.criticalBattery : ""}>
              {robot.type === "QUADRUPED" ? (
                <>
                  <span style={{ color: "var(--text-primary)" }}>L </span>
                  {robot.batteryLeft != null ? (
                    <span style={{ color: getBatteryColor(robot.batteryLeft, robot.return) }}>{robot.batteryLeft}%</span>
                  ) : <span>-</span>}
                  <span style={{ color: "var(--text-muted)" }}> / </span>
                  <span style={{ color: "var(--text-primary)" }}>R </span>
                  {robot.batteryRight != null ? (
                    <span style={{ color: getBatteryColor(robot.batteryRight, robot.return) }}>{robot.batteryRight}%</span>
                  ) : <span>-</span>}
                  <span style={{ color: "var(--text-muted)" }}> ({robot.return}%)</span>
                </>
              ) : (
                <span style={{ color: getBatteryColor(robot.battery, robot.return) }}>
                  {robot.battery}% ({robot.return}%)
                </span>
              )}
            </span>
            <span className={styles.floorLabel}>
              {robotLocation.floor}{robotLocation.placeName ? ` · ${robotLocation.placeName}` : ""}
            </span>
            {isOnline && (
              <span className={`${styles.taskBadge} ${taskStatus.className}`} title={taskStatus.tooltip || undefined}>{taskStatus.label}</span>
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

      {chargeModalOpen && (
        <BatteryPathModal
          isOpen={chargeModalOpen}
          message="배터리 충전소로 이동하시겠습니까?"
          onConfirm={handleChargeConfirm}
          onCancel={() => setChargeModalOpen(false)}
        />
      )}
    </>
  );
}
