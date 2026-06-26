"use client";

import React from "react";
import { HelpCircle } from "lucide-react";
import CustomSelect, { type SelectOption } from "@/app/components/select/CustomSelect";
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
  onClearModes: () => void; // "위치재조정"

  onSaveAll: () => void;
  onOpenSyncModal: () => void;
  onOpenImportModal: () => void;
  onDeleteMap: () => void;
  onOpenRobotModal: () => void;
  onOpenInitPoseModal: () => void;
};

/**
 * 맵 관리 화면 상단 툴바 — 사업장/층/영역 선택 + 저장/동기화/맵 가져오기/삭제 + 로봇 연결 버튼.
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
  onClearModes,
  onSaveAll,
  onOpenSyncModal,
  onOpenImportModal,
  onDeleteMap,
  onOpenRobotModal,
  onOpenInitPoseModal,
}: Props) {
  const hasConnectedRobot = connectedRobots.length > 0;
  const noRobotConnected = connectedRobots.length === 0;

  const bizOptions: SelectOption[] = businesses.map((b) => ({ id: b.id, label: b.BusinessName }));
  const floorOptions: SelectOption[] = floors.map((f) => ({ id: f.id, label: f.FloorName }));
  const mapOptions: SelectOption[] = maps.map((m) => ({ id: m.id, label: m.MapName }));

  const bizSelected = bizOptions.find((o) => o.id === selectedBiz) ?? null;
  const floorSelected = floorOptions.find((o) => o.id === selectedFloor) ?? null;
  const mapSelected = mapOptions.find((o) => o.id === selectedMap) ?? null;

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
        <button className={styles.toolbarBtn} onClick={onOpenImportModal}>
          맵 가져오기
        </button>
        <button className={styles.toolbarBtn} onClick={onDeleteMap}>
          삭제
        </button>
        {/* 위치 재조정 버튼 — 우선 미표시(요청). 위치 교정은 '관리자 문의'로 일원화.
            재활성화하려면 아래 블록 주석 해제(props/wiring 유지됨).
        <button
          className={styles.toolbarBtn}
          onClick={onOpenInitPoseModal}
          disabled={!hasConnectedRobot}
          title={
            hasConnectedRobot
              ? "위치 재조정할 로봇을 선택합니다."
              : "로봇을 먼저 연결해주세요."
          }
        >
          위치 재조정
        </button>
        */}
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
