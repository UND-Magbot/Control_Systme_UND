'use client';

import { useRef, useState, useCallback } from 'react';
import { apiFetch } from '@/app/lib/api';
import { scopeRobotPath, useRemoteSession } from '../RemoteSessionContext';

export type CommandState = 'idle' | 'pending' | 'success' | 'error';

type UseRemoteCommandOptions = {
  /** 명령을 보낼 대상 로봇. 주면 `/robot/up` → `/robot/{id}/up` 로 바꿔 보낸다. */
  robotId?: number | null;
  debounceMs?: number;
  onError?: (message: string) => void;
  /** 명령마다 실어 보낼 헤더 (제어권 토큰). 호출 시점에 평가한다. */
  headers?: () => Record<string, string>;
  /** 제어권이 없어 서버가 409로 막았을 때 */
  onDenied?: (message: string) => void;
};

export function useRemoteCommand(options: UseRemoteCommandOptions = {}) {
  const session = useRemoteSession();
  const {
    robotId = session.robotId,
    debounceMs = 300,
    onError,
    headers = session.controlHeaders,
    onDenied,
  } = options;

  /**
   * 호출부는 `/robot/up` 같은 경로를 그대로 쓰고, 여기서 대상 로봇을 끼워 넣는다.
   * 대상이 없으면 레거시 경로로 나가고 서버가 캐시된 로봇으로 폴백한다.
   */
  const scoped = useCallback((path: string) => scopeRobotPath(path, robotId ?? null), [robotId]);

  const [state, setState] = useState<CommandState>('idle');
  const pendingRef = useRef<Set<string>>(new Set());
  const lastCallRef = useRef<Record<string, number>>({});

  const execute = useCallback(
    async (path: string, label?: string, timeoutMs = 5000): Promise<boolean> => {
      const now = Date.now();
      const lastCall = lastCallRef.current[path] ?? 0;
      if (now - lastCall < debounceMs) return false;
      if (pendingRef.current.has(path)) return false;

      lastCallRef.current[path] = now;
      pendingRef.current.add(path);
      setState('pending');

      try {
        const controller = new AbortController();
        // 명령별 타임아웃(기본 5s). 언도킹처럼 로봇 동작 시퀀스가 긴 명령은 길게 넘긴다.
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const res = await apiFetch(scoped(path), {
          method: 'POST',
          signal: controller.signal,
          headers: headers?.() ?? undefined,
        });

        clearTimeout(timeoutId);

        // 409 = 제어권 없음/뺏김. 통신 오류와 구분해서 알린다.
        if (res.status === 409) {
          const body = await res.json().catch(() => null);
          const message = body?.detail?.message ?? '제어권이 없습니다';
          setState('error');
          setTimeout(() => setState('idle'), 1000);
          onDenied?.(message);
          return false;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        setState('success');
        setTimeout(() => setState('idle'), 200);
        return true;
      } catch (err) {
        setState('error');
        const msg = label || '명령';

        if (err instanceof DOMException && err.name === 'AbortError') {
          onError?.(`${msg} 실패 - 응답 시간이 초과되었습니다.`);
        } else {
          onError?.(`${msg} 실패 - 연결 상태를 확인해주세요.`);
        }

        setTimeout(() => setState('idle'), 1000);
        return false;
      } finally {
        pendingRef.current.delete(path);
      }
    },
    [scoped, debounceMs, onError, headers, onDenied],
  );

  return { execute, state };
}
