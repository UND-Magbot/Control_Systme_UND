"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";
import type { Robot } from "../../../types/map";

// 상단에 이름으로 표시할 연결 로봇 최대 개수 (초과분은 "외 N대"로 요약)
const MAX_CONN_NAMES = 3;

type Props = {
  isOpen: boolean;
  robots: Robot[];
  connectedRobots: Robot[];
  selectedConnectIds: number[];
  setSelectedConnectIds: React.Dispatch<React.SetStateAction<number[]>>;
  selectedMap: number | "";
  onClose: () => void;
  onConnect: (ids: number[]) => void;
  onDisconnect: (ids: number[]) => void;
  onRefresh: () => void;
  checking?: boolean;
  loading?: boolean;
};

export default function RobotConnectModal({
  isOpen,
  robots,
  connectedRobots,
  selectedConnectIds,
  setSelectedConnectIds,
  selectedMap,
  onClose,
  onConnect,
  onDisconnect,
  onRefresh,
  checking = false,
  loading = false,
}: Props) {
  if (!isOpen) return null;

  const isConnected = (id: number) => connectedRobots.some((r) => r.id === id);
  const toggleSelect = (id: number) =>
    setSelectedConnectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

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
          {/* 상단 액션바: 연결된 로봇 표시(읽기 전용) + 전체/선택 일괄 버튼 */}
          <div className={styles.robotActionBar}>
            <div className={styles.robotActionBarInfo}>
              {connectedRobots.length > 0 ? (
                <>
                  <span className={styles.robotConnectedDot} />
                  <span className={styles.robotConnCount}>
                    {connectedRobots.length}대 연결
                  </span>
                  <span
                    className={styles.robotConnNames}
                    title={connectedRobots.map((r) => r.RobotName).join(", ")}
                  >
                    {connectedRobots
                      .slice(0, MAX_CONN_NAMES)
                      .map((r) => r.RobotName)
                      .join(" · ")}
                  </span>
                  {connectedRobots.length > MAX_CONN_NAMES && (
                    <span
                      className={styles.robotConnMore}
                      title={connectedRobots.map((r) => r.RobotName).join(", ")}
                    >
                      외 {connectedRobots.length - MAX_CONN_NAMES}대
                    </span>
                  )}
                </>
              ) : (
                <span className={styles.robotActionBarEmpty}>연결된 로봇 없음</span>
              )}
            </div>

            <div className={styles.robotActionBarBtns}>
              {selectedConnectIds.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={`${styles.robotBulkBtn} ${styles.robotBulkBtnConnect}`}
                    onClick={() => {
                      onConnect(selectedConnectIds);
                      setSelectedConnectIds([]);
                    }}
                    disabled={checking}
                  >
                    선택 연결
                  </button>
                  <button
                    type="button"
                    className={`${styles.robotBulkBtn} ${styles.robotBulkBtnDisconnect}`}
                    onClick={() => {
                      onDisconnect(selectedConnectIds);
                      setSelectedConnectIds([]);
                    }}
                    disabled={checking}
                  >
                    선택 해제
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`${styles.robotBulkBtn} ${styles.robotBulkBtnConnect}`}
                    onClick={() => onConnect(robots.map((r) => r.id))}
                    disabled={checking || robots.length === 0}
                  >
                    전체 연결
                  </button>
                  <button
                    type="button"
                    className={`${styles.robotBulkBtn} ${styles.robotBulkBtnDisconnect}`}
                    onClick={() => onDisconnect(connectedRobots.map((r) => r.id))}
                    disabled={checking || connectedRobots.length === 0}
                  >
                    전체 해제
                  </button>
                </>
              )}
            </div>
          </div>

          <div className={styles.startSection}>
            <div className={styles.startSectionTitle}>
              <span>로봇 목록</span>
              <div className={styles.startSectionLine} />
              <button
                type="button"
                className={styles.robotRefreshBtn}
                onClick={onRefresh}
                disabled={loading}
                title="목록 새로고침"
                aria-label="목록 새로고침"
              >
                <span className={loading ? styles.robotRefreshSpin : ""}>↻</span>
              </button>
            </div>

            {robots.length === 0 ? (
              <div className={styles.robotEmptyMsg}>
                {selectedMap !== ""
                  ? "현재 맵을 사용 중인 로봇이 없습니다."
                  : "등록된 로봇이 없습니다."}
              </div>
            ) : (
              <div className={styles.robotList}>
                {robots.map((robot) => {
                  const connected = isConnected(robot.id);
                  const selected = selectedConnectIds.includes(robot.id);
                  return (
                    <div
                      key={robot.id}
                      className={styles.robotItem}
                      onClick={() => toggleSelect(robot.id)}
                      role="checkbox"
                      aria-checked={selected}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          toggleSelect(robot.id);
                        }
                      }}
                    >
                      <div className={styles.robotItemLeft}>
                        <input
                          type="checkbox"
                          checked={selected}
                          readOnly
                          style={{ marginRight: 8, accentColor: "var(--color-info)" }}
                        />
                        <img
                          src="/icon/robot_icon(1).png"
                          alt=""
                          className={styles.robotItemIcon}
                        />
                        <div>
                          <div className={styles.robotItemName}>
                            {robot.RobotName}
                            {connected && (
                              <span className={styles.robotConnectedInline}>
                                <span className={styles.robotConnectedDot} />
                                연결됨
                              </span>
                            )}
                          </div>
                          <div className={styles.robotItemInfo}>
                            {robot.ModelName && <span>{robot.ModelName}</span>}
                            {robot.SerialNumber && <span>SN: {robot.SerialNumber}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
        </div>
      </div>
    </div>
  );
}
