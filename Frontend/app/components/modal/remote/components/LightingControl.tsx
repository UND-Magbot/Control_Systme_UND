'use client';

import React, { useState, useCallback } from 'react';
import { useRemoteCommand } from '../hooks/useRemoteCommand';
import styles from './ControlPanel.module.css';

type LightingControlProps = {
  disabled?: boolean;
};

export default function LightingControl({ disabled = false }: LightingControlProps) {
  const { execute } = useRemoteCommand({ debounceMs: 300 });
  const [frontOn, setFrontOn] = useState(false);
  const [rearOn, setRearOn] = useState(false);

  const toggleFront = useCallback(async () => {
    if (disabled) return;
    const next = !frontOn;
    const endpoint = next ? '/robot/front_on' : '/robot/front_off';
    const ok = await execute(endpoint, `전방 조명 ${next ? 'On' : 'Off'}`);
    if (ok) setFrontOn(next);
  }, [disabled, frontOn, execute]);

  const toggleRear = useCallback(async () => {
    if (disabled) return;
    const next = !rearOn;
    const endpoint = next ? '/robot/rear_on' : '/robot/rear_off';
    const ok = await execute(endpoint, `후방 조명 ${next ? 'On' : 'Off'}`);
    if (ok) setRearOn(next);
  }, [disabled, rearOn, execute]);

  return (
    <div className={`${styles.section} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.controlLabel}>조명</div>
      <div className={styles.lightingRow}>
        <span className={styles.lightLabel}>전방</span>
        <button
          type="button"
          className={`${styles.toggleSwitch} ${frontOn ? styles.toggleOn : ''}`}
          onClick={toggleFront}
          disabled={disabled}
          aria-pressed={frontOn}
        >
          <span className={styles.toggleThumb} />
        </button>
      </div>
      <div className={styles.lightingRow}>
        <span className={styles.lightLabel}>후방</span>
        <button
          type="button"
          className={`${styles.toggleSwitch} ${rearOn ? styles.toggleOn : ''}`}
          onClick={toggleRear}
          disabled={disabled}
          aria-pressed={rearOn}
        >
          <span className={styles.toggleThumb} />
        </button>
      </div>
    </div>
  );
}
