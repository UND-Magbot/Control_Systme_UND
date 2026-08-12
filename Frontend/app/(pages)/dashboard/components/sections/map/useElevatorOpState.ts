import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";

// 대시보드 엘리베이터 조작 오버레이 상태.
// 백엔드 GET /elevator/op/state 를 폴링한다. 전환 중이 아니면 null(오버레이 숨김).
export type ElevatorOpState = {
  robotId: number;
  phase: string | null;            // "WAIT_ARRIVAL" 등 FSM 단계
  targetFloorId: number | null;
  targetFloorLabel: string | null;
  startedAt: string | null;        // ISO — 경과 시간 계산용
  inTransit: boolean;              // IN_TRANSIT/MAP_SWITCH → 로봇 마커 숨김
  fallback: boolean;               // 자율 실패 → 개입 배너
  message: string | null;
};

const POLL_MS = 2000;

export function useElevatorOpState(robotId: number | null | undefined): ElevatorOpState | null {
  const [state, setState] = useState<ElevatorOpState | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (robotId == null) {
      setState(null);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await apiFetch(`/elevator/op/state?robot_id=${robotId}`);
        if (!res.ok) {
          if (!cancelled) setState(null);
          return;
        }
        const d = await res.json();
        if (cancelled) return;
        // active=false(스텁·전환 아님) → null 로 정규화해 오버레이 숨김
        setState(
          d?.active
            ? {
                robotId,
                phase: d.phase ?? null,
                targetFloorId: d.target_floor_id ?? null,
                targetFloorLabel: d.target_floor_label ?? null,
                startedAt: d.started_at ?? null,
                inTransit: !!d.in_transit,
                fallback: !!d.fallback,
                message: d.message ?? null,
              }
            : null
        );
      } catch {
        if (!cancelled) setState(null);
      }
    };

    poll();
    timer.current = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [robotId]);

  return state;
}
