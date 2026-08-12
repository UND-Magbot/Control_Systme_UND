"use client";

/**
 * 경유지 도착 확인 게이트 오버레이.
 *
 * 로봇이 경유지에 서서 **사람의 확인을 기다리는 중**임을 알리고, 그 자리에서 통과시킨다.
 * 이 화면이 없어서 `confirm='button'`/`'voice'` 는 설정만 가능하고 실제로는
 * 600초 하드캡 뒤 작업이 중단되는 옵션이었다(M-05·M-06).
 *
 * 음성 모드여도 확인 버튼을 띄운다 — 게이트는 채널을 가리지 않고,
 * 로봇이 못 알아들을 때 사람이 통과시킬 수 있어야 한다("사람 우선", PRD §5).
 */

import { useState } from "react";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/context/AuthContext";
import AlertModal from "@/app/components/modal/AlertModal";
import { useModalAlert } from "@/app/hooks/useModalAlert";
import TransitionOverlay, { type TransitionAction, type TransitionStep } from "./TransitionOverlay";
import type { ArrivalGateState } from "./useArrivalGate";

// 도착 상호작용의 흐름. 백엔드가 단계를 주지 않으므로(게이트는 대기 한 지점이다)
// 표시용으로만 쓴다 — 지금이 어디쯤인지 사람이 읽을 수 있으면 된다.
const STEPS: TransitionStep[] = [
  { key: "ARRIVED", label: "도착" },
  { key: "ANNOUNCE", label: "안내 발화" },
  { key: "WAIT", label: "확인 대기" },
  { key: "PROCEED", label: "다음 이동" },
];

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type Props = {
  state: ArrivalGateState;
  robotName?: string;
  onChanged?: () => void;
};

export default function ArrivalGateOverlay({ state, robotName, onChanged }: Props) {
  const { user } = useAuth();
  const { modal, modalAlert, closeModal, handleConfirm } = useModalAlert();
  const [busy, setBusy] = useState(false);

  // 확인은 로봇을 다음 지점으로 **움직이는** 개입이다 — Manager(2) 이상.
  const isManager = user != null && (user.role === 1 || user.role === 2);

  const confirm = async () => {
    if (busy || state.robotId == null) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/DB/robots/${state.robotId}/arrival-confirm`, { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        modalAlert(d?.detail ?? "확인 요청이 실패했습니다.");
        return;
      }
      // 이미 지나갔거나 확인이 필요 없는 지점이면 no_gate — 오류가 아니다
      if (d?.status === "no_gate") modalAlert("확인 대기 중인 지점이 없습니다. 이미 지나갔을 수 있습니다.");
      onChanged?.();
    } catch {
      modalAlert("확인 요청이 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const actions: TransitionAction[] = isManager
    ? [{ key: "confirm", label: busy ? "확인 중…" : "확인 — 다음으로", onClick: confirm }]
    : [];

  // 하드캡이 얼마 안 남았으면 그게 가장 중요한 정보다 — 넘기면 작업이 중단된다.
  const urgent = state.hardCapRemainingSec <= 60;

  const meta = [
    { label: "확인 방식", value: state.confirmMode === "voice" ? "음성" : "버튼" },
    { label: "이번 대기", value: `${formatElapsed(state.remainingSec)} 남음` },
    { label: "중단까지", value: formatElapsed(state.hardCapRemainingSec) },
  ];

  return (
    <>
      <TransitionOverlay
        title={`도착 확인 대기${robotName ? ` — ${robotName}` : ""}`}
        steps={STEPS}
        currentKey="WAIT"
        targetLabel={state.wpName ?? "경유지"}
        elapsedText={formatElapsed(state.waitedSec)}
        fallback={urgent}
        fallbackTitle="확인 무응답 — 곧 작업이 중단됩니다"
        message={state.announceText}
        frozenNote={state.confirmMode === "voice" ? "음성 확인 대기 중 · 버튼으로도 통과 가능" : null}
        actions={actions.length ? actions : undefined}
        meta={meta}
      />

      <AlertModal
        open={modal.open}
        message={modal.message}
        mode={modal.mode}
        onConfirm={handleConfirm}
        onClose={closeModal}
      />
    </>
  );
}
