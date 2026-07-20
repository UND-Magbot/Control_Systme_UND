'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/app/lib/api';

/**
 * 로봇 제어권 — 한 로봇은 동시에 한 세션만 조작한다.
 *
 * 기본 상태는 **관찰**이다. 화면을 열었다는 이유만으로 로봇을 쥐지 않는다.
 * 조작하려면 명시적으로 `start()` 를 호출해 제어권을 얻는다.
 * (설계: 06_Planning/PM-Remote-Intervention-Concept.md §6.3, ARCH §4)
 */

export type ControlOwner = {
  ownerType: 'user' | 'system';
  ownerId: string;
  ownerLabel: string;
  expiresIn: number;
};

export type ControlPhase =
  | 'observing'   // 제어권 없음 (기본)
  | 'starting'    // 획득 시도 중
  | 'controlling' // 내가 쥐고 있음
  | 'lost';       // 쥐고 있다가 잃음 (만료·회수)

type Options = {
  robotId: number | null;
  enabled: boolean;
  /** 제어권을 잃었을 때 사용자에게 알릴 콜백 */
  onLost?: (reason: string) => void;
};

const OWNER_POLL_MS = 5000;

export function useControlLock({ robotId, enabled, onLost }: Options) {
  const [phase, setPhase] = useState<ControlPhase>('observing');
  const [owner, setOwner] = useState<ControlOwner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onLostRef = useRef(onLost);
  onLostRef.current = onLost;

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  /** 조작 명령에 실어 보낼 헤더. 제어권이 없으면 빈 객체 — 서버가 409로 막는다. */
  const controlHeaders = useCallback((): Record<string, string> => {
    return tokenRef.current ? { 'X-Control-Token': tokenRef.current } : {};
  }, []);

  /** 누가 쥐고 있는지 조회 (관찰 모드 표시용) */
  const refreshOwner = useCallback(async () => {
    if (robotId == null) return;
    try {
      const res = await apiFetch(`/robot/${robotId}/control`);
      if (!res.ok) return;
      const body = await res.json();
      setOwner(body.controlled ? body.owner : null);
    } catch {
      /* 조회 실패는 조용히 넘긴다 — 조작을 막는 정보가 아니다 */
    }
  }, [robotId]);

  const start = useCallback(async (): Promise<boolean> => {
    if (robotId == null) return false;
    setPhase('starting');
    setError(null);
    try {
      const res = await apiFetch(`/robot/${robotId}/control/acquire`, { method: 'POST' });
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        const detail = body?.detail;
        setOwner(detail?.owner ?? null);
        setError(detail?.message ?? '다른 세션이 제어 중입니다');
        setPhase('observing');
        return false;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.json();
      tokenRef.current = body.token;
      setOwner(body.owner ?? null);
      setPhase('controlling');
      return true;
    } catch {
      setError('제어를 시작하지 못했습니다');
      setPhase('observing');
      return false;
    }
  }, [robotId]);

  const stop = useCallback(async () => {
    stopHeartbeat();
    const token = tokenRef.current;
    tokenRef.current = null;
    setPhase('observing');
    if (robotId == null || !token) return;
    try {
      await apiFetch(`/robot/${robotId}/control/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch {
      /* 반환 실패해도 서버가 TTL 로 회수한다 */
    }
    refreshOwner();
  }, [robotId, stopHeartbeat, refreshOwner]);

  // 제어 중에는 heartbeat 로 살아있음을 알린다. 끊기면 서버가 TTL 후 자동 해제한다.
  useEffect(() => {
    if (phase !== 'controlling' || robotId == null) return;

    const beat = async () => {
      const token = tokenRef.current;
      if (!token) return;
      try {
        const res = await apiFetch(`/robot/${robotId}/control/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (res.status === 409) {
          // 만료됐거나 관리자가 회수했다
          tokenRef.current = null;
          stopHeartbeat();
          setPhase('lost');
          setError('제어권이 해제되었습니다');
          onLostRef.current?.('제어권이 해제되었습니다');
          refreshOwner();
        }
      } catch {
        /* 일시적 네트워크 실패는 다음 주기에 다시 시도 */
      }
    };

    heartbeatRef.current = setInterval(beat, 5000);
    return stopHeartbeat;
  }, [phase, robotId, stopHeartbeat, refreshOwner]);

  // 관찰 중에는 소유자만 주기적으로 확인한다 (제어 중에는 heartbeat 가 대신한다)
  useEffect(() => {
    if (!enabled || robotId == null || phase === 'controlling') return;
    refreshOwner();
    const id = setInterval(refreshOwner, OWNER_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, robotId, phase, refreshOwner]);

  // 화면을 벗어나면 제어권을 돌려준다. 유령 점유를 남기지 않는다.
  useEffect(() => {
    if (enabled) return;
    if (tokenRef.current) void stop();
    else setPhase('observing');
  }, [enabled, stop]);

  useEffect(() => {
    return () => {
      const token = tokenRef.current;
      if (!token || robotId == null) return;
      // 언마운트 시에는 응답을 기다릴 수 없다 — 실패해도 서버 TTL 이 회수한다
      void apiFetch(`/robot/${robotId}/control/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    };
  }, [robotId]);

  return {
    phase,
    owner,
    error,
    isControlling: phase === 'controlling',
    /** 남이 쥐고 있어서 내가 못 잡는 상태인지 */
    heldByOther: phase !== 'controlling' && owner != null,
    start,
    stop,
    controlHeaders,
    refreshOwner,
  };
}
