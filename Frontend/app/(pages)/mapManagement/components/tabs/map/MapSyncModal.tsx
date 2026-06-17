"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";
import type { Robot } from "../../../types/map";

type Props = {
  isOpen: boolean;
  syncRobots: Robot[];
  selectedSyncIds: number[];
  setSelectedSyncIds: React.Dispatch<React.SetStateAction<number[]>>;
  onClose: () => void;
  onConfirm: () => void;
};

export default function MapSyncModal({
  isOpen,
  syncRobots,
  selectedSyncIds,
  setSelectedSyncIds,
  onClose,
  onConfirm,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className={styles.startOverlay} onClick={onClose}>
      <div className={styles.robotModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.startHeader}>
          <div className={styles.startHeaderLeft}>
            <img src="/icon/map_d.png" alt="" />
            <h2>맵 동기화</h2>
          </div>
          <button className={styles.startCloseBtn} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.robotBody}>
          <div className={styles.startSection}>
            <div className={styles.startSectionTitle}>
              <span>동기화할 로봇 선택</span>
              <div className={styles.startSectionLine} />
            </div>

            {syncRobots.length === 0 ? (
              <div className={styles.robotEmptyMsg}>등록된 로봇이 없습니다.</div>
            ) : (
              <div className={styles.robotList}>
                {syncRobots.map((robot) => (
                  <button
                    key={robot.id}
                    className={`${styles.robotItem} ${
                      selectedSyncIds.includes(robot.id) ? styles.robotItemActive : ""
                    }`}
                    onClick={() =>
                      setSelectedSyncIds((prev) =>
                        prev.includes(robot.id)
                          ? prev.filter((id) => id !== robot.id)
                          : [...prev, robot.id]
                      )
                    }
                  >
                    <div className={styles.robotItemLeft}>
                      <input
                        type="checkbox"
                        checked={selectedSyncIds.includes(robot.id)}
                        readOnly
                        style={{ marginRight: 8, accentColor: "var(--color-info)" }}
                      />
                      <img
                        src="/icon/robot_icon(1).png"
                        alt=""
                        className={styles.robotItemIcon}
                      />
                      <div>
                        <div className={styles.robotItemName}>{robot.RobotName}</div>
                        <div className={styles.robotItemInfo}>
                          {robot.ModelName && <span>{robot.ModelName}</span>}
                          {robot.SerialNumber && <span>SN: {robot.SerialNumber}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.startFooter}>
          <button
            className={styles.startFooterBtn + " " + styles.startBtnCancel}
            onClick={onClose}
          >
            닫기
          </button>
          <button
            className={styles.startFooterBtn + " " + styles.startBtnStart}
            onClick={onConfirm}
          >
            동기화
          </button>
        </div>
      </div>
    </div>
  );
}
