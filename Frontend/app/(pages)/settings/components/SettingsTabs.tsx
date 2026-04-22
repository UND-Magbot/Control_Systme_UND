"use client";

import { useEffect, useMemo, useState } from "react";
import { usePageReady } from "@/app/context/PageLoadingContext";
// import { useAuth } from "@/app/context/AuthContext";  // 메뉴 관리 탭 비노출로 임시 미사용
import styles from "../Setting.module.css";
import PermissionsTab from "./tabs/permissions/PermissionsTab";
import BackupTab from "./tabs/backup/BackupTab";
// 메뉴 관리 탭 — UI 개선 작업 중 임시 비노출. 노출 재개 시 주석 해제.
// import MenuManageTab from "./tabs/menus/MenuManageTab";

type SettingTab = "permissions" | /* "menus" | */ "backup";

export default function SettingsTabs() {
  const setPageReady = usePageReady();
  // const { isAdmin } = useAuth();

  const tabs = useMemo(
    () => {
      const base: { id: SettingTab; label: string }[] = [
        { id: "permissions", label: "메뉴 권한" },
      ];
      // 메뉴 관리 탭 — UI 개선 작업 중 임시 비노출. 재노출 시 아래 및 위의 import 주석 해제.
      // if (isAdmin) base.push({ id: "menus", label: "메뉴 관리" });
      base.push({ id: "backup", label: "DB 백업" });
      return base;
    },
    []
  );

  const [activeTab, setActiveTab] = useState<SettingTab>("permissions");

  useEffect(() => { setPageReady(); }, []);

  // 탭 목록이 바뀌어 현재 탭이 사라졌을 때 첫 탭으로 복귀
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

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
        {/* {activeTab === "menus" && isAdmin && <MenuManageTab />} */}
        {activeTab === "backup" && <BackupTab />}
      </div>
    </div>
  );
}
