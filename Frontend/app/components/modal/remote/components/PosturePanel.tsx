'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/app/lib/api';
import styles from './PosturePanel.module.css';

/**
 * Posture(자세) 제어 패널 — 자세 보행(0xf001) 진입 시 인라인으로 펼쳐진다.
 *
 * Rotate(Roll/Pitch/Yaw)·Translation(X/Y/Z) 탭의 슬라이더 [-1,1]를 조정하면
 * POST /robot/posture 로 6축 setpoint를 보낸다(Type 2/21). 셋포인트라 값이 바뀔
 * 때만 보내면 로봇이 그 기울기를 유지한다. 드래그 폭주를 막기 위해 ~10Hz로 throttle.
 *
 * 패널이 사라질 때(자세 모드 이탈) 수평(전체 0)으로 복귀시켜 로봇이 기운 채 남지 않게 한다.
 */

type Axis = 'X' | 'Y' | 'Z' | 'Roll' | 'Pitch' | 'Yaw';
type PostureValues = Record<Axis, number>;
type Tab = 'rotate' | 'translate';

const ZERO: PostureValues = { X: 0, Y: 0, Z: 0, Roll: 0, Pitch: 0, Yaw: 0 };

const TAB_AXES: Record<Tab, { axis: Axis; label: string; hint: string }[]> = {
  rotate: [
    { axis: 'Roll', label: 'Roll', hint: '좌우 기울기' },
    { axis: 'Pitch', label: 'Pitch', hint: '앞뒤 기울기' },
    { axis: 'Yaw', label: 'Yaw', hint: '수평 회전' },
  ],
  translate: [
    { axis: 'X', label: 'X', hint: '전후' },
    { axis: 'Y', label: 'Y', hint: '좌우' },
    { axis: 'Z', label: 'Z', hint: '상하' },
  ],
};

const SEND_INTERVAL_MS = 100;

type PosturePanelProps = {
  disabled?: boolean;
};

export default function PosturePanel({ disabled = false }: PosturePanelProps) {
  const [tab, setTab] = useState<Tab>('rotate');
  const [values, setValues] = useState<PostureValues>(ZERO);

  // throttle 상태 — 드래그 중 ~10Hz로 전송 + 마지막 값 보장(trailing)
  const throttleRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    last: number;
    pending: PostureValues | null;
  }>({ timer: null, last: 0, pending: null });

  const post = useCallback((v: PostureValues) => {
    apiFetch('/robot/posture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    }).catch(() => {
      /* 전송 실패 무시 — 다음 슬라이더 값으로 곧 갱신된다 */
    });
  }, []);

  const send = useCallback(
    (v: PostureValues) => {
      const t = throttleRef.current;
      const now = Date.now();
      const elapsed = now - t.last;
      if (elapsed >= SEND_INTERVAL_MS) {
        t.last = now;
        post(v);
      } else {
        t.pending = v;
        if (!t.timer) {
          t.timer = setTimeout(() => {
            t.timer = null;
            t.last = Date.now();
            if (t.pending) {
              post(t.pending);
              t.pending = null;
            }
          }, SEND_INTERVAL_MS - elapsed);
        }
      }
    },
    [post],
  );

  const handleChange = (axis: Axis, value: number) => {
    if (disabled) return;
    const next = { ...values, [axis]: value };
    setValues(next);
    send(next);
  };

  const handleReset = () => {
    if (disabled) return;
    setValues(ZERO);
    post(ZERO); // 즉시 수평 복귀
  };

  // 언마운트(자세 모드 이탈) 시 수평 복귀
  useEffect(() => {
    return () => {
      const t = throttleRef.current;
      if (t.timer) {
        clearTimeout(t.timer);
        t.timer = null;
      }
      post(ZERO);
    };
  }, [post]);

  return (
    <div className={`${styles.panel} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === 'rotate' ? styles.tabActive : ''}`}
          onClick={() => setTab('rotate')}
        >
          Rotate
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === 'translate' ? styles.tabActive : ''}`}
          onClick={() => setTab('translate')}
        >
          Translation
        </button>
      </div>

      <div className={styles.sliders}>
        {TAB_AXES[tab].map(({ axis, label, hint }) => (
          <div key={axis} className={styles.sliderRow}>
            <div className={styles.sliderHead}>
              <span className={styles.axisLabel}>{label}</span>
              <span className={styles.axisHint}>{hint}</span>
              <span className={styles.axisValue}>{values[axis].toFixed(2)}</span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min={-1}
              max={1}
              step={0.02}
              value={values[axis]}
              onChange={(e) => handleChange(axis, parseFloat(e.target.value))}
              disabled={disabled}
            />
          </div>
        ))}
      </div>

      <button type="button" className={styles.resetBtn} onClick={handleReset} disabled={disabled}>
        수평 복귀 (전체 0)
      </button>
    </div>
  );
}
