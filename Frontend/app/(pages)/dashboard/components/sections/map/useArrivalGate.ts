import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";

// 경유지 도착 확인 게이트 상태 (GET /nav/arrival-gate).
// 자동문·엘리베이터 오버레이와 같은 규약 — 대기 중이 아니면 null(오버레이 숨김).
//
// 이 조회가 없어서 confirm='button'/'voice' 는 **설정만 가능하고 실제로는 아무도 확인할 수 없어**
// 600초 하드캡 뒤 작업이 중단되는 옵션이었다(M-05·M-06).
export type ArrivalGateState = {
  robotId: number | null;
  robotName: string | null;
  confirmMode: "button" | "voice" | null;
  wpName: string | null;
  announceText: string | null;
  waitedSec: number;
  maxWaitSec: number;
  remainingSec: number;
  /** 이 시간을 넘기면 onTimeout 설정과 무관하게 작업이 중단된다 */
  hardCapRemainingSec: number;
};

const POLL_MS = 2000;

function parse(d: any): ArrivalGateState | null {
  if (!d?.active) return null;
  return {
    robotId: d.robotId ?? null,
    robotName: d.robotName ?? null,
    confirmMode: d.confirmMode ?? null,
    wpName: d.wpName ?? null,
    announceText: d.announceText ?? null,
    waitedSec: Number(d.waitedSec ?? 0),
    maxWaitSec: Number(d.maxWaitSec ?? 0),
    remainingSec: Number(d.remainingSec ?? 0),
    hardCapRemainingSec: Number(d.hardCapRemainingSec ?? 0),
  };
}

export function useArrivalGate() {
  const [state, setState] = useState<ArrivalGateState | null>(null);
  const cancelled = useRef(false);

  const poll = useCallback(async () => {
    try {
      const res = await apiFetch(`/nav/arrival-gate`);
      const data = res.ok ? await res.json() : null;
      if (!cancelled.current) setState(parse(data));
    } catch {
      if (!cancelled.current) setState(null);
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(t);
    };
  }, [poll]);

  return { state, refresh: poll };
}
