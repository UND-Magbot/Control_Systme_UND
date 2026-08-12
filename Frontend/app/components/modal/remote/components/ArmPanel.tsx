'use client';

/**
 * RM 6축 팔 패널 (Phase 1 · additive).
 *
 * 관측(상태 1Hz 폴링) · 안전정지(일시정지/긴급정지) · 검증된 프리셋.
 * jog/MoveL/그리퍼는 현장 캘리브 이후 별도 Increment.
 *
 * 백엔드: /robot/arm/* (robot_control/arm/routes.py). 제어권은 controlHeaders() 로 실어 보낸다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import styles from './ArmPanel.module.css';
import {
  getArmStatus,
  getArmPresets,
  armPause,
  armEstop,
  armMovePreset,
  type ArmStatus,
  type ArmPreset,
} from '@/app/lib/armApi';

type Props = {
  /** 제어권 헤더 getter (RemoteModal useControlLock.controlHeaders). */
  controlHeaders?: () => Record<string, string>;
  /** 관찰 모드/연결 끊김 등으로 조작 비활성. */
  disabled?: boolean;
};

const POLL_MS = 1000;
const NO_HEADERS = () => ({});

export default function ArmPanel({ controlHeaders = NO_HEADERS, disabled = false }: Props) {
  const [status, setStatus] = useState<ArmStatus | null>(null);
  const [presets, setPresets] = useState<ArmPreset[]>([]);
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>({ text: '' });
  const [busy, setBusy] = useState(false);

  // 상태 1Hz 폴링
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getArmStatus();
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // 프리셋 목록(1회)
  useEffect(() => {
    getArmPresets().then(setPresets).catch(() => setPresets([]));
  }, []);

  const run = useCallback(
    async (label: string, call: () => Promise<Response>) => {
      setBusy(true);
      setMsg({ text: '' });
      try {
        const res = await call();
        if (res.ok) {
          setMsg({ text: `${label} 완료` });
        } else {
          let detail = `${res.status}`;
          try {
            const b = await res.json();
            detail = b?.detail?.message ?? b?.detail ?? detail;
          } catch {
            /* ignore */
          }
          setMsg({ text: `${label} 실패: ${detail}`, err: true });
        }
      } catch (e) {
        setMsg({ text: `${label} 오류: ${(e as Error).message}`, err: true });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const connected = !!status?.connected;
  const joints = (status?.connected && status.joints_deg) || [];
  const temps = (status?.connected && status.joint_temperatures) || [];
  const maxTemp = temps.length ? Math.max(...temps) : null;
  const maxTempJoint = maxTemp != null ? temps.indexOf(maxTemp) + 1 : null;

  return (
    <div className={styles.panel}>
      {/* 연결 상태 바 */}
      <div className={styles.bar}>
        <span className={styles.name}>RM65</span>
        <span className={`${styles.dot} ${connected ? styles.dotOn : styles.dotOff}`} />
        <span className={styles.conn}>{connected ? '연결됨' : '미연결'}</span>
        <span className={styles.sp} />
      </div>

      {/* 안전 정지 (안전 예외: 관찰 모드여도 정지는 허용) */}
      <div className={styles.stopRow}>
        <button
          className={`${styles.stopBtn} ${styles.pause}`}
          disabled={busy || !connected}
          onClick={() => run('일시정지', () => armPause(controlHeaders()))}
        >
          일시정지
        </button>
        <button
          className={`${styles.stopBtn} ${styles.estop}`}
          disabled={busy}
          onClick={() => run('긴급정지', () => armEstop(controlHeaders()))}
        >
          긴급정지
        </button>
      </div>

      {!connected ? (
        <div className={styles.disabledNote}>
          팔이 연결되지 않았습니다. 장치등록에서 팔 주소를 지정하고 연결하면 상태가 표시됩니다.
        </div>
      ) : (
        <>
          {/* 관절각 */}
          <div className={styles.label}>관절각 (1Hz)</div>
          <div className={styles.joints}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={styles.joint}>
                <span className={styles.jn}>J{i + 1}</span>
                <span className={styles.jv}>
                  {joints[i] != null ? `${joints[i].toFixed(1)}°` : '—'}
                </span>
              </div>
            ))}
          </div>

          {/* 텔레메트리 */}
          <div className={styles.telem}>
            <div className={styles.tm}>
              <div className={styles.k}>최고 관절 온도</div>
              <div className={`${styles.v} ${maxTemp != null && maxTemp >= 55 ? styles.warn : ''}`}>
                {maxTemp != null ? `${maxTemp.toFixed(0)}°C` : '—'}
                {maxTempJoint != null ? ` · J${maxTempJoint}` : ''}
              </div>
            </div>
            <div className={styles.tm}>
              <div className={styles.k}>에러</div>
              <div className={styles.v}>{String(status?.connected && status.arm_err) || '0'}</div>
            </div>
          </div>
        </>
      )}

      {/* 프리셋 (검증된 것만 이동 가능) */}
      <div className={styles.label}>프리셋 자세 — 검증된 자세만</div>
      <div className={styles.presets}>
        {presets.map((p) => (
          <button
            key={p.key}
            className={styles.preset}
            disabled={busy || disabled || !connected || !p.verified}
            title={p.verified ? p.note : `${p.note} (미검증 — 실측 후 사용)`}
            onClick={() => run(`프리셋 ${p.label}`, () => armMovePreset(p.key, controlHeaders()))}
          >
            {p.label}
            {!p.verified && <span className={styles.unv}>미검증</span>}
          </button>
        ))}
      </div>

      <div className={`${styles.msg} ${msg.err ? styles.msgErr : ''}`}>{msg.text}</div>
    </div>
  );
}
