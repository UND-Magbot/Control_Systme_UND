'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch } from '@/app/lib/api';

const NAV_POLL_INTERVAL = 2000;

type UseWorkAutomationOptions = {
  onAlert?: (message: string) => void;
};

export function useWorkAutomation(isOpen: boolean, options: UseWorkAutomationOptions = {}) {
  const { onAlert } = options;
  const [isWorking, setIsWorking] = useState(false);
  const [loopCount, setLoopCount] = useState<number | string>(10);
  const [isPending, setIsPending] = useState(false);

  const navPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailRef = useRef(0);

  // 모달 열려있는 동안 항상 폴링 → 실시간 상태 반영
  const wasWorkingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      if (navPollRef.current) {
        clearInterval(navPollRef.current);
        navPollRef.current = null;
      }
      wasWorkingRef.current = false;
      return;
    }

    const poll = async () => {
      try {
        const res = await apiFetch('/robot/nav');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        consecutiveFailRef.current = 0;

        if (data.is_navigating) {
          setIsWorking(true);
          wasWorkingRef.current = true;
        } else {
          // 작업 중이었다가 완료된 경우만 알림
          if (wasWorkingRef.current) {
            onAlert?.('작업이 완료되었습니다.');
            wasWorkingRef.current = false;
          }
          setIsWorking(false);
        }
      } catch {
        consecutiveFailRef.current += 1;
        if (consecutiveFailRef.current >= 3 && wasWorkingRef.current) {
          onAlert?.('작업 중 연결이 끊어졌습니다.\n로봇이 계속 이동 중일 수 있습니다.');
        }
      }
    };

    poll(); // 즉시 1회 조회
    navPollRef.current = setInterval(poll, NAV_POLL_INTERVAL);

    return () => {
      if (navPollRef.current) clearInterval(navPollRef.current);
    };
  }, [isOpen, onAlert]);

  useEffect(() => {
    if (!isOpen && navPollRef.current) {
      clearInterval(navPollRef.current);
      navPollRef.current = null;
    }
  }, [isOpen]);

  const startWork = useCallback(
    async (loop: number) => {
      if (isPending) return;
      setIsPending(true);
      try {
        const res = await apiFetch(`/nav/startmove?loop=${loop}`, { method: 'POST' });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        setIsWorking(true);
      } catch (err) {
        const detail = err instanceof Error ? err.message : '';
        onAlert?.(`작업 시작에 실패했습니다.\n${detail ? detail + '\n' : ''}연결 상태를 확인해주세요.`);
      } finally {
        setIsPending(false);
      }
    },
    [isPending, onAlert],
  );

  const stopWork = useCallback(async () => {
    if (isPending) return;
    setIsPending(true);
    try {
      await apiFetch('/nav/stopmove', { method: 'POST' });
      wasWorkingRef.current = false;  // 폴링에서 "완료" 알림 방지
      setIsWorking(false);
      onAlert?.('작업이 중지되었습니다.');
    } catch {
      onAlert?.('작업 중지에 실패했습니다.\n연결 상태를 확인해주세요.');
    } finally {
      setIsPending(false);
    }
  }, [isPending, onAlert]);

  const handleLoopCountChange = useCallback((value: string) => {
    setLoopCount(value === '' ? '' : parseInt(value) || '');
  }, []);

  const handleLoopCountBlur = useCallback(() => {
    if (loopCount === '' || Number(loopCount) < 1) setLoopCount(1);
    if (Number(loopCount) > 999) setLoopCount(999);
  }, [loopCount]);

  return {
    isWorking,
    loopCount,
    isPending,
    startWork,
    stopWork,
    handleLoopCountChange,
    handleLoopCountBlur,
  };
}
