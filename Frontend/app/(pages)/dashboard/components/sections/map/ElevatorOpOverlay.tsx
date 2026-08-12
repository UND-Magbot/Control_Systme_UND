"use client";

import TransitionOverlay, { type TransitionStep } from "./TransitionOverlay";
import type { ElevatorOpState } from "./useElevatorOpState";

// FSM 단계 순서(UI 표시용). 백엔드 phase 문자열과 key 로 매칭한다.
// 설계: PRD-Multi-Floor-Auto-Map-Switching §4 (Elevator Operation FSM).
const PHASES: TransitionStep[] = [
  { key: "IDLE", label: "IDLE" },
  { key: "APPROACH_PANEL", label: "APPROACH" },
  { key: "PRESS_CALL", label: "PRESS_CALL" },
  { key: "WAIT_ARRIVAL", label: "WAIT_ARRIVAL" },
  { key: "BOARD", label: "BOARD" },
  { key: "PRESS_FLOOR", label: "PRESS_FLOOR" },
  { key: "IN_TRANSIT", label: "IN_TRANSIT" },
  { key: "ARRIVED", label: "ARRIVED" },
  { key: "DISEMBARK", label: "DISEMBARK" },
  { key: "MAP_SWITCH", label: "MAP_SWITCH" },
  { key: "RELOCALIZE_VERIFY", label: "VERIFY" },
];

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "-";
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return "-";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

type Props = {
  state: ElevatorOpState;
  robotName?: string;
  onStopAll?: () => void;
};

export default function ElevatorOpOverlay({ state, robotName, onStopAll }: Props) {
  const targetLabel = state.targetFloorLabel ?? (state.targetFloorId != null ? `#${state.targetFloorId}` : "-");

  return (
    <TransitionOverlay
      title={`엘리베이터 전환${robotName ? ` — ${robotName}` : ""}`}
      steps={PHASES}
      currentKey={state.phase}
      targetLabel={`→ ${targetLabel}`}
      elapsedText={formatElapsed(state.startedAt)}
      fallback={state.fallback}
      fallbackTitle="엘리베이터 전환 실패 — 조작자 개입 필요"
      message={state.message}
      frozenNote={state.inTransit ? "측위 freeze · 마커 숨김" : null}
      meta={[{ label: "목적 층", value: targetLabel }]}
      actions={onStopAll ? [{ key: "stop", label: "전체 정지", onClick: onStopAll }] : undefined}
    />
  );
}
