"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./PathStopOptionsModal.module.css";

type Props = {
  isOpen: boolean;
  placeName: string;
  initialWaitSeconds: number;
  onCancel: () => void;
  onConfirm: (waitSeconds: number) => void;
};

const MIN_WAIT = 0;
const MAX_WAIT = 600;

export default function PathStopOptionsModal({
  isOpen,
  placeName,
  initialWaitSeconds,
  onCancel,
  onConfirm,
}: Props) {
  const [waitInput, setWaitInput] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);

  // 부모(RemoteModal 등)가 폴링으로 자주 리렌더되면 인라인 onCancel 참조가 매번 새로 만들어진다.
  // 이를 deps에 두면 effect 가 재실행되어 setWaitInput 이 사용자 입력값을 초기값으로 덮어쓰는 버그가 발생.
  // → ref 로 최신 onCancel 을 참조하고 deps 에서 제외.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!isOpen) return;
    setWaitInput(String(initialWaitSeconds ?? 0));
    setError(null);

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [isOpen, initialWaitSeconds]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const parsed = Number(waitInput);
    if (!Number.isFinite(parsed) || parsed < MIN_WAIT || parsed > MAX_WAIT) {
      setError(`0 이상 ${MAX_WAIT} 이하의 숫자를 입력해 주세요.`);
      return;
    }
    onConfirm(Math.floor(parsed));
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onCancel} aria-label="close">
          ✕
        </button>

        <div className={styles.title}>정지 옵션 설정</div>
        <div className={styles.subtitle}>{placeName}</div>

        <div className={styles.formRow}>
          <label className={styles.label}>대기 시간</label>
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              type="number"
              min={MIN_WAIT}
              max={MAX_WAIT}
              step={1}
              value={waitInput}
              onChange={(e) => {
                setWaitInput(e.target.value);
                if (error) setError(null);
              }}
            />
            <span className={styles.unit}>초</span>
          </div>
        </div>
        <div className={styles.help}>
          도착 후 다음 장소로 이동하기 전 정지할 시간 (0 ~ {MAX_WAIT}초)
        </div>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          <button className={`${styles.btn} ${styles.btnRed}`} onClick={onCancel}>
            <img src="/icon/close_btn.png" alt="" />
            취소
          </button>
          <button className={`${styles.btn} ${styles.btnBlue}`} onClick={handleConfirm}>
            <img src="/icon/check.png" alt="" />
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
