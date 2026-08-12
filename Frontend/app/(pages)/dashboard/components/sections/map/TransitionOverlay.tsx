"use client";

import styles from "./MapSection.module.css";

// 설비 통과·전환 공용 오버레이.
// 조작자가 "엘리베이터 전환"과 "자동문 통과"를 같은 자리에서 같은 문법(단계 칩)으로 읽게 한다.
// 유형별로 다른 건 제목·단계 세트·개입 버튼뿐이다.
export type TransitionStep = { key: string; label: string };

export type TransitionAction = {
  key: string;
  label: string;
  onClick: () => void;
};

type Props = {
  title: string;
  steps: TransitionStep[];
  currentKey: string | null;
  targetLabel: string;
  elapsedText: string;
  fallback?: boolean;
  fallbackTitle?: string;
  message?: string | null;
  /** 측위 freeze 등으로 마커를 숨기는 구간임을 알림(엘리베이터 전용) */
  frozenNote?: string | null;
  actions?: TransitionAction[];
  meta?: { label: string; value: string }[];
};

export default function TransitionOverlay({
  title,
  steps,
  currentKey,
  targetLabel,
  elapsedText,
  fallback = false,
  fallbackTitle,
  message,
  frozenNote,
  actions,
  meta,
}: Props) {
  const nowIdx = steps.findIndex((s) => s.key === currentKey);

  return (
    <>
      {fallback && (
        <div className={styles.fbAlert}>
          <div className={styles.fbText}>
            <b>{fallbackTitle ?? `${title} 실패 — 조작자 개입 필요`}</b>
            {message ?? "로봇이 안전 정지했습니다."}
          </div>
          {actions?.map((a) => (
            <button key={a.key} type="button" className={styles.fbBtn} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className={`${styles.fsmOverlay} ${fallback ? styles.fsmOverlayFallback : ""}`}>
        <div className={styles.fsmTop}>
          <span className={styles.fsmTitle}>{title}</span>
          <span className={styles.fsmTarget}>{targetLabel}</span>
        </div>
        <div className={styles.fsmSteps}>
          {steps.map((s, i) => (
            <span
              key={s.key}
              className={`${styles.fsmStep} ${
                i === nowIdx ? styles.fsmStepNow : i < nowIdx ? styles.fsmStepDone : ""
              }`}
            >
              {s.label}
            </span>
          ))}
        </div>
        <div className={styles.fsmMeta}>
          {meta?.map((m) => (
            <span key={m.label}>{m.label} <b>{m.value}</b></span>
          ))}
          <span>경과 <b>{elapsedText}</b></span>
          {frozenNote && <span className={styles.fsmTransit}>{frozenNote}</span>}
        </div>
      </div>
    </>
  );
}
