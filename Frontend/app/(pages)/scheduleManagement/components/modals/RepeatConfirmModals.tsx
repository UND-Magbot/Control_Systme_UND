'use client';

import React, { useEffect, useMemo, useState } from "react";
import styles from "./RepeatConfirmModals.module.css";

export type RepeatConfirmMode = "edit" | "delete";
export type RepeatConfirmScope = "this" | "thisAndFuture" | "all";

type RepeatConfirmModalProps = {
  isOpen: boolean;
  mode: RepeatConfirmMode;                // "edit" | "delete"
  defaultScope?: RepeatConfirmScope;      // 기본 선택값 (이미지: 삭제=첫번째, 수정=두번째)
  onClose: () => void;                    // X 버튼 / overlay 클릭 / ESC
  onCancel: () => void;                   // 하단 "취소"
  onConfirm: (scope: RepeatConfirmScope) => void; // 하단 "확인"
};

export default function RepeatConfirmModal({
  isOpen,
  mode,
  defaultScope,
  onClose,
  onCancel,
  onConfirm,
}: RepeatConfirmModalProps) {
  const title = useMemo(() => {
    return mode === "delete"
      ? "반복 설정된 작업 일정을 삭제하시겠습니까?"
      : "반복 설정된 작업 일정을 수정하시겠습니까?";
  }, [mode]);

  const options = useMemo(() => {
    if (mode === "delete") {
      return [
        { value: "this" as const, label: "현재 작업 일정만 삭제" },
        { value: "thisAndFuture" as const, label: "현재 작업 및 이후 작업일정 삭제" },
        { value: "all" as const, label: "전체 작업일정 삭제" },
      ];
    }
    return [
      { value: "this" as const, label: "현재 작업 일정만 수정" },
      { value: "thisAndFuture" as const, label: "현재 작업 및 이후 작업일정 수정" },
      { value: "all" as const, label: "전체 작업일정 수정" },
    ];
  }, [mode]);

  const initial = defaultScope ?? (mode === "edit" ? "thisAndFuture" : "this");
  const [scope, setScope] = useState<RepeatConfirmScope>(initial);

  // 열릴 때마다 기본값으로 리셋
  useEffect(() => {
    if (!isOpen) return;
    setScope(initial);
  }, [isOpen, initial]);

  // ESC 닫기 + body 스크롤 잠금
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.repeatOverlay} onClick={onClose}>
      <div className={styles.repeatModal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.repeatCloseBtn} onClick={onClose} aria-label="close">
          ✕
        </button>

        <div className={styles.repeatHeader}>
          <img src="/icon/robot_schedule_w.png" alt="" />
          <h2>반복 작업</h2>
        </div>
        <div className={styles.repeatTitle}>{title}</div>

        <div className={styles.repeatOptionBox} role="radiogroup" aria-label="repeat-scope">
          {options.map((opt) => {
            const active = scope === opt.value;

            return (
              <div
                key={opt.value}
                className={`${styles.repeatOptionRow} ${active ? styles.active : ""}`}
                role="radio"
                aria-checked={active}
                tabIndex={0}
                onClick={() => setScope(opt.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setScope(opt.value);
                }}
              >
                <span className={styles.repeatRadio}>
                  <span className={`${styles.repeatRadioDot} ${active ? styles.on : ""}`} />
                </span>
                <span className={styles.repeatOptionLabel}>{opt.label}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.repeatBtnRow}>
          <button
            type="button"
            className={`${styles.repeatBtn} ${styles.repeatBtnRed}`}
            onClick={onCancel}
          >
            <img src="/icon/close_btn.png" alt="cancel" />
            <span>취소</span>
          </button>

          <button
            type="button"
            className={`${styles.repeatBtn} ${styles.repeatBtnBlue}`}
            onClick={() => onConfirm(scope)}
          >
            <img src="/icon/check.png" alt="ok" />
            <span>확인</span>
          </button>
        </div>
      </div>
    </div>
  );
}