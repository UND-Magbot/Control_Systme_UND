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
      <CustomSelect
        options={bizOptions}
        value={bizSelected}
        onChange={(opt) => onBizChange(Number(opt.id))}
        placeholder="사업장 선택"
        width={160}
        overlay
        emptyMessage="등록된 사업장이 없습니다"
      />

      <span className={styles.toolbarLabel}>층:</span>
      <CustomSelect
        options={floorOptions}
        value={floorSelected}
        onChange={(opt) => onFloorChange(Number(opt.id))}
        placeholder="층 선택"
        width={110}
        overlay
        emptyMessage="등록된 층이 없습니다"
      />

      <span className={styles.toolbarLabel}>영역:</span>
      <CustomSelect
        options={mapOptions}
        value={mapSelected}
        onChange={(opt) => onMapChange(Number(opt.id))}
        placeholder="영역 선택"
        width={160}
        overlay
        emptyMessage="등록된 영역이 없습니다"
      />

      <div className={styles.toolbarDivider} aria-hidden="true" />

      <button className={styles.robotConnectBtn} onClick={onOpenRobotModal}>
        {connectedRobots.length > 0
          ? connectedRobots.map((r) => r.RobotName).join(", ")
          : "로봇 연결"}
      </button>
      <button
        className={styles.toolbarBtn}
        onClick={onClearModes}
        disabled={noRobotConnected}
        style={noRobotConnected ? { opacity: 0.4, cursor: "default" } : undefined}
      >
        위치재조정
      </button>

      <div className={styles.toolbarRight}>
        <div className={styles.helpWrap}>
          <button
            type="button"
            className={styles.robotIconGhostBtn}
            aria-label="도구 사용법"
          >
            <HelpCircle size={20} strokeWidth={2} />
          </button>
          <div className={styles.helpTooltip} role="tooltip">
            <div className={styles.helpTooltipBox}>
              <span className={styles.helpTooltipTitle}>로봇 연결 후 사용 가능한 도구</span>
              <ul className={styles.helpTooltipList}>
                <li>충전소 생성</li>
                <li>현 위치에서 장소 생성</li>
                <li>위치재조정</li>
              </ul>
            </div>
          </div>
        </div>
        <button className={styles.toolbarBtn} onClick={onSaveAll}>
          저장
        </button>
        <button className={styles.toolbarBtn} onClick={onOpenSyncModal}>
          맵 동기화
        </button>
        <button className={styles.toolbarBtn} onClick={onDeleteMap}>
          삭제
        </button>
      </div>
    </div>
  );
}
