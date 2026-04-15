'use client';

import React, { useState } from 'react';
import TabMenu from '@/app/components/button/TabMenu';
import type { Tab, TabKey } from '@/app/types';
import ModeSpeedControl from './ModeSpeedControl';
import PositionActions from './PositionActions';
import WorkAutomationPanel from './WorkAutomationPanel';
import styles from './ControlPanel.module.css';

const TABS: Tab[] = [
  { id: 'control', label: '제어' },
  { id: 'automation', label: '작업 자동화' },
];

type ControlPanelProps = {
  robotType: string;
  isWorking: boolean;
  isWorkPending: boolean;
  loopCount: number | string;
  isDisconnected: boolean;
  onStartWork: (loop: number) => void;
  onStopWork: () => void;
  onLoopCountChange: (value: string) => void;
  onLoopCountBlur: () => void;
};

export default function ControlPanel({
  robotType,
  isWorking,
  isWorkPending,
  loopCount,
  isDisconnected,
  onStartWork,
  onStopWork,
  onLoopCountChange,
  onLoopCountBlur,
}: ControlPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('control');
  const controlDisabled = isWorking || isDisconnected;

  return (
    <div className={styles.controlSidebar}>
      <TabMenu tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div className={styles.tabContent}>
        {activeTab === 'control' && (
          <ModeSpeedControl robotType={robotType} disabled={controlDisabled} />
        )}

        {activeTab === 'automation' && (
          <>
            <PositionActions disabled={controlDisabled} />
            <WorkAutomationPanel
              isWorking={isWorking}
              isPending={isWorkPending}
              loopCount={loopCount}
              disabled={isDisconnected}
              onStartWork={onStartWork}
              onStopWork={onStopWork}
              onLoopCountChange={onLoopCountChange}
              onLoopCountBlur={onLoopCountBlur}
            />
          </>
        )}
      </div>
    </div>
  );
}
