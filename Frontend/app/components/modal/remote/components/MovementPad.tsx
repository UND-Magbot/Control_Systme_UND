'use client';

import React, { useRef, useCallback } from 'react';
import { KEYBOARD_HINTS } from '../hooks/useKeyboardControls';
import styles from './MovementPad.module.css';

type MovementPadProps = {
  onCommand: (endpoint: string) => void;
  onStop: () => void;
  disabled?: boolean;
  activeKeyRef?: React.RefObject<string | null>;
};

const ENDPOINT_TO_KEYS: Record<string, string[]> = {
  '/robot/up': ['w', 'arrowup'],
  '/robot/down': ['s', 'arrowdown'],
  '/robot/left': ['a', 'arrowleft'],
  '/robot/right': ['d', 'arrowright'],
  '/robot/leftTurn': ['q'],
  '/robot/rightTurn': ['e'],
  '/robot/stop': [' '],
};

/** 둥근 chevron 아이콘 */
const ChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 15 12 9 18 15"/>
  </svg>
);
const ChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const ChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 6 9 12 15 18"/>
  </svg>
);
const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 6 15 12 9 18"/>
  </svg>
);


export default function MovementPad({
  onCommand,
  onStop,
  disabled = false,
  activeKeyRef,
}: MovementPadProps) {
  const throttleRef = useRef<number>(0);

  const isKeyActive = useCallback(
    (endpoint: string): boolean => {
      if (!activeKeyRef?.current) return false;
      return ENDPOINT_TO_KEYS[endpoint]?.includes(activeKeyRef.current) ?? false;
    },
    [activeKeyRef],
  );

  const handlePress = useCallback(
    (endpoint: string) => {
      if (disabled) return;
      const now = Date.now();
      if (now - throttleRef.current < 200) return;
      throttleRef.current = now;
      onCommand(endpoint);
    },
    [disabled, onCommand],
  );

  const handleRelease = useCallback(() => {
    if (disabled) return;
    onStop();
  }, [disabled, onStop]);

  const bindPress = useCallback(
    (endpoint: string) => ({
      onMouseDown: () => handlePress(endpoint),
      onMouseUp: handleRelease,
      onMouseLeave: handleRelease,
      onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); handlePress(endpoint); },
      onTouchEnd: handleRelease,
    }),
    [handlePress, handleRelease],
  );

  return (
    <div className={`${styles.section} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.header}>
        <span className={styles.padTitle}>원격 패드</span>
        <div className={styles.helpIcon}>
          <span>?</span>
          <div className={styles.helpTooltip}>
            <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동</div>
            <div><kbd>Q</kbd><kbd>E</kbd> 회전</div>
            <div><kbd>Space</kbd> 정지</div>
          </div>
        </div>
      </div>

      <div className={styles.padLayout}>
        <div className={styles.dpad}>
          <button type="button" className={`${styles.dBtn} ${styles.up} ${isKeyActive('/robot/up') ? styles.active : ''}`} {...bindPress('/robot/up')} disabled={disabled} title={KEYBOARD_HINTS['/robot/up']}>
            <ChevronUp />
          </button>
          <button type="button" className={`${styles.dBtn} ${styles.left} ${isKeyActive('/robot/left') ? styles.active : ''}`} {...bindPress('/robot/left')} disabled={disabled} title={KEYBOARD_HINTS['/robot/left']}>
            <ChevronLeft />
          </button>
          <button type="button" className={`${styles.stopBtn} ${isKeyActive('/robot/stop') ? styles.active : ''}`} onMouseDown={() => { if (!disabled) onStop(); }} onTouchStart={(e) => { e.preventDefault(); if (!disabled) onStop(); }} disabled={disabled} title={KEYBOARD_HINTS['/robot/stop']}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="1.5"/></svg>
          </button>
          <button type="button" className={`${styles.dBtn} ${styles.right} ${isKeyActive('/robot/right') ? styles.active : ''}`} {...bindPress('/robot/right')} disabled={disabled} title={KEYBOARD_HINTS['/robot/right']}>
            <ChevronRight />
          </button>
          <button type="button" className={`${styles.turnBtn} ${styles.lturn} ${isKeyActive('/robot/leftTurn') ? styles.active : ''}`} {...bindPress('/robot/leftTurn')} disabled={disabled} title={KEYBOARD_HINTS['/robot/leftTurn']}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
          <button type="button" className={`${styles.dBtn} ${styles.down} ${isKeyActive('/robot/down') ? styles.active : ''}`} {...bindPress('/robot/down')} disabled={disabled} title={KEYBOARD_HINTS['/robot/down']}>
            <ChevronDown />
          </button>
          <button type="button" className={`${styles.turnBtn} ${styles.rturn} ${isKeyActive('/robot/rightTurn') ? styles.active : ''}`} {...bindPress('/robot/rightTurn')} disabled={disabled} title={KEYBOARD_HINTS['/robot/rightTurn']}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
