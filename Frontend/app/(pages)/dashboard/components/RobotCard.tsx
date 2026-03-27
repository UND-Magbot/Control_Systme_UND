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
import { API_BASE } from "@/app/config";
import PlacePathModal from "@/app/components/modal/PlacePathModal";
import BatteryPathModal from "@/app/components/modal/BatteryChargeModal";

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
};

const ROBOT_ICONS = [
  "/icon/robot_icon(1).png",
  "/icon/robot_icon(2).png",
  "/icon/robot_icon(3).png",
  "/icon/robot_icon(4).png",
];

export default function RobotCard({ robot, isSelected, onClick, robots, video, cameras, robotLocation }: RobotCardProps) {
  const typeIdx = ROBOT_TYPE_INDEX[robot.type] ?? 0;
  const dotClass = styles[`dot${robot.network}`] ?? styles.dotOffline;
  const badgeClass = styles[`badge${robot.network}`] ?? styles.badgeOffline;

  // 작업 상태 파생
  const taskStatus = (() => {
    if (robot.network === "Error") return { label: "오류", className: styles.taskError };
    if (robot.isCharging) return { label: "충전 중", className: styles.taskCharging };
    if (robot.dockingTime > 0) return { label: "도킹 중", className: styles.taskDocking };
    if (robot.tasks.length > 0) return { label: "작업 중", className: styles.taskWorking };
    return { label: "대기 중", className: styles.taskIdle };
  })();

  const [placeModalOpen, setPlaceModalOpen] = useState(false);
  const [chargeModalOpen, setChargeModalOpen] = useState(false);

  const handleScheduleReturn = (e: React.MouseEvent) => {
    e.stopPropagation();
    fetch(`${API_BASE}/nav/startmove`, {
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
    fetch(`${API_BASE}/nav/stop`, {
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
              style={{ color: ROBOT_TYPE_COLOR[robot.type] }}
            >
              {robot.no}
            </span>
            <span className={`${styles.networkBadge} ${badgeClass}`}>
              <span className={`${styles.dot} ${dotClass}`} />
              {robot.network}
            </span>
          </div>

          <div className={styles.cardBottom}>
            <span
              className={isCriticalBattery(robot) ? styles.criticalBattery : ""}
              style={{ color: getBatteryColor(robot.battery, robot.return) }}
            >
              {robot.battery}% ({robot.return}%)
            </span>
            <span className={styles.floorLabel}>
              {robotLocation.floor}{robotLocation.placeName ? ` · ${robotLocation.placeName}` : ""}
            </span>
            <span className={`${styles.taskBadge} ${taskStatus.className}`}>{taskStatus.label}</span>
          </div>

          {/* 선택된 카드에만 액션 버튼 표시 */}
          {isSelected && (
            <div className={styles.actionRow}>
              <button className={styles.actionBtn} onClick={handleScheduleReturn}>작업 복귀</button>
              <button className={styles.actionBtn} onClick={handleChargeMove}>충전소 이동</button>
              <button className={styles.actionBtn} onClick={handlePlaceMove}>장소 이동</button>
              <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleEmergencyStop}>긴급 정지</button>
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
