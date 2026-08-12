"use client";

import React from "react";
import CustomSelect, { type SelectOption } from "@/app/components/select/CustomSelect";
import styles from "../../../mapManagement.module.css";
import type { Business, FloorItem, RobotMap, Robot } from "../../../types/map";

// 버튼 폭이 로봇 수에 따라 늘어나지 않도록 이름은 최대 2대까지만 쓰고 나머지는 "외 N대"로 요약한다.
const MAX_CONN_NAMES = 2;

type Props = {
  title?: string;
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
 * 맵 편집 탭 상단바 — 제목 + 사업장/층/영역 선택 + 저장/동기화/가져오기/삭제/위치 재조정 + 로봇 연결.
 * 장소 목록·경로 목록·시설 장치 탭의 상단바(제목 좌측 · 컨트롤 우측)와 같은 구조를 쓴다.
 */
export default function MapToolbar({
  title = "맵 편집",
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
  onOpenImportModal,
  onDeleteMap,
  onOpenRobotModal,
  onOpenInitPoseModal,
}: Props) {
  const hasConnectedRobot = connectedRobots.length > 0;

  const bizOptions: SelectOption[] = businesses.map((b) => ({ id: b.id, label: b.BusinessName }));
  const floorOptions: SelectOption[] = floors.map((f) => ({ id: f.id, label: f.FloorName }));
  const mapOptions: SelectOption[] = maps.map((m) => ({ id: m.id, label: m.MapName }));

  const bizSelected = bizOptions.find((o) => o.id === selectedBiz) ?? null;
  const floorSelected = floorOptions.find((o) => o.id === selectedFloor) ?? null;
  const mapSelected = mapOptions.find((o) => o.id === selectedMap) ?? null;

  const connectedNames = connectedRobots.map((r) => r.RobotName);
  const robotBtnLabel = !hasConnectedRobot
    ? "로봇 연결"
    : connectedNames.length <= MAX_CONN_NAMES
      ? connectedNames.join(", ")
      : `${connectedNames.slice(0, MAX_CONN_NAMES).join(", ")} 외 ${connectedNames.length - MAX_CONN_NAMES}대`;

  return (
    <div className={styles.topBar}>
      <h2>{title}</h2>

      <div className={styles.toolbar}>
        <CustomSelect
          options={bizOptions}
          value={bizSelected}
          onChange={(o) => onBizChange(Number(o.id))}
          placeholder="사업장 선택"
          width={170}
          overlay
          emptyMessage="등록된 사업장이 없습니다"
        />
        <CustomSelect
          options={floorOptions}
          value={floorSelected}
          onChange={(o) => onFloorChange(Number(o.id))}
          placeholder="층 선택"
          width={110}
          overlay
          emptyMessage="층이 없습니다"
        />
        <CustomSelect
          options={mapOptions}
          value={mapSelected}
          onChange={(o) => onMapChange(Number(o.id))}
          placeholder="영역 선택"
          width={170}
          overlay
          emptyMessage="영역이 없습니다"
        />

        <span className={styles.toolSep} />

        <button type="button" className={styles.toolbarBtn} onClick={onSaveAll}>
          저장
        </button>
        <button type="button" className={styles.toolbarBtn} onClick={onOpenSyncModal}>
          동기화
        </button>
        <button type="button" className={styles.toolbarBtn} onClick={onOpenImportModal}>
          맵 가져오기
        </button>
        <button type="button" className={styles.toolbarBtn} onClick={onDeleteMap}>
          삭제
        </button>
        {/* 위치 재조정 — rviz식 스캔 정합 도구(RelocalizeModal)를 연다. */}
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={onOpenInitPoseModal}
          disabled={!hasConnectedRobot}
          title={
            hasConnectedRobot
              ? "맵의 벽과 로봇 스캔을 맞춰 위치를 재조정합니다."
              : "로봇을 먼저 연결해주세요."
          }
        >
          위치 재조정
        </button>

        <span className={styles.toolSep} />

        <button
          type="button"
          className={styles.robotConnectBtn}
          onClick={onOpenRobotModal}
          title={hasConnectedRobot ? `연결됨: ${connectedNames.join(", ")}` : "로봇 연결"}
        >
          {robotBtnLabel}
        </button>
      </div>
    </div>
  );
}
