"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";
import type { Business, FloorItem } from "../../../types/map";

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
  if (!isOpen) return null;

  return (
    <div className={styles.startOverlay}>
      <div className={styles.startModal} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className={styles.startHeader}>
          <div className={styles.startHeaderLeft}>
            <img src="/icon/map_w.png" alt="" />
            <h2>맵핑 시작</h2>
          </div>
          <button className={styles.startCloseBtn} onClick={onCancel}>
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
                  <select
                    className={styles.startSelect}
                    value={startBizId}
                    onChange={(e) => onStartBizChange(Number(e.target.value))}
                  >
                    <option value="">사업장 선택</option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.BusinessName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={styles.startInput}
                    type="text"
                    placeholder="사업장 이름 입력"
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
                  <select
                    className={styles.startSelect}
                    value={startFloorId}
                    onChange={(e) => setStartFloorId(Number(e.target.value))}
                  >
                    <option value="">층 선택</option>
                    {startFloors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.FloorName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={styles.startInput}
                    type="text"
                    placeholder="예: B1, 1F, 2F"
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
                  value={startMapName}
                  onChange={(e) => {
                    setStartMapName(e.target.value);
                    setStartMapNameChecked(null);
                  }}
                />
                <button
                  className={styles.startCheckBtn}
                  onClick={onCheckMapName}
                  disabled={!startMapName.trim()}
                >
                  중복 체크
                </button>
              </div>
            </div>
            {startMapNameChecked === true && (
              <div className={styles.startFieldMsg}>
                <span className={styles.checkOk}>사용 가능한 이름입니다.</span>
              </div>
            )}
            {startMapNameChecked === false && (
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
            disabled={startMapNameChecked !== true}
          >
            맵핑 시작
            <img src="/icon/arrow-right.png" alt="" />
          </button>
        </div>
      </div>
    </div>
  );
}
