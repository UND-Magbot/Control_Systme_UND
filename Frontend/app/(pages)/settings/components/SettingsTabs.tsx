"use client";

import { useEffect, useState } from "react";
import { usePageReady } from "@/app/context/PageLoadingContext";
import styles from "../Setting.module.css";
import PermissionsTab from "./tabs/permissions/PermissionsTab";
import BackupTab from "./tabs/backup/BackupTab";

type SettingTab = "permissions" | "backup";

const tabs: { id: SettingTab; label: string }[] = [
  { id: "permissions", label: "메뉴 권한" },
  { id: "backup", label: "DB 백업" },
];

export default function SettingsTabs() {
  const setPageReady = usePageReady();
  const [activeTab, setActiveTab] = useState<SettingTab>("permissions");

  useEffect(() => { setPageReady(); }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="page-header-tab">
        <h1>설정</h1>
        <div className={styles.settingTab}>
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

      <div className={styles.container}>
        {activeTab === "permissions" && <PermissionsTab />}
        {activeTab === "backup" && <BackupTab />}
      </div>
    </div>
  );
}
