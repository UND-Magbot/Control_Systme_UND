'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRemoteCommand } from '../hooks/useRemoteCommand';
import { getRobotCapabilities } from '@/app/constants/robotCapabilities';
import PosturePanel from './PosturePanel';
import styles from './ControlPanel.module.css';

type ModeSpeedControlProps = {
  robotType: string;
  /** 로봇 자세 (1=Stand, 4=Sit). null이면 미확인 — 버튼 모두 비활성. */
  motionState?: number | null;
  /** 현재 보행값 (0x1001 기본/0x1002 고장애물/0x1003 계단/0xf001 자세). 버튼 active 동기화용. */
  gait?: number | null;
  /** 로봇 충전 중 여부 — true면 자세 섹션 숨기고 '충전 해제' 버튼 활성. */
  isCharging?: boolean;
  disabled?: boolean;
};

type Mode = 'stand' | 'sit';
type Speed = 'slow' | 'normal' | 'fast';
type Gait = 'basic' | 'highObstacle' | 'stair' | 'posture';
type RobotMode = 'regular' | 'navigation' | 'assist';

// Standard 모드 보행 — receiver가 relay_motion 경유로 ROS2 /GAIT 발행 (0x100X)
const GAIT_ENDPOINTS: Record<Gait, string> = {
  basic: '/robot/gait_basic',
  highObstacle: '/robot/gait_high_obstacle',
  stair: '/robot/gait_stair',
  posture: '/robot/gait_posture',
};
const GAIT_LABELS: Record<Gait, string> = {
  basic: 'Standard',
  highObstacle: 'High Obstacles',
  stair: 'Stair',
  posture: 'Posture',
};
// 로봇이 보고하는 gait 값 → 버튼. Agile(0x300X) 등 미해당 값이면 매핑 없음(null).
const GAIT_BY_VALUE: Record<number, Gait> = {
  0x1001: 'basic',
  0x1002: 'highObstacle',
  0x1003: 'stair',
  0xf001: 'posture',
};

export default function ModeSpeedControl({ robotType, motionState, gait, isCharging = false, disabled = false }: ModeSpeedControlProps) {
  const caps = getRobotCapabilities(robotType);
  const { execute: execMode, state: modeState } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execSpeed, state: speedState } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execLight } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execGait } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execRobotMode } = useRemoteCommand({ debounceMs: 300 });
  const { execute: execCharge, state: chargeCmdState } = useRemoteCommand({ debounceMs: 300 });

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
  // 실제 보행값(gait)으로 active 버튼 동기화 — motionState→activeMode와 동일 패턴
  const derivedGait: Gait | null = gait != null ? (GAIT_BY_VALUE[gait] ?? null) : null;
  const [activeGait, setActiveGait] = useState<Gait>(derivedGait ?? 'basic');
  useEffect(() => {
    if (derivedGait && derivedGait !== activeGait) {
      setActiveGait(derivedGait);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedGait]);
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

  const handleGait = async (gait: Gait) => {
    if (disabled) return;
    const ok = await execGait(GAIT_ENDPOINTS[gait], `${GAIT_LABELS[gait]} 보행`);
    if (ok) setActiveGait(gait);
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

  const handleCharge = useCallback(async () => {
    if (disabled || chargeCmdState === 'pending') return;
    if (isCharging) {
      await execCharge('/robot/stop-charge', '충전 해제');
    } else {
      await execCharge('/robot/charge', '충전 시작');
    }
  }, [disabled, chargeCmdState, isCharging, execCharge]);

  return (
    <div className={`${styles.section} ${disabled ? styles.disabled : ''}`}>
      {/* 자세: Stand/Sit
          - 자세 확인됨(derivedMode≠null): 현재 자세 버튼만 disabled (연속 동일 명령 방지),
            반대 쪽만 활성화
          - 자세 미확인(motionState null 또는 1/4/17 외 값): 드문 상황 — 둘 다 활성화하여
            운영자가 강제로 자세를 잡을 수 있게 한다
          - disabled prop(작업 중/연결 끊김)일 때만 둘 다 비활성
          - 충전 중에는 숨김 (도킹 상태에서 자세 전환 불필요) */}
      {caps.hasStandSit && !isCharging && (
        <div className={styles.controlGroup}>
          <div className={styles.controlLabel}>자세</div>
          <div className={styles.segmentGroup}>
            <button
              type="button"
              className={`${styles.segmentBtn} ${activeMode === 'stand' ? styles.active : ''}`}
              onClick={() => handleMode('stand')}
              disabled={disabled || (derivedMode !== null && activeMode === 'stand')}
            >
              Stand
            </button>
            <button
              type="button"
              className={`${styles.segmentBtn} ${activeMode === 'sit' ? styles.active : ''}`}
              onClick={() => handleMode('sit')}
              disabled={disabled || (derivedMode !== null && activeMode === 'sit')}
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

      {/* 보행 — Standard 모드 (기본/고장애물/계단/자세), relay_motion 경유 ROS2 /GAIT.
          Sit 상태에선 보행 전환이 의미 없어 속도처럼 숨김. */}
      {(derivedMode === 'stand' || derivedMode === null) && (
        <div className={styles.controlGroup}>
          <div className={styles.controlLabel}>보행</div>
          <div className={styles.segmentGroup}>
            {(['basic', 'stair', 'highObstacle', 'posture'] as Gait[]).map((g) => (
              <button
                key={g}
                type="button"
                className={`${styles.segmentBtn} ${activeGait === g ? styles.active : ''}`}
                onClick={() => handleGait(g)}
                disabled={disabled}
              >
                {GAIT_LABELS[g]}
              </button>
            ))}
          </div>

          {/* 자세 보행 선택 시 6축 setpoint 슬라이더 패널 인라인 펼침 */}
          {activeGait === 'posture' && <PosturePanel disabled={disabled} />}
        </div>
      )}

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

      {/* 충전 — 토글 버튼 하나
          충전 중: '충전 해제' (Charge=0) / 비충전: '충전 시작' (Charge=1) */}
      <div className={styles.controlGroup}>
        <div className={styles.controlLabel}>충전</div>
        <button
          type="button"
          className={`${styles.chargeBtn} ${isCharging ? styles.chargeBtnActive : ''}`}
          onClick={handleCharge}
          disabled={disabled || chargeCmdState === 'pending'}
        >
          {isCharging ? '충전 해제' : '충전 시작'}
        </button>
      </div>

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
