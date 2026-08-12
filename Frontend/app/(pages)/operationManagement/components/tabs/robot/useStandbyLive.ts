'use client';

/**
 * 상시 대기 실시간 상태 (`GET /DB/standby-live`).
 *
 * 작업명 라인의 상태 칩과 아래 상세가 **같은 데이터**를 봐야 하므로 폴링을 훅으로 뺐다.
 * 컴포넌트마다 폴링하면 두 표시가 한 틱씩 어긋난다.
 *
 * 이 응답은 지금 **전역 1칸**이라 로봇을 구분하지 않는다 —
 * robotName 이 지금 열어 본 로봇일 때만 돌려준다(다로봇 시 robot_id 파라미터로 전환, T-11).
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/app/lib/api';

export type StandbySession = {
  id: number;
  heard: string | null;
  destination: string | null;
  confidence: number | null;
  elapsedSec: number;
  frozenSec: number;
  limitMin: number;
  extended: number;
  retryCount: number;
};

export type StandbyLive = {
  active: boolean;
  scheduleId?: number;
  robotName?: string;
  phaseLabel?: string;
  endsAt?: string | null;
  step?: number;
  steps?: string[];
  session?: StandbySession | null;
  todaySummary?: { total: number; completed: number };
};

const POLL_MS = 5000;

export function useStandbyLive(robotName: string | null | undefined) {
  const [live, setLive] = useState<StandbyLive | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch(`/DB/standby-live`);
      setLive(res.ok ? await res.json() : { active: false });
    } catch {
      setLive({ active: false });
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const mine = !!live?.active && !!robotName && live.robotName === robotName;
  return { live: mine ? live : null, reload };
}
