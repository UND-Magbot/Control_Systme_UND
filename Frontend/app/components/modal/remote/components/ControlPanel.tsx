'use client';

import React, { useState } from 'react';
import TabMenu from '@/app/components/button/TabMenu';
import type { Tab, TabKey } from '@/app/types';
import ModeSpeedControl from './ModeSpeedControl';
import WorkProgressPanel from './WorkProgressPanel';
import styles from './ControlPanel.module.css';

const TABS: Tab[] = [
  { id: 'control', label: '제어' },
  { id: 'work', label: '작업 진행' },
];

type PathOption = {
  id: number;
  wayName: string;
  wayPoints: string;
  waitSeconds?: number[];
  taskType: string;
  floorId: number | null;
};

type ControlPanelProps = {
  robotType: string;
  motionState?: number | null;
  isCharging?: boolean;
  isWorking: boolean;
  isWorkPending: boolean;
  loopCount: number | string;
  loopCurrent: number;
  loopTotal: number;
  loopInfinite: boolean;
  isDisconnected: boolean;
  onStartWork: (loop: number, autoCharge: boolean) => void;
  onStopWork: () => void;
  onLoopCountChange: (value: string) => void;
  onLoopCountBlur: () => void;
  // 경로 선택
  paths: PathOption[];
  selectedPath: PathOption | null;
  onSelectPath: (path: PathOption | null) => void;
  // 작업 유형 필터
  taskTypeFilter: string | null;
  onTaskTypeFilterChange: (value: string | null) => void;
  // 직접 경로 생성
  isCreating: boolean;
  createdPoints: { x: number; y: number; yaw: number; waitSeconds?: number }[];
  onStartCreating: () => void;
  onSavePoint: () => void;
  onSetPointWait: (idx: number, waitSeconds: number) => void;
  onClearPoints: () => void;
  onFinishCreating: (wayName?: string, taskType?: string) => void;
  onCancelCreating: () => void;
};

export default function ControlPanel({
  robotType,
  motionState,
  isCharging = false,
  isWorking,
  isWorkPending,
  loopCount,
  loopCurrent,
  loopTotal,
  loopInfinite,
  isDisconnected,
  onStartWork,
  onStopWork,
  onLoopCountChange,
  onLoopCountBlur,
  paths,
  selectedPath,
  onSelectPath,
  taskTypeFilter,
  onTaskTypeFilterChange,
  isCreating,
  createdPoints,
  onStartCreating,
  onSavePoint,
  onSetPointWait,
  onClearPoints,
  onFinishCreating,
  onCancelCreating,
}: ControlPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('control');
  const controlDisabled = isWorking || isDisconnected;

  return (
    <div className={styles.controlSidebar}>
      <TabMenu tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div className={styles.tabContent}>
        {activeTab === 'control' && (
          <ModeSpeedControl
            robotType={robotType}
            motionState={motionState}
            isCharging={isCharging}
            disabled={controlDisabled}
          />
        )}

        {activeTab === 'work' && (
          <WorkProgressPanel
            isWorking={isWorking}
            isPending={isWorkPending}
            loopCount={loopCount}
            loopCurrent={loopCurrent}
            loopTotal={loopTotal}
            loopInfinite={loopInfinite}
            disabled={isDisconnected}
            onStartWork={onStartWork}
            onStopWork={onStopWork}
            onLoopCountChange={onLoopCountChange}
            onLoopCountBlur={onLoopCountBlur}
            paths={paths}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            taskTypeFilter={taskTypeFilter}
            onTaskTypeFilterChange={onTaskTypeFilterChange}
            isCreating={isCreating}
            createdPoints={createdPoints}
            onStartCreating={onStartCreating}
            onSavePoint={onSavePoint}
            onSetPointWait={onSetPointWait}
            onClearPoints={onClearPoints}
            onFinishCreating={onFinishCreating}
            onCancelCreating={onCancelCreating}
          />
        )}
      </div>
    </div>
  );
}
