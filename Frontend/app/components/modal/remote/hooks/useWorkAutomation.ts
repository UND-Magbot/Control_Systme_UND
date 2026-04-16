'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch } from '@/app/lib/api';

const NAV_POLL_INTERVAL = 2000;

type PathOption = {
  id: number;
  wayName: string;
  wayPoints: string;
};

type UseWorkAutomationOptions = {
  onAlert?: (message: string) => void;
};

export function useWorkAutomation(isOpen: boolean, options: UseWorkAutomationOptions = {}) {
  const { onAlert } = options;
  const [isWorking, setIsWorking] = useState(false);
  const [loopCount, setLoopCount] = useState<number | string>(10);
  const [isPending, setIsPending] = useState(false);

  // 경로 목록
  const [paths, setPaths] = useState<PathOption[]>([]);
  const [selectedPath, setSelectedPath] = useState<PathOption | null>(null);

  // 직접 경로 생성 모드
  type CreatedPoint = { x: number; y: number; yaw: number };
  const [isCreating, setIsCreating] = useState(false);
  const [createdPoints, setCreatedPoints] = useState<CreatedPoint[]>([]);

  const navPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailRef = useRef(0);
  const wasWorkingRef = useRef(false);

  // 경로 목록 fetch
  const fetchPaths = useCallback(async () => {
    try {
      const res = await apiFetch('/DB/paths');
      if (!res.ok) return;
      const data = await res.json();
      const list: PathOption[] = data.map((p: any) => ({
        id: p.id,
        wayName: p.WayName,
        wayPoints: p.WayPoints || '',
      }));
      setPaths(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchPaths();
  }, [isOpen, fetchPaths]);

  // 네비게이션 상태 폴링
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

    poll();
    navPollRef.current = setInterval(poll, NAV_POLL_INTERVAL);

    return () => {
      if (navPollRef.current) clearInterval(navPollRef.current);
    };
  }, [isOpen, onAlert]);

  // 경로 기반 작업 시작
  const startWork = useCallback(
    async (loop: number) => {
      if (isPending || !selectedPath) return;
      setIsPending(true);
      try {
        const res = await apiFetch(
          `/nav/startpath?way_name=${encodeURIComponent(selectedPath.wayName)}&loop=${loop}`,
          { method: 'POST' },
        );
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
    [isPending, selectedPath, onAlert],
  );

  const stopWork = useCallback(async () => {
    if (isPending) return;
    setIsPending(true);
    try {
      await apiFetch('/nav/stopmove', { method: 'POST' });
      wasWorkingRef.current = false;
      setIsWorking(false);
      onAlert?.('작업이 중지되었습니다.');
    } catch {
      onAlert?.('작업 중지에 실패했습니다.\n연결 상태를 확인해주세요.');
    } finally {
      setIsPending(false);
    }
  }, [isPending, onAlert]);

  // 직접 경로 생성
  const startCreating = useCallback(() => {
    setCreatedPoints([]);
    setIsCreating(true);
  }, []);

  const savePoint = useCallback(async () => {
    try {
      const res = await apiFetch('/nav/savepoint', { method: 'POST' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.status === 'ok') {
        setCreatedPoints((prev) => [...prev, { x: data.x, y: data.y, yaw: data.yaw }]);
      }
    } catch {
      onAlert?.('위치 저장에 실패했습니다.');
    }
  }, [onAlert]);

  const clearPoints = useCallback(() => {
    setCreatedPoints([]);
  }, []);

  const finishCreating = useCallback(async (wayName?: string) => {
    if (createdPoints.length < 2) {
      onAlert?.('최소 2개 이상의 위치를 저장해야 합니다.');
      return;
    }

    try {
      const body: any = { waypoints: createdPoints };
      if (wayName && wayName.trim()) body.way_name = wayName.trim();

      const res = await apiFetch('/nav/createpath', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.status === 'error') {
        onAlert?.(data.msg);
        return;
      }

      // 경로 목록 새로고침 후 새 경로 자동 선택
      const updatedPaths = await fetchPaths();
      if (updatedPaths && data.way_name) {
        const newPath = updatedPaths.find((p) => p.wayName === data.way_name);
        if (newPath) setSelectedPath(newPath);
      }

      setIsCreating(false);
      setCreatedPoints([]);
      onAlert?.(`경로 '${data.way_name}'이(가) 생성되었습니다.`);
    } catch {
      onAlert?.('경로 생성에 실패했습니다.');
    }
  }, [createdPoints, fetchPaths, onAlert]);

  const cancelCreating = useCallback(() => {
    setIsCreating(false);
    setCreatedPoints([]);
  }, []);

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
    // 경로 선택
    paths,
    selectedPath,
    setSelectedPath,
    // 직접 경로 생성
    isCreating,
    createdPoints,
    startCreating,
    savePoint,
    clearPoints,
    finishCreating,
    cancelCreating,
  };
}
