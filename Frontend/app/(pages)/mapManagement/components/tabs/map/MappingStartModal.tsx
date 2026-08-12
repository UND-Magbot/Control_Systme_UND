"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";
import CustomSelect, { type SelectOption } from "@/app/components/select/CustomSelect";
import { useModalBehavior } from "@/app/hooks/useModalBehavior";
import type { Business, FloorItem } from "../../../types/map";

// 맵 이름 제약 — 백엔드 validate_map_name / DB MapName Column(String(100)) 과 동일하게 유지.
export const MAP_NAME_MAX_LEN = 100;
export const MAP_NAME_PATTERN = /^[0-9A-Za-z가-힣][0-9A-Za-z가-힣 ._-]{0,99}$/;

type Props = {
  isOpen: boolean;
  businesses: Business[];
  startBizId: number | "";
  startBizNew: string;
  startBizMode: "select" | "new";
  startFloorId: number | "";
  startFloorNew: string;
  startFloorMode: "select" | "new";
  startFloors: FloorItem[];
  startMapName: string;
  startMapNameChecked: boolean | null;
  setStartBizNew: (v: string) => void;
  setStartBizMode: React.Dispatch<React.SetStateAction<"select" | "new">>;
  setStartFloorId: (v: number | "") => void;
  setStartFloorNew: (v: string) => void;
  setStartFloorMode: React.Dispatch<React.SetStateAction<"select" | "new">>;
  setStartMapName: (v: string) => void;
  setStartMapNameChecked: (v: boolean | null) => void;
  onStartBizChange: (bizId: number) => void;
  onCheckMapName: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 맵핑 시작 모달 — 사업장/층/영역 이름을 입력받고 맵핑을 시작한다.
 */
export default function MappingStartModal({
  isOpen,
  businesses,
  startBizId,
  startBizNew,
  startBizMode,
  startFloorId,
  startFloorNew,
  startFloorMode,
  startFloors,
  startMapName,
  startMapNameChecked,
  setStartBizNew,
  setStartBizMode,
  setStartFloorId,
  setStartFloorNew,
  setStartFloorMode,
  setStartMapName,
  setStartMapNameChecked,
  onStartBizChange,
  onCheckMapName,
  onConfirm,
  onCancel,
}: Props) {
  useModalBehavior({ isOpen, onClose: onCancel });

  const bizOptions: SelectOption[] = businesses.map((b) => ({ id: b.id, label: b.BusinessName }));
  const bizValue = bizOptions.find((o) => o.id === startBizId) ?? null;
  const floorOptions: SelectOption[] = startFloors.map((f) => ({ id: f.id, label: f.FloorName }));
  const floorValue = floorOptions.find((o) => o.id === startFloorId) ?? null;

  const trimmedName = startMapName.trim();
  const nameFormatError =
    trimmedName.length > 0 && !MAP_NAME_PATTERN.test(trimmedName)
      ? "한글·영문·숫자로 시작하고, 공백과 . _ - 만 사용할 수 있습니다."
      : "";
  const bizFilled = startBizMode === "select" ? startBizId !== "" : startBizNew.trim() !== "";
  const floorFilled = startFloorMode === "select" ? startFloorId !== "" : startFloorNew.trim() !== "";
  // 사업장·층은 필수(*)이고 빠지면 서버가 422 로 거절하므로 여기서 먼저 막는다.
  const canConfirm = bizFilled && floorFilled && startMapNameChecked === true;
  const confirmHint = !bizFilled
    ? "사업장을 선택하거나 입력해주세요"
    : !floorFilled
      ? "층을 선택하거나 입력해주세요"
      : startMapNameChecked !== true
        ? "영역 이름 중복 체크를 해주세요"
        : undefined;

  if (!isOpen) return null;

  return (
    <div className={styles.startOverlay}>
      <div className={styles.startModal} role="dialog" aria-modal="true" aria-label="맵핑 시작">
        {/* 헤더 */}
        <div className={styles.startHeader}>
          <div className={styles.startHeaderLeft}>
            <img src="/icon/map_w.png" alt="" />
            <h2>맵핑 시작</h2>
          </div>
          <button className={styles.startCloseBtn} onClick={onCancel} aria-label="닫기">
            &times;
          </button>
        </div>

        {/* 본문 */}
        <div className={styles.startBody}>
          {/* 사업장 섹션 */}
          <div className={styles.startSection}>
            <div className={styles.startSectionTitle}>
              <span>사업장 정보</span>
              <div className={styles.startSectionLine} />
            </div>
            <div className={styles.startRow}>
              <span className={styles.startLabel}>
                사업장 <span className={styles.startRequired}>*</span>
              </span>
              <div className={styles.startField}>
                {startBizMode === "select" ? (
                  <CustomSelect
                    options={bizOptions}
                    value={bizValue}
                    onChange={(o) => onStartBizChange(Number(o.id))}
                    placeholder="사업장 선택"
                    overlay
                    className={styles.startSelectBox}
                    emptyMessage="등록된 사업장이 없습니다"
                  />
                ) : (
                  <input
                    className={styles.startInput}
                    type="text"
                    placeholder="사업장 이름 입력"
                    maxLength={MAP_NAME_MAX_LEN}
                    value={startBizNew}
                    onChange={(e) => setStartBizNew(e.target.value)}
                  />
                )}
                <button
                  className={styles.startToggleBtn}
                  onClick={() =>
                    setStartBizMode(startBizMode === "select" ? "new" : "select")
                  }
                >
                  {startBizMode === "select" ? "직접 입력" : "목록 선택"}
                </button>
              </div>
            </div>
            <div className={styles.startRow}>
              <span className={styles.startLabel}>
                층 <span className={styles.startRequired}>*</span>
              </span>
              <div className={styles.startField}>
                {startFloorMode === "select" ? (
                  <CustomSelect
                    options={floorOptions}
                    value={floorValue}
                    onChange={(o) => setStartFloorId(Number(o.id))}
                    placeholder="층 선택"
                    overlay
                    className={styles.startSelectBox}
                    emptyMessage="층이 없습니다"
                  />
                ) : (
                  <input
                    className={styles.startInput}
                    type="text"
                    placeholder="예: B1, 1F, 2F"
                    maxLength={MAP_NAME_MAX_LEN}
                    value={startFloorNew}
                    onChange={(e) => setStartFloorNew(e.target.value)}
                  />
                )}
                <button
                  className={styles.startToggleBtn}
                  onClick={() =>
                    setStartFloorMode(
                      startFloorMode === "select" ? "new" : "select"
                    )
                  }
                >
                  {startFloorMode === "select" ? "직접 입력" : "목록 선택"}
                </button>
              </div>
            </div>
          </div>

          {/* 영역 섹션 */}
          <div className={styles.startSection}>
            <div className={styles.startSectionTitle}>
              <span>영역 정보</span>
              <div className={styles.startSectionLine} />
            </div>
            <div className={styles.startRow}>
              <span className={styles.startLabel}>
                영역 이름 <span className={styles.startRequired}>*</span>
              </span>
              <div className={styles.startField}>
                <input
                  className={styles.startInput}
                  type="text"
                  placeholder="영역 이름을 입력하세요"
                  maxLength={MAP_NAME_MAX_LEN}
                  value={startMapName}
                  onChange={(e) => {
                    setStartMapName(e.target.value);
                    setStartMapNameChecked(null);
                  }}
                />
                <button
                  className={styles.startCheckBtn}
                  onClick={onCheckMapName}
                  disabled={!trimmedName || !!nameFormatError}
                >
                  중복 체크
                </button>
              </div>
            </div>
            {nameFormatError && (
              <div className={styles.startFieldMsg}>
                <span className={styles.checkFail}>{nameFormatError}</span>
              </div>
            )}
            {!nameFormatError && startMapNameChecked === true && (
              <div className={styles.startFieldMsg}>
                <span className={styles.checkOk}>사용 가능한 이름입니다.</span>
              </div>
            )}
            {!nameFormatError && startMapNameChecked === false && (
              <div className={styles.startFieldMsg}>
                <span className={styles.checkFail}>이미 사용 중인 이름입니다.</span>
              </div>
            )}
          </div>
        </div>

        {/* 푸터 */}
        <div className={styles.startFooter}>
          <button
            className={styles.startFooterBtn + " " + styles.startBtnCancel}
            onClick={onCancel}
          >
            <img src="/icon/arrow-left.png" alt="" />
            취소
          </button>
          <button
            className={styles.startFooterBtn + " " + styles.startBtnConfirm}
            onClick={onConfirm}
            disabled={!canConfirm}
            title={confirmHint}
          >
            맵핑 시작
            <img src="/icon/arrow-right.png" alt="" />
          </button>
        </div>
      </div>
    </div>
  );
}
