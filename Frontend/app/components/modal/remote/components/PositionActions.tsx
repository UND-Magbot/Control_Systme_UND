'use client';

import React from 'react';
import { useRemoteCommand } from '../hooks/useRemoteCommand';
import InlineConfirm from './InlineConfirm';
import styles from './ControlPanel.module.css';

type PositionActionsProps = {
  disabled?: boolean;
};

export default function PositionActions({ disabled = false }: PositionActionsProps) {
  const { execute: execInit, state: initState } = useRemoteCommand({ debounceMs: 1000 });
  const { execute: execSave, state: saveState } = useRemoteCommand({ debounceMs: 1000 });
  const { execute: execClear } = useRemoteCommand({ debounceMs: 1000 });

  const handleInitPose = () => {
    if (disabled) return;
    execInit('/robot/initpose', '위치 재조정');
  };

  const handleSavePoint = () => {
    if (disabled) return;
    execSave('/nav/savepoint', '웨이포인트 저장');
  };

  const handleClearPoints = () => {
    if (disabled) return;
    execClear('/nav/clearpoints', '웨이포인트 초기화');
  };

  return (
    <div className={`${styles.section} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.controlLabel}>위치 관리</div>
      <div className={styles.positionBtnGroup}>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={handleInitPose}
          disabled={disabled || initState === 'pending'}
        >
          {initState === 'pending' ? '처리 중...' : '위치 재조정'}
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={handleSavePoint}
          disabled={disabled || saveState === 'pending'}
        >
          {saveState === 'pending' ? '저장 중...' : '위치 저장'}
        </button>
        <InlineConfirm
          label="위치 초기화"
          confirmLabel="정말 초기화?"
          onConfirm={handleClearPoints}
          disabled={disabled}
          variant="danger"
        />
      </div>
    </div>
  );
}
