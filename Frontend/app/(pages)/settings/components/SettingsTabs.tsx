"use client";

import { useEffect, useState } from "react";
import { usePageReady } from "@/app/context/PageLoadingContext";
// import { useAuth } from "@/app/context/AuthContext";
import styles from "../Setting.module.css";
import PermissionsTab from "./tabs/permissions/PermissionsTab";
import BackupTab from "./tabs/backup/BackupTab";
// import MenuManageTab from "./tabs/menus/MenuManageTab";

// 메뉴 관리 탭 비활성 중: 재활성화 시 "menus" 유니언/탭 항목/분기 주석 해제
type SettingTab = "permissions" /* | "menus" */ | "backup";

const TABS: { id: SettingTab; label: string }[] = [
  { id: "permissions", label: "메뉴 권한" },
  // { id: "menus", label: "메뉴 관리" }, // superadmin 전용 — 재활성화 시 isAdmin 분기 필요
  { id: "backup", label: "DB 백업" },
];

export default function SettingsTabs() {
  const setPageReady = usePageReady();
  // const { isAdmin } = useAuth(); // 메뉴 관리 탭 재활성화 시 사용
  const [activeTab, setActiveTab] = useState<SettingTab>("permissions");

  useEffect(() => { setPageReady(); }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="page-header-tab">
        <h1>설정</h1>
        <div className={styles.settingTab}>
          {TABS.map((tab) => (
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
        {/* {activeTab === "menus" && isAdmin && <MenuManageTab />} */}
        {activeTab === "backup" && <BackupTab />}
      </div>
    </div>
  );
}
