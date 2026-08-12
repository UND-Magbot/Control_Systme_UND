"use client";

import React, { useEffect, useState } from "react";
import styles from "./ServerHealthBanner.module.css";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import { formatElapsed, isStatusStale } from "@/app/lib/robotLiveness";

/**
 * 관제 서버(백엔드) 응답이 끊긴 구간을 화면 상단에 명시한다.
 *
 * 이 배너가 떠 있는 동안 로봇 상태 표시는 '확인 불가'이며, 로봇이 오프라인이라는
 * 뜻이 아니다. (로봇 통신 두절은 각 로봇의 '끊김/Offline' 배지로 따로 표시된다.)
 */
export default function ServerHealthBanner() {
  const { serverStatus, lastSuccessAt } = useRobotStatusContext();
  const stale = isStatusStale(serverStatus);
  const [, tick] = useState(0);

  // 경과 시간 표기를 1초마다 갱신
  useEffect(() => {
    if (!stale) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [stale]);

  if (!stale) return null;

  return (
    <div className={styles.banner} role="status">
      <span className={styles.dot} />
      <span className={styles.text}>
        <b>관제 서버 응답 없음</b> — 로봇 상태를 확인할 수 없습니다. 표시 값은 마지막 확인({formatElapsed(lastSuccessAt)}) 기준이며,
        로봇이 오프라인이라는 뜻은 아닙니다.
      </span>
    </div>
  );
}
