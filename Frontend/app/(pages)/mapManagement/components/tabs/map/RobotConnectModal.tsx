"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";
import type { Robot } from "../../../types/map";

type Props = {
  isOpen: boolean;
  robots: Robot[];
  connectedRobots: Robot[];
  selectedConnectIds: number[];
  setSelectedConnectIds: React.Dispatch<React.SetStateAction<number[]>>;
  selectedMap: number | "";
  onClose: () => void;
  onConfirm: () => void;
};

export default function RobotConnectModal({
  isOpen,
  robots,
  connectedRobots,
  selectedConnectIds,
  setSelectedConnectIds,
  selectedMap,
  onClose,
  onConfirm,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className={styles.startOverlay} onClick={onClose}>
      <div className={styles.robotModal} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className={styles.startHeader}>
          <div className={styles.startHeaderLeft}>
            <img src="/icon/robot_w.png" alt="" />
            <h2>로봇 연결</h2>
          </div>
          <button className={styles.startCloseBtn} onClick={onClose}>
            &times;
          </button>
        </div>

        {/* 본문 */}
        <div className={styles.robotBody}>
          {connectedRobots.length > 0 && (
            <div className={styles.robotConnectedBanner}>
              <span className={styles.robotConnectedDot} />
              <span>
                현재 연결:{" "}
                <strong>{connectedRobots.map((r) => r.RobotName).join(", ")}</strong>
              </span>
            </div>
          )}

          <div className={styles.startSection}>
            <div className={styles.startSectionTitle}>
              <span>로봇 목록</span>
              <div className={styles.startSectionLine} />
            </div>

            {robots.length === 0 ? (
              <div className={styles.robotEmptyMsg}>
                {selectedMap !== ""
                  ? "현재 맵을 사용 중인 로봇이 없습니다."
                  : "등록된 로봇이 없습니다."}
              </div>
            ) : (
              <div className={styles.robotList}>
                {robots.map((robot) => (
                  <button
                    key={robot.id}
                    className={`${styles.robotItem} ${
                      selectedConnectIds.includes(robot.id) ? styles.robotItemActive : ""
                    }`}
                    onClick={() =>
                      setSelectedConnectIds((prev) =>
                        prev.includes(robot.id)
                          ? prev.filter((id) => id !== robot.id)
                          : [...prev, robot.id]
                      )
                    }
                  >
                    <div className={styles.robotItemLeft}>
                      <input
                        type="checkbox"
                        checked={selectedConnectIds.includes(robot.id)}
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
                    {connectedRobots.some((r) => r.id === robot.id) && (
                      <span className={styles.robotItemBadge}>연결됨</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 푸터 */}
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
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
