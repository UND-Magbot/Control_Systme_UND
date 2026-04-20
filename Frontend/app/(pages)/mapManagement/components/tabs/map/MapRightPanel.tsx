"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";

interface MapRightPanelProps {
  open: boolean;
  onToggle: () => void;
  onPathBuildStart: () => void;
  onMappingStart: () => void;
  onMapReset: () => void;
  robotConnected?: boolean;
}

export default function MapRightPanel({
  open,
  onToggle,
  onPathBuildStart,
  onMappingStart,
  onMapReset,
  robotConnected = false,
}: MapRightPanelProps) {
  return (
    <div className={`${styles.rightPanel} ${open ? styles.rightPanelOpen : styles.rightPanelClosed}`}>
      <button className={styles.panelToggle} onClick={onToggle}>
        {open ? "\u203A" : "\u2039"}
      </button>
      <div className={styles.panelCard}>
        <div className={styles.panelTitle}>맵 관리</div>

        {/* 경로 */}
        <button
          className={`${styles.btnMapping} ${styles.btnMappingStart}`}
          style={{ width: "100%", marginBottom: 10, opacity: robotConnected ? 1 : 0.4, cursor: robotConnected ? "pointer" : "not-allowed" }}
          onClick={robotConnected ? onPathBuildStart : undefined}
          disabled={!robotConnected}
          title={robotConnected ? undefined : "로봇 연결 후 사용 가능"}
        >
          경로 만들기
        </button>

        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "0 0 10px" }} />

        {/* 맵핑 */}
        <div className={styles.mappingBtns}>
          <button
            className={`${styles.btnMapping} ${styles.btnMappingStart}`}
            style={{ opacity: robotConnected ? 1 : 0.4, cursor: robotConnected ? "pointer" : "not-allowed" }}
            onClick={robotConnected ? onMappingStart : undefined}
            disabled={!robotConnected}
            title={robotConnected ? undefined : "로봇 연결 후 사용 가능"}
          >
            맵핑 시작
          </button>
          <button
            className={`${styles.btnMapping} ${styles.btnMappingReset}`}
            onClick={onMapReset}
          >
            맵 초기화
          </button>
        </div>
      </div>
    </div>
  );
}
