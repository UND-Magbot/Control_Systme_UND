"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";
import type { Business, FloorItem, RobotMap, Robot } from "../../../types/map";

type Props = {
  businesses: Business[];
  floors: FloorItem[];
  maps: RobotMap[];
  selectedBiz: number | "";
  selectedFloor: number | "";
  selectedMap: number | "";
  connectedRobots: Robot[];

  onBizChange: (bizId: number) => void;
  onFloorChange: (floorId: number) => void;
  onMapChange: (mapId: number | "") => void;

  onSaveAll: () => void;
  onOpenSyncModal: () => void;
  onClearModes: () => void; // "위치재조정"
  onDeleteMap: () => void;
  onOpenRobotModal: () => void;
};

/**
 * 맵 관리 화면 상단 툴바 — 사업장/층/영역 선택 + 저장/동기화/위치재조정/삭제 + 로봇 연결 버튼.
 */
export default function MapToolbar({
  businesses,
  floors,
  maps,
  selectedBiz,
  selectedFloor,
  selectedMap,
  connectedRobots,
  onBizChange,
  onFloorChange,
  onMapChange,
  onSaveAll,
  onOpenSyncModal,
  onClearModes,
  onDeleteMap,
  onOpenRobotModal,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <span className={styles.toolbarLabel}>사업장:</span>
      <select
        value={selectedBiz}
        onChange={(e) => onBizChange(Number(e.target.value))}
      >
        <option value="">사업장 선택</option>
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.BusinessName}
          </option>
        ))}
      </select>

      <span className={styles.toolbarLabel}>층:</span>
      <select
        value={selectedFloor}
        onChange={(e) => onFloorChange(Number(e.target.value))}
      >
        <option value="">층 선택</option>
        {floors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.FloorName}
          </option>
        ))}
      </select>

      <span className={styles.toolbarLabel}>영역:</span>
      <select
        value={selectedMap}
        onChange={(e) =>
          onMapChange(e.target.value === "" ? "" : Number(e.target.value))
        }
      >
        <option value="">영역 선택</option>
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.MapName}
          </option>
        ))}
      </select>

      <div className={styles.toolbarCenter}>
        <button className={styles.toolbarBtn} onClick={onSaveAll}>
          저장
        </button>
        <button className={styles.toolbarBtn} onClick={onOpenSyncModal}>
          동기화
        </button>
        <button className={styles.toolbarBtn} onClick={onClearModes}>
          위치재조정
        </button>
        <button className={styles.toolbarBtn} onClick={onDeleteMap}>
          삭제
        </button>
      </div>

      <div className={styles.toolbarRight}>
        <button className={styles.robotConnectBtn} onClick={onOpenRobotModal}>
          {connectedRobots.length > 0
            ? connectedRobots.map((r) => r.RobotName).join(", ")
            : "로봇 연결"}
        </button>
      </div>
    </div>
  );
}
