"use client";

import { useState } from "react";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/context/AuthContext";
import AlertModal from "@/app/components/modal/AlertModal";
import { useModalAlert } from "@/app/hooks/useModalAlert";
import TransitionOverlay, { type TransitionAction, type TransitionStep } from "./TransitionOverlay";
import DoorSkipReasonModal from "./DoorSkipReasonModal";
import type { DoorOpState } from "./useDoorOpState";

// 자동문 통과 FSM 단계(navigation/door_fsm.py DISPLAY_PHASES 와 같은 순서).
// 백엔드가 phases 를 함께 주므로 이 표는 라벨 사전으로만 쓴다.
const LABELS: Record<string, string> = {
  APPROACH: "접근",
  REQUEST: "열림 요청",
  OPEN_WAIT: "열림 대기",
  PASS: "통과",
  VERIFY: "확인",
};
const FALLBACK_ORDER = ["APPROACH", "REQUEST", "OPEN_WAIT", "PASS", "VERIFY"];

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type Props = {
  state: DoorOpState;
  robotName?: string;
  /** 개입 후 상태 즉시 갱신 */
  onChanged?: () => void;
};

export default function DoorOpOverlay({ state, robotName, onChanged }: Props) {
  const { user } = useAuth();
  const { modal, modalAlert, closeModal, handleConfirm } = useModalAlert();
  const [skipOpen, setSkipOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 권한 = 위험도. 멈춤·무해 재시도는 전 레벨, 로봇을 움직이는 개입은 Manager(2) 이상.
  const isManager = user != null && (user.role === 1 || user.role === 2);

  const keys = state.phases.length ? state.phases : FALLBACK_ORDER;
  const steps: TransitionStep[] = keys.map((k) => ({ key: k, label: LABELS[k] ?? k }));

  const call = async (path: string, body: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/door/op/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ robot_id: state.robotId, ...body }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        modalAlert(d?.detail ?? "요청이 실패했습니다.");
        return;
      }
      onChanged?.();
    } catch {
      modalAlert("요청이 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  // 권한 없는 버튼은 비활성이 아니라 미표시(탭 필터와 같은 관례).
  const actions: TransitionAction[] = [
    { key: "abort", label: "통과 중단", onClick: () => call("abort") },
    { key: "retry", label: "열림 재요청", onClick: () => call("retry-open") },
  ];
  if (isManager) {
    actions.push({ key: "confirm", label: "수동 열림 확인", onClick: () => call("confirm-passed") });
    actions.push({ key: "skip", label: "통과 스킵", onClick: () => setSkipOpen(true) });
  }

  const target = `${state.doorName ?? "자동문"}${state.reverse ? " · 역방향" : ""}`;

  return (
    <>
      <TransitionOverlay
        title={`자동문 통과${robotName ? ` — ${robotName}` : ""}`}
        steps={steps}
        currentKey={state.phase}
        targetLabel={target}
        elapsedText={formatElapsed(state.elapsedSec)}
        fallback={state.fallback}
        fallbackTitle="자동문 통과 실패 — 조작자 개입 필요"
        message={state.message}
        frozenNote={state.assumedOpen ? "열림 미확인 · 가정 진입" : null}
        actions={state.fallback ? actions : undefined}
      />

      <DoorSkipReasonModal
        open={skipOpen}
        doorName={state.doorName ?? "자동문"}
        onCancel={() => setSkipOpen(false)}
        onSubmit={(reason) => {
          setSkipOpen(false);
          call("skip", { reason });
        }}
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
