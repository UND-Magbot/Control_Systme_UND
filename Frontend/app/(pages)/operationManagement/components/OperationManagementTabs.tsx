"use client";

import React, { useEffect, useState } from "react";
import styles from "./OperationManagementTabs.module.css";
import type { Camera, PowerItem, Video } from "@/app/types";
import RobotManageTab from "./tabs/robot/RobotManageTab";
import BusinessManageTab from "./tabs/business/BusinessManageTab";

type TabKey = "robots" | "business";

type Props = {
  cameras: Camera[];
  video: Video[];
  powerStatus: PowerItem[];
};

export default function OperationManagementTabs(props: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("robots");

  // URL ?tab=... 동기화
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "robots" || tab === "business") setActiveTab(tab);
  }, []);

  return (
    <>
      <div className="page-header-tab">
        <h1>{activeTab === "robots" ? "로봇 목록" : "사업장 목록"}</h1>
        <div className={styles.robotListTab}>
          <div
            className={activeTab === "robots" ? styles.active : ""}
            onClick={() => setActiveTab("robots")}
          >
            로봇 목록
          </div>
          <div
            className={activeTab === "business" ? styles.active : ""}
            onClick={() => setActiveTab("business")}
          >
            사업장 목록
          </div>
        </div>
      </div>

      {activeTab === "robots" && <RobotManageTab {...props} />}
      {activeTab === "business" && <BusinessManageTab />}
    </>
  );
}
