'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '@/app/lib/api';

const NAV_POLL_INTERVAL = 2000;

type PathOption = {
  id: number;
  wayName: string;
  wayPoints: string;
  taskType: string;
  floorId: number | null;
};

type UseWorkAutomationOptions = {
  onAlert?: (message: string) => void;
  /** 로봇이 현재 위치한 층 id. 경로 목록을 이 층에 속한 것만 보여주기 위해 사용. */
  currentFloorId?: number | null;
};

export function useWorkAutomation(isOpen: boolean, options: UseWorkAutomationOptions = {}) {
  const { onAlert, currentFloorId } = options;
  const [isWorking, setIsWorking] = useState(false);
  const [loopCount, setLoopCount] = useState<number | string>(10);
  const [isPending, setIsPending] = useState(false);
  const [loopCurrent, setLoopCurrent] = useState(0);
  const [loopTotal, setLoopTotal] = useState(0);

  // 경로 목록 & 작업 유형 필터
  const [paths, setPaths] = useState<PathOption[]>([]);
  const [selectedPath, setSelectedPath] = useState<PathOption | null>(null);
  const [taskTypeFilter, setTaskTypeFilter] = useState<string | null>(null);

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
        taskType: p.TaskType || '',
        floorId: p.FloorId ?? null,
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
          const total = Number(data.loop_total) || 0;
          const remaining = Number(data.loop_remaining) || 0;
          setLoopTotal(total);
          setLoopCurrent(total > 0 ? Math.max(1, total - remaining) : 0);
        } else {
          if (wasWorkingRef.current) {
            onAlert?.('작업이 완료되었습니다.');
            wasWorkingRef.current = false;
          }
          setIsWorking(false);
          setLoopTotal(0);
          setLoopCurrent(0);
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

  // 필터된 경로 목록 — 로봇 현재 층 + 작업 유형 모두 일치하는 경로만.
  // currentFloorId 가 undefined(전달 안 됨)면 층 필터 미적용 (호환성).
  // null(로봇 위치 불명)이면 모두 제외 — "현재 층의 경로만" 요구사항 엄격 적용.
  const filteredPaths = useMemo(() => {
    return paths.filter((p) => {
      if (currentFloorId !== undefined) {
        if (currentFloorId === null || p.floorId !== currentFloorId) return false;
      }
      if (taskTypeFilter && p.taskType !== taskTypeFilter) return false;
      return true;
    });
  }, [paths, taskTypeFilter, currentFloorId]);

  // 필터가 바뀌어 선택된 경로가 더 이상 포함되지 않으면 선택 해제
  useEffect(() => {
    if (!selectedPath) return;
    if (taskTypeFilter && selectedPath.taskType !== taskTypeFilter) {
      setSelectedPath(null);
    }
  }, [taskTypeFilter, selectedPath]);

  // 반대 방향: 경로를 먼저 선택했는데 필터가 비어 있으면 경로의 taskType으로 자동 채움.
  // 의존성은 selectedPath만 — 사용자가 이후에 필터를 "전체"로 비워도 재실행되지 않음.
  useEffect(() => {
    if (!selectedPath || !selectedPath.taskType) return;
    setTaskTypeFilter((prev) => prev ?? selectedPath.taskType);
  }, [selectedPath]);

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
    loopCurrent,
    loopTotal,
    isPending,
    startWork,
    stopWork,
    handleLoopCountChange,
    handleLoopCountBlur,
    // 경로 선택
    paths: filteredPaths,
    selectedPath,
    setSelectedPath,
    // 작업 유형 필터
    taskTypeFilter,
    setTaskTypeFilter,
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
