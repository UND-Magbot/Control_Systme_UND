"use client";

import React, { useState, useEffect } from "react";
import styles from "./CameraModal.module.css";
import type { Camera, RobotRowData } from "@/app/types";
import CameraSlot from "./CameraSlot";
import { getBatteryColor, isQuadrupedSingleBatteryMode } from "@/app/constants/robotIcons";

type ViewMode = "all" | "single";

type CameraModalProps = {
  isOpen: boolean;
  onClose: () => void;
  robotCameras: Camera[];
  robotName: string;
  robot?: RobotRowData | null;
  initialCam?: Camera | null;
  initialMode?: ViewMode;
};

export default function CameraModal({
  isOpen,
  onClose,
  robotCameras,
  robotName,
  robot = null,
  initialCam = null,
  initialMode = "all",
}: CameraModalProps) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [activeCam, setActiveCam] = useState<Camera | null>(initialCam);

  // 모달 열릴 때 초기값 세팅
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setActiveCam(initialCam);
    }
  }, [isOpen, initialMode, initialCam]);

  if (!isOpen) return null;

  const count = robotCameras.length;
  const cols = count <= 2 ? 2 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);

  const handleCamClick = (cam: Camera) => {
    setActiveCam(cam);
    setMode("single");
  };

  const handleBack = () => {
    setMode("all");
    setActiveCam(null);
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {mode === "single" && (
              <button className={styles.backBtn} onClick={handleBack}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            <h3 className={styles.title}>
              {mode === "all" ? (
                <>전체 카메라 ({count}){robotName && <span className={styles.robotTag}>{robotName}</span>}</>
              ) : (
                <>{activeCam?.label ?? ""}{robotName && <span className={styles.robotTag}>{robotName}</span>}</>
              )}
              {robot && (
                <span className={styles.robotStatus}>
                  <span className={styles.statusItem}>
                    <span className={`${styles.statusDot} ${robot.network === "Online" ? styles.statusDotOnline : styles.statusDotOffline}`} />
                    {robot.network}
                  </span>
                  <span className={styles.statusDivider}>|</span>
                  <span className={styles.statusItem}>
                    {robot.type === "QUADRUPED" ? (
                      isQuadrupedSingleBatteryMode(robot) ? (
                        <span style={{ color: getBatteryColor(robot.batteryLeft ?? robot.batteryRight ?? 0, robot.return) }}>
                          {robot.batteryLeft ?? robot.batteryRight ?? "-"}%
                        </span>
                      ) : (
                        <>
                          L <span style={{ color: getBatteryColor(robot.batteryLeft ?? 0, robot.return) }}>{robot.batteryLeft ?? "-"}%</span>
                          {" / "}
                          R <span style={{ color: getBatteryColor(robot.batteryRight ?? 0, robot.return) }}>{robot.batteryRight ?? "-"}%</span>
                        </>
                      )
                    ) : (
                      <span style={{ color: getBatteryColor(robot.battery, robot.return) }}>{robot.battery}%</span>
                    )}
                  </span>
                  <span className={styles.statusDivider}>|</span>
                  <span className={styles.statusItem}>{robot.power}</span>
                </span>
              )}
            </h3>
          </div>
          <div className={styles.headerRight}>
            {mode === "single" && (
              <button className={styles.viewAllBtn} onClick={handleBack}>
                전체 보기
              </button>
            )}
            <button className={styles.closeBtn} onClick={handleClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* 전체 보기 모드 */}
        {mode === "all" && (
          <div
            className={styles.grid}
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
          >
            {robotCameras.map((cam) => (
              <div
                key={cam.id}
                className={styles.camPanel}
                onClick={() => handleCamClick(cam)}
              >
                <CameraSlot camera={cam} robotName="" />
              </div>
            ))}
          </div>
        )}

        {/* 확대 모드 */}
        {mode === "single" && activeCam && (
          <div className={styles.singleView}>
            <CameraSlot camera={activeCam} robotName="" />
          </div>
        )}
      </div>
    </div>
  );
}
