"use client";

import type { Floor } from "@/app/types";
import styles from "./FacilityTab.module.css";

// 층별 설비 현황. 엘리베이터/자동문 유형을 오가도 이 스택은 그대로다 —
// "1F에 무엇이 있나"를 한 곳에서 읽게 하려고 유형별로 복제하지 않는다.
export type FloorFacility = {
  /** 엘리베이터 정차 등록 여부(편집 중 초안 반영) */
  evStop?: boolean;
  /** 정차 완료(맵 + POI 3종) */
  evComplete?: boolean;
  /** 자동문 등록 여부 */
  door?: boolean;
  /** 자동문 완료(맵 + 양측 POI + 개폐 방식) */
  doorComplete?: boolean;
};

type Props = {
  floors: Floor[];
  facilities: Record<number, FloorFacility>;
  robotFloorIds: Set<number>;
  /** 선택 중인 설비가 속한 층 — 테두리로 강조 */
  focusFloorId?: number | null;
};

export default function FloorStack({ floors, facilities, robotFloorIds, focusFloorId }: Props) {
  const floorsDesc = [...floors].sort((a, b) => b.id - a.id);

  return (
    <div className={styles.stack}>
      {floorsDesc.map((f) => {
        const fac = facilities[f.id] ?? {};
        const stop = !!fac.evStop;
        const focus = focusFloorId != null && focusFloorId === f.id;
        return (
          <div
            key={f.id}
            className={`${styles.flr} ${stop ? styles.flrStop : ""} ${focus ? styles.flrFocus : ""}`}
          >
            <span className={styles.flrLabel}>{f.label}</span>
            <span className={styles.flrBadges}>
              {robotFloorIds.has(f.id) && (
                <span className={`${styles.badge} ${styles.badgeRobot}`}>로봇</span>
              )}
              {fac.door && (
                <span
                  className={`${styles.badge} ${fac.doorComplete ? styles.badgeDoor : styles.badgeWarn}`}
                >
                  자동문
                </span>
              )}
              {stop && (
                fac.evComplete
                  ? <span className={`${styles.badge} ${styles.badgeOk}`}>정차</span>
                  : <span className={`${styles.badge} ${styles.badgeWarn}`}>미완료</span>
              )}
            </span>
          </div>
        );
      })}
      {floorsDesc.length === 0 && <div className={styles.empty}>층 정보가 없습니다.</div>}
    </div>
  );
}
