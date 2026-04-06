"use client";

import { useState, useEffect } from 'react';
import { usePageReady } from "@/app/context/PageLoadingContext";
import styles from './Setting.module.css';
import MenuPermissions from './components/MenuPermissions';
import DbBackup from './components/DbBackup';
import PasswordChange from './components/PasswordChange';

type SettingTab = "permissions" | "backup" | "password";

const tabs: { id: SettingTab; label: string }[] = [
  { id: "permissions", label: "메뉴 권한" },
  { id: "backup", label: "DB 백업" },
  { id: "password", label: "비밀번호 변경" },
];

export default function Page() {
  const setPageReady = usePageReady();
  const [activeTab, setActiveTab] = useState<SettingTab>("permissions");

  useEffect(() => { setPageReady(); }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
        {activeTab === "permissions" && <MenuPermissions />}
        {activeTab === "backup" && <DbBackup />}
        {activeTab === "password" && <PasswordChange />}
      </div>
    </div>
  );
}
