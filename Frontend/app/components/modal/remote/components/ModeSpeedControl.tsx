'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRemoteCommand } from '../hooks/useRemoteCommand';
import { getRobotCapabilities } from '@/app/constants/robotCapabilities';
import styles from './ControlPanel.module.css';

type ModeSpeedControlProps = {
  robotType: string;
  /** 로봇 자세 (1=Stand, 4=Sit). null이면 미확인 — 버튼 모두 비활성. */
  motionState?: number | null;
  disabled?: boolean;
};

type Mode = 'stand' | 'sit';
type Speed = 'slow' | 'normal' | 'fast';
type Terrain = 'flat' | 'stair';
type RobotMode = 'regular' | 'navigation' | 'assist';

export default function ModeSpeedControl({ robotType, motionState, disabled = false }: ModeSpeedControlProps) {
  const caps = getRobotCapabilities(robotType);
  const { execute: execMode, state: modeState } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execSpeed, state: speedState } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execLight } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execTerrain } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execRobotMode } = useRemoteCommand({ debounceMs: 300 });

  // motionState → activeMode 동기화 (1=Stand, 17=RL Control(Stand), 4=Sit)
  const derivedMode: Mode | null =
    motionState === 1 || motionState === 17 ? 'stand' : motionState === 4 ? 'sit' : null;
  const [activeMode, setActiveMode] = useState<Mode>(derivedMode ?? 'stand');
  useEffect(() => {
    if (derivedMode && derivedMode !== activeMode) {
      setActiveMode(derivedMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedMode]);
  const [activeSpeed, setActiveSpeed] = useState<Speed>('normal');
  const [activeTerrain, setActiveTerrain] = useState<Terrain>('flat');
  const [activeRobotMode, setActiveRobotMode] = useState<RobotMode>('regular');
  const [frontOn, setFrontOn] = useState(false);
  const [rearOn, setRearOn] = useState(false);

  const handleMode = async (mode: Mode) => {
    if (disabled || modeState === 'pending') return;
    const ok = await execMode(`/robot/${mode}`, mode === 'stand' ? 'Stand' : 'Sit');
    if (ok) setActiveMode(mode);
  };

  const handleSpeed = async (speed: Speed) => {
    if (disabled || speedState === 'pending') return;
    const labels: Record<Speed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };
    const ok = await execSpeed(`/robot/${speed}`, labels[speed]);
    if (ok) setActiveSpeed(speed);
  };

  const handleTerrain = async (terrain: Terrain) => {
    if (disabled) return;
    const endpoint = terrain === 'flat' ? '/robot/terrain_flat' : '/robot/terrain_stair';
    const label = terrain === 'flat' ? '평지 모드' : '계단 모드';
    const ok = await execTerrain(endpoint, label);
    if (ok) setActiveTerrain(terrain);
  };

  const handleRobotMode = async (mode: RobotMode) => {
    if (disabled) return;
    const endpoints: Record<RobotMode, string> = {
      regular: '/robot/mode_regular',
      navigation: '/robot/mode_navigation',
      assist: '/robot/mode_assist',
    };
    const labels: Record<RobotMode, string> = {
      regular: 'Regular',
      navigation: 'Navigation',
      assist: 'Assist',
    };
    const ok = await execRobotMode(endpoints[mode], labels[mode]);
    if (ok) setActiveRobotMode(mode);
  };

  const toggleFront = useCallback(async () => {
    if (disabled) return;
    const next = !frontOn;
    const ok = await execLight(next ? '/robot/front_on' : '/robot/front_off');
    if (ok) setFrontOn(next);
  }, [disabled, frontOn, execLight]);

  const toggleRear = useCallback(async () => {
    if (disabled) return;
    const next = !rearOn;
    const ok = await execLight(next ? '/robot/rear_on' : '/robot/rear_off');
    if (ok) setRearOn(next);
  }, [disabled, rearOn, execLight]);

  return (
    <div className={`${styles.section} ${disabled ? styles.disabled : ''}`}>
      {/* 자세: Stand/Sit
          - motionState가 알려지지 않으면(null) 둘 다 disabled
          - 현재 자세와 같은 쪽 버튼은 disabled (연속 동일 명령 방지)
          - 반대 쪽 버튼만 활성화 */}
      {caps.hasStandSit && (
        <div className={styles.controlGroup}>
          <div className={styles.controlLabel}>자세</div>
          <div className={styles.segmentGroup}>
            <button
              type="button"
              className={`${styles.segmentBtn} ${activeMode === 'stand' ? styles.active : ''}`}
              onClick={() => handleMode('stand')}
              disabled={disabled || derivedMode === null || activeMode === 'stand'}
            >
              Stand
            </button>
            <button
              type="button"
              className={`${styles.segmentBtn} ${activeMode === 'sit' ? styles.active : ''}`}
              onClick={() => handleMode('sit')}
              disabled={disabled || derivedMode === null || activeMode === 'sit'}
            >
              Sit
            </button>
          </div>
        </div>
      )}

      {/* 모드 — 추후 백엔드 연동 후 활성화
      <div className={styles.controlGroup}>
        <div className={styles.controlLabel}>모드</div>
        <div className={styles.segmentGroup}>
          {(['regular', 'navigation', 'assist'] as RobotMode[]).map((m) => (
            <button key={m} type="button" className={`${styles.segmentBtn} ${activeRobotMode === m ? styles.active : ''}`} onClick={() => handleRobotMode(m)} disabled={disabled}>
              {m === 'regular' ? 'Regular' : m === 'navigation' ? 'Navi' : 'Assist'}
            </button>
          ))}
        </div>
      </div> */}

      {/* 지형 — 추후 ROS2 연동 후 활성화
      <div className={styles.controlGroup}>
        <div className={styles.controlLabel}>지형</div>
        <div className={styles.segmentGroup}>
          <button type="button" className={`${styles.segmentBtn} ${activeTerrain === 'flat' ? styles.active : ''}`} onClick={() => handleTerrain('flat')} disabled={disabled}>Flat</button>
          <button type="button" className={`${styles.segmentBtn} ${activeTerrain === 'stair' ? styles.active : ''}`} onClick={() => handleTerrain('stair')} disabled={disabled}>Stair</button>
        </div>
      </div> */}

      {/* 속도 — Stand/RL Control 상태에서만 표시 */}
      {(derivedMode === 'stand' || derivedMode === null) && (
        <div className={styles.controlGroup}>
          <div className={styles.controlLabel}>속도</div>
          <div className={styles.segmentGroup}>
            {(['slow', 'normal', 'fast'] as Speed[]).map((sp) => (
              <button key={sp} type="button" className={`${styles.segmentBtn} ${activeSpeed === sp ? styles.active : ''}`} onClick={() => handleSpeed(sp)} disabled={disabled}>
                {sp === 'slow' ? 'Slow' : sp === 'normal' ? 'Normal' : 'Fast'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 조명 (타이틀 + 토글 한 줄) */}
      <div className={styles.controlGroup}>
        <div className={styles.lightingRow}>
          <div className={styles.controlLabel}>조명</div>
          <div className={styles.lightingInline}>
            <div className={styles.lightingItem}>
              <span className={styles.lightTag}>전방</span>
              <button type="button" className={`${styles.toggleSwitch} ${frontOn ? styles.toggleOn : ''}`} onClick={toggleFront} disabled={disabled} aria-pressed={frontOn}>
                <span className={styles.toggleThumb} />
              </button>
            </div>
            <div className={styles.lightingItem}>
              <span className={styles.lightTag}>후방</span>
              <button type="button" className={`${styles.toggleSwitch} ${rearOn ? styles.toggleOn : ''}`} onClick={toggleRear} disabled={disabled} aria-pressed={rearOn}>
                <span className={styles.toggleThumb} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
