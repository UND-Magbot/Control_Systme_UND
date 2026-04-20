'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import styles from './ControlPanel.module.css';

type InlineConfirmProps = {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
  className?: string;
};

/**
 * 2단계 인라인 확인 버튼
 * 첫 클릭 → "확인하시겠습니까?" (3초 내 재클릭 시 실행, 시간 초과 시 복귀)
 */
export default function InlineConfirm({
  label,
  confirmLabel = '확인하시겠습니까?',
  onConfirm,
  disabled = false,
  variant = 'default',
  className,
}: InlineConfirmProps) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setConfirming(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (confirming) {
      reset();
      onConfirm();
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(reset, 3000);
    }
  }, [disabled, confirming, onConfirm, reset]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      className={`${styles.actionBtn} ${variant === 'danger' ? styles.dangerBtn : ''} ${confirming ? styles.confirmingBtn : ''} ${className ?? ''}`}
      onClick={handleClick}
      disabled={disabled}
    >
      {confirming ? confirmLabel : label}
    </button>
  );
}
