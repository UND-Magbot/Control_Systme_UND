"use client";

import React, { useEffect, useMemo, useState } from "react";
import styles from "./OperationManagementTabs.module.css";
import type { Camera, PowerItem, Video } from "@/app/types";
import { useAuth } from "@/app/context/AuthContext";
import RobotManageTab from "./tabs/robot/RobotManageTab";
import BusinessManageTab from "./tabs/business/BusinessManageTab";

type TabKey = "robots" | "business";

type Props = {
  cameras: Camera[];
  video: Video[];
  powerStatus: PowerItem[];
};

const TAB_MENU_KEY: Record<TabKey, string> = {
  robots: "robot-list",
  business: "business-list",
};

const TAB_FALLBACK_LABEL: Record<TabKey, string> = {
  robots: "로봇 목록",
  business: "사업장 목록",
};

export default function OperationManagementTabs(props: Props) {
  const { hasPermission, isMenuVisible, menuIndex } = useAuth();

  const tabs = useMemo(() => {
    const all: TabKey[] = ["robots", "business"];
    return all
      .filter((id) => hasPermission(TAB_MENU_KEY[id]) && isMenuVisible(TAB_MENU_KEY[id]))
      .map((id) => ({
        id,
        label: menuIndex.get(TAB_MENU_KEY[id])?.label ?? TAB_FALLBACK_LABEL[id],
      }));
  }, [hasPermission, isMenuVisible, menuIndex]);

  const [activeTab, setActiveTab] = useState<TabKey>("robots");

  // URL ?tab=... 동기화
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "robots" || tab === "business") setActiveTab(tab);
  }, []);

  // 권한 필터링으로 현재 탭이 사라졌으면 첫 탭으로 복귀
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  const activeLabel = tabs.find((t) => t.id === activeTab)?.label ?? TAB_FALLBACK_LABEL[activeTab];

  return (
    <>
      <div className="page-header-tab">
        <h1>{activeLabel}</h1>
        <div className={styles.robotListTab}>
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

      {activeTab === "robots" && tabs.some((t) => t.id === "robots") && <RobotManageTab {...props} />}
      {activeTab === "business" && tabs.some((t) => t.id === "business") && <BusinessManageTab />}
    </>
  );
}
