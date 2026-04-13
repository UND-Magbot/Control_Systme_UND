'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch } from '@/app/lib/api';

const RECORDING_POLL_INTERVAL = 2000;

type ActiveSession = {
  robot_id: number;
  module_id: number;
  record_type: 'auto' | 'manual';
  group_id: string;
  started_at: string;
};

type UseRecordingReturn = {
  isRecording: boolean;
  recordType: 'auto' | 'manual' | null;
  isNavigating: boolean;
  isPending: boolean;
  toggleRecording: (moduleId: number) => void;
};

export function useRecording(isOpen: boolean, robotId?: number): UseRecordingReturn {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 폴링: 녹화 활성 세션 조회
  useEffect(() => {
    if (!isOpen || !robotId) {
      setSessions([]);
      setIsNavigating(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        const res = await apiFetch(`/api/recordings/active?robot_id=${robotId}`);
        if (!res.ok) return;
        const data = await res.json();
        setSessions(data.sessions || []);
        setIsNavigating(data.is_navigating ?? false);
      } catch {
        // 무시
      }
    };

    poll();
    pollRef.current = setInterval(poll, RECORDING_POLL_INTERVAL);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isOpen, robotId]);

  const isRecording = sessions.length > 0;
  const recordType = sessions.length > 0 ? sessions[0].record_type : null;

  const toggleRecording = useCallback(
    async (moduleId: number) => {
      if (!robotId || isPending) return;
      setIsPending(true);
      try {
        if (isRecording && recordType === 'manual') {
          await apiFetch('/api/recordings/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ robot_id: robotId, module_id: moduleId }),
          });
        } else if (!isRecording && !isNavigating) {
          await apiFetch('/api/recordings/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ robot_id: robotId, module_id: moduleId }),
          });
        }
      } catch {
        // 무시
      } finally {
        setIsPending(false);
      }
    },
    [robotId, isPending, isRecording, recordType, isNavigating],
  );

  return { isRecording, recordType, isNavigating, isPending, toggleRecording };
}
