"use client";

import React, { useState, useEffect, Suspense } from 'react';
import type { RobotRowData, Floor } from '@/app/types';
import WorkSchedule from './WorkSchedule';
import RunHistory from './RunHistory';
import StandbyTab from './StandbyTab';
import styles from '../Schedules.module.css';
import getRobots from "@/app/lib/robotInfo";
import { usePageReady } from "@/app/context/PageLoadingContext";

interface SchedulePageClientProps {
  floors: Floor[];
}

type TabKey = 'schedule' | 'standby' | 'runs';

const TABS: { id: TabKey; label: string }[] = [
  { id: 'schedule', label: '작업 일정' },
  { id: 'standby', label: '응대 세션' },
  { id: 'runs', label: '실행 이력' },
];

export default function SchedulePageClient({ floors }: SchedulePageClientProps) {
  const [robots, setRobots] = useState<RobotRowData[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const setPageReady = usePageReady();

  useEffect(() => {
    getRobots().then((data) => { setRobots(data); setPageReady(); }).catch(() => setPageReady());
  }, []);

  return (
    <>
      {/* 다른 메뉴(데이터/운영/설정/맵)와 같은 탭 규약을 쓴다 — 내비게이션이 화면마다
          다르게 생기면 배우는 비용만 늘어난다. 상태 범례는 색을 쓰는 캘린더 옆으로 옮겼다. */}
      <div className="page-header-tab">
        <h1>작업관리</h1>
        <div className={styles.scheduleTab}>
          {TABS.map((tab) => (
            <div
              key={tab.id}
              className={activeTab === tab.id ? styles.active : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      {activeTab === 'schedule' && (
        <Suspense>
          <WorkSchedule robots={robots} />
        </Suspense>
      )}
      {activeTab === 'standby' && (
        <div className={styles.runHistoryPanel}>
          <StandbyTab robots={robots} />
        </div>
      )}
      {activeTab === 'runs' && (
        <div className={styles.runHistoryPanel}>
          <RunHistory robots={robots} />
        </div>
      )}
    </>
  );
}
