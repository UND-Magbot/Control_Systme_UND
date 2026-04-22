"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./DataManagementTabs.module.css";
import type { RobotType, Video } from "@/app/types";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import { useAuth } from "@/app/context/AuthContext";
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

// TabKey ↔ MenuKey 매핑 (권한 체크 및 DB label 조회용)
const TAB_MENU_KEY: Record<TabKey, string> = {
  video: "video",
  dt: "statistics",
  log: "log",
};

const TAB_FALLBACK_LABEL: Record<TabKey, string> = {
  video: "영상 관리",
  dt: "통계 관리",
  log: "로그 관리",
};

export default function DataManagementTabs({
  video,
  robotTypeData,
  onDataReady,
  initialTab,
  initialSearch,
}: Props) {
  const { robots } = useRobotStatusContext();
  const { hasPermission, isMenuVisible, menuIndex } = useAuth();

  // 권한+가시성 있는 탭만 필터링
  const tabs = useMemo(() => {
    const all: TabKey[] = ["video", "dt", "log"];
    return all
      .filter((id) => hasPermission(TAB_MENU_KEY[id]) && isMenuVisible(TAB_MENU_KEY[id]))
      .map((id) => ({
        id,
        label: menuIndex.get(TAB_MENU_KEY[id])?.label ?? TAB_FALLBACK_LABEL[id],
      }));
  }, [hasPermission, isMenuVisible, menuIndex]);

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab || "video");

  // 초기 탭이나 현재 탭이 필터링으로 사라졌으면 첫 탭으로 복귀
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  // 페이지 로딩 완료 콜백 (전 탭 중 가장 먼저 로드되는 탭이 발화)
  const pageReadyCalled = useRef(false);
  const markReady = useCallback(() => {
    if (!pageReadyCalled.current && onDataReady) {
      pageReadyCalled.current = true;
      onDataReady();
    }
  }, [onDataReady]);

  // 접근 가능한 탭이 하나도 없으면 페이지 로드 완료 통보 (빈 상태)
  useEffect(() => {
    if (tabs.length === 0) markReady();
  }, [tabs.length, markReady]);

  return (
    <>
      <div className="page-header-tab">
        <h1>데이터 관리</h1>
        <div className={styles.videoListTab}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={activeTab === tab.id ? styles.active : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      {activeTab === "video" && tabs.some((t) => t.id === "video") && (
        <VideoTab video={video} robots={robots} onLoaded={markReady} />
      )}
      {activeTab === "dt" && tabs.some((t) => t.id === "dt") && (
        <StatsTab robotTypeData={robotTypeData} robots={robots} onLoaded={markReady} />
      )}
      {activeTab === "log" && tabs.some((t) => t.id === "log") && (
        <LogTab initialSearch={initialSearch} onLoaded={markReady} />
      )}
    </>
  );
}
