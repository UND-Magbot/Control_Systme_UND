"use client";

import React from "react";
import { X } from "lucide-react";
import styles from "../../../mapManagement.module.css";
import modalStyles from "@/app/components/modal/Modal.module.css";
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
          <button
            className={styles.robotIconGhostBtn}
            onClick={onClose}
            aria-label="닫기"
          >
            <X size={22} strokeWidth={2} />
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
                {syncRobots.map((robot) => {
                  const isSelected = selectedSyncIds.includes(robot.id);
                  return (
                    <button
                      key={robot.id}
                      type="button"
                      className={`${styles.robotItem} ${isSelected ? styles.robotItemActive : ""}`}
                      onClick={() =>
                        setSelectedSyncIds((prev) =>
                          prev.includes(robot.id)
                            ? prev.filter((id) => id !== robot.id)
                            : [...prev, robot.id]
                        )
                      }
                    >
                      <div className={styles.robotItemLeft}>
                        <img
                          src={isSelected ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                          alt=""
                          className={styles.robotItemCheckbox}
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
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={styles.startFooter} style={{ borderTop: "none", gap: 10 }}>
          <button
            className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgRed}`}
            onClick={onClose}
            style={{ width: 120, height: 40, gap: 8, marginRight: 0 }}
          >
            <span className={modalStyles.btnIcon} style={{ width: 18, height: 16 }}>
              <img src="/icon/close_btn.png" alt="cancel" />
            </span>
            <span>취소</span>
          </button>
          <button
            className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgBlue}`}
            onClick={onConfirm}
            style={{ width: 120, height: 40, gap: 8 }}
          >
            <span className={modalStyles.btnIcon} style={{ width: 18, height: 16 }}>
              <img src="/icon/check.png" alt="sync" />
            </span>
            <span>동기화</span>
          </button>
        </div>
      </div>
    </div>
  );
}
