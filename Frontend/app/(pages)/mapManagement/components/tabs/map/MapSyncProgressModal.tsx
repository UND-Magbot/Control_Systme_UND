"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";
import type { Robot } from "../../../types/map";

export type RobotSyncStatus = "waiting" | "in-progress" | "success" | "failed";

export type RobotSyncState = {
  robot: Robot;
  status: RobotSyncStatus;
  step: number; // 0 = 미시작, 1~3 = 현재 진행 스텝
  msg: string;
  retryCount: number;
  errorMsg?: string;
};

type Props = {
  isOpen: boolean;
  states: RobotSyncState[];
};

export default function MapSyncProgressModal({ isOpen, states }: Props) {
  if (!isOpen) return null;

  return (
    <div className={styles.startOverlay}>
      <div className={styles.robotModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.startHeader}>
          <div className={styles.startHeaderLeft}>
            <img src="/icon/map_d.png" alt="" />
            <h2>맵 동기화 중 ...</h2>
          </div>
        </div>

        <div className={styles.robotBody}>
          <div className={styles.syncProgressSpinnerRow}>
            <div className={styles.mappingLoadingSpinner} />
          </div>

          <div className={styles.syncProgressList}>
            {states.map((s) => (
              <div key={s.robot.id} className={styles.syncProgressItem}>
                <div className={styles.syncProgressRobotName}>{s.robot.RobotName}</div>
                <div className={styles.syncProgressStatus}>
                  {s.status === "waiting" && (
                    <span className={styles.syncProgressWaiting}>대기 중</span>
                  )}
                  {s.status === "in-progress" && (
                    <>
                      <span className={styles.syncProgressMsg}>
                        {s.msg} ... {s.step}/3
                      </span>
                      {s.retryCount > 0 && (
                        <span className={styles.syncProgressRetry}>
                          (재시도 {s.retryCount}회)
                        </span>
                      )}
                    </>
                  )}
                  {s.status === "success" && (
                    <span className={styles.syncProgressSuccess}>완료 ✓</span>
                  )}
                  {s.status === "failed" && (
                    <span className={styles.syncProgressFailed}>
                      실패 ✕{s.errorMsg ? ` (${s.errorMsg})` : ""}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
