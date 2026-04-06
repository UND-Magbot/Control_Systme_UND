'use client';

import { useRef, useState, useCallback } from 'react';
import { apiFetch } from '@/app/lib/api';

export type CommandState = 'idle' | 'pending' | 'success' | 'error';

type UseRemoteCommandOptions = {
  debounceMs?: number;
  onError?: (message: string) => void;
};

export function useRemoteCommand(options: UseRemoteCommandOptions = {}) {
  const { debounceMs = 300, onError } = options;

  const [state, setState] = useState<CommandState>('idle');
  const pendingRef = useRef<Set<string>>(new Set());
  const lastCallRef = useRef<Record<string, number>>({});

  const execute = useCallback(
    async (path: string, label?: string): Promise<boolean> => {
      const now = Date.now();
      const lastCall = lastCallRef.current[path] ?? 0;
      if (now - lastCall < debounceMs) return false;
      if (pendingRef.current.has(path)) return false;

      lastCallRef.current[path] = now;
      pendingRef.current.add(path);
      setState('pending');

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const res = await apiFetch(path, {
          method: 'POST',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

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
    [debounceMs, onError],
  );

  return { execute, state };
}
