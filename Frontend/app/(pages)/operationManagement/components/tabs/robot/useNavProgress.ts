'use client';

/**
 * 주행 경유지 진행 상태 (`GET /nav/progress`).
 *
 * 백엔드의 `current_wp_index`·`waypoints_list` 는 **모듈 전역 1칸**이라 로봇을 구분하지 않는다.
 * 그래서 응답의 robotName 이 지금 열어 본 로봇일 때만 값을 돌려준다 —
 * 다로봇 런타임이 들어오면 이 가드가 robot_id 파라미터로 바뀐다(T-11).
 *
 * 상태 매핑(completed/current/pending/error)은 서버가 한다. 여기서 다시 계산하지 않는다.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/app/lib/api';
import type { WaypointStep } from './WaypointProgress';

export type NavProgress = {
  robotName: string | null;
  isNavigating: boolean;
  currentIndex: number;
  total: number;
  waypoints: WaypointStep[];
  loop: { count: number; total: number; infinite: boolean };
  error: { index: number; message: string } | null;
};

const POLL_MS = 5000;

export function useNavProgress(robotName: string | null | undefined, enabled: boolean) {
  const [progress, setProgress] = useState<NavProgress | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/nav/progress`);
      setProgress(res.ok ? await res.json() : null);
    } catch {
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) { setProgress(null); return; }
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, load]);

  // 다른 로봇의 주행이면 이 화면에 그리지 않는다
  const mine = !!progress && !!robotName && progress.robotName === robotName;
  return mine ? progress : null;
}
