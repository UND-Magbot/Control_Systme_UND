import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";

// 대시보드 자동문 통과 오버레이 상태.
// 백엔드 GET /door/op/state 를 폴링한다. 통과 중이 아니면 null(오버레이 숨김) —
// 개폐 드라이버가 없어도 화면이 정상 동작하도록 엘리베이터와 같은 규약을 쓴다.
export type DoorOpState = {
  robotId: number;
  phase: string | null;          // APPROACH | REQUEST | OPEN_WAIT | PASS | VERIFY | FALLBACK
  phases: string[];              // 백엔드가 주는 단계 순서(칩 렌더용)
  doorId: number | null;
  doorName: string | null;
  reverse: boolean;              // 바깥 → 안쪽 방향 통과
  assumedOpen: boolean;          // 열림을 확인하지 못하고 가정 진입한 상태
  fallback: boolean;
  elapsedSec: number;
  message: string | null;
};

const POLL_MS = 2000;

function parse(robotId: number, d: any): DoorOpState | null {
  if (!d?.active) return null;
  return {
    robotId,
    phase: d.phase ?? null,
    phases: Array.isArray(d.phases) ? d.phases : [],
    doorId: d.door_id ?? null,
    doorName: d.door_name ?? null,
    reverse: !!d.reverse,
    assumedOpen: !!d.assumed_open,
    fallback: !!d.fallback,
    elapsedSec: Number(d.elapsed_sec ?? 0),
    message: d.message ?? null,
  };
}

export function useDoorOpState(robotId: number | null | undefined) {
  const [state, setState] = useState<DoorOpState | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  const poll = useCallback(async () => {
    if (robotId == null) return;
    try {
      const res = await apiFetch(`/door/op/state?robot_id=${robotId}`);
      if (!res.ok) {
        if (!cancelled.current) setState(null);
        return;
      }
      const d = await res.json();
      if (!cancelled.current) setState(parse(robotId, d));
    } catch {
      if (!cancelled.current) setState(null);
    }
  }, [robotId]);

  useEffect(() => {
    if (robotId == null) {
      setState(null);
      return;
    }
    cancelled.current = false;
    poll();
    timer.current = setInterval(poll, POLL_MS);
    return () => {
      cancelled.current = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [robotId, poll]);

  // 개입 직후 다음 폴링을 기다리지 않고 즉시 반영하기 위한 수동 갱신
  return { state, refresh: poll };
}
