"use client";

import React, { useCallback, useRef, useState } from "react";
import styles from "./DataManagementTabs.module.css";
import type { RobotType, Video } from "@/app/types";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import VideoTab from "./tabs/video/VideoTab";
import StatsTab from "./tabs/stats/StatsTab";
import LogTab from "./tabs/log/LogTab";

type TabKey = "video" | "dt" | "log";

type Props = {
  video: Video[];
  robotTypeData: RobotType[];
  onDataReady?: () => void;
  initialTab?: TabKey;
  initialSearch?: string;
};

export default function DataManagementTabs({
  video,
  robotTypeData,
  onDataReady,
  initialTab,
  initialSearch,
}: Props) {
  const { robots } = useRobotStatusContext();
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab || "video");

  // 페이지 로딩 완료 콜백 (전 탭 중 가장 먼저 로드되는 탭이 발화)
  const pageReadyCalled = useRef(false);
  const markReady = useCallback(() => {
    if (!pageReadyCalled.current && onDataReady) {
      pageReadyCalled.current = true;
      onDataReady();
    }
  }, [onDataReady]);

  return (
    <>
      <div className="page-header-tab">
        <h1>데이터 관리</h1>
        <div className={styles.videoListTab}>
          <div
            className={activeTab === "video" ? styles.active : ""}
            onClick={() => setActiveTab("video")}
          >
            영상 관리
          </div>
          <div
            className={activeTab === "dt" ? styles.active : ""}
            onClick={() => setActiveTab("dt")}
          >
            통계 관리
          </div>
          <div
            className={activeTab === "log" ? styles.active : ""}
            onClick={() => setActiveTab("log")}
          >
            로그 관리
          </div>
        </div>
      </div>

      {activeTab === "video" && (
        <VideoTab video={video} robots={robots} onLoaded={markReady} />
      )}
      {activeTab === "dt" && (
        <StatsTab robotTypeData={robotTypeData} robots={robots} onLoaded={markReady} />
      )}
      {activeTab === "log" && (
        <LogTab initialSearch={initialSearch} onLoaded={markReady} />
      )}
    </>
  );
}
