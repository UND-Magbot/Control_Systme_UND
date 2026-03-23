"use client";

import React from 'react';
import styles from './Button.module.css';
import type { TabKey, Tab } from '@/app/type';

type TabMenuProps = {
  tabs: Tab[];
  activeTab: TabKey;                
  onChange: (tabId: TabKey) => void; 
};

export default function TabMenu({ 
  tabs,
  activeTab,
  onChange 
}: TabMenuProps) {

  return (
    <div className={styles["tab-buttons"]}>
      {tabs.map(tab => (
        <button
          type="button"
          key={tab.id}
          className={`${styles["tab-btn"]} ${activeTab === tab.id ? styles["active"] : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}