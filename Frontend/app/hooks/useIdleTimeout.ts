"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type IdleTimeoutConfig = {
  idleTimeoutMs: number;
  warningBeforeMs: number;
  onTimeout: () => void;
  onExtend: () => Promise<void>;
  enabled: boolean;
};

export function useIdleTimeout({
  idleTimeoutMs,
  warningBeforeMs,
  onTimeout,
  onExtend,
  enabled,
}: IdleTimeoutConfig) {
  const [isWarningVisible, setIsWarningVisible] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const warningTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const countdownRef = useRef<ReturnType<typeof setInterval>>();
  const isWarningVisibleRef = useRef(false);

  const clearAllTimers = useCallback(() => {
    clearTimeout(warningTimerRef.current);
    clearTimeout(logoutTimerRef.current);
    clearInterval(countdownRef.current);
  }, []);

  const resetTimers = useCallback(() => {
    clearAllTimers();
    setIsWarningVisible(false);
    isWarningVisibleRef.current = false;

    if (!enabled) return;

    const warningDelay = idleTimeoutMs - warningBeforeMs;

    // 경고 표시 타이머
    warningTimerRef.current = setTimeout(() => {
      setIsWarningVisible(true);
      isWarningVisibleRef.current = true;
      setRemainingSeconds(Math.floor(warningBeforeMs / 1000));

      countdownRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, warningDelay);

    // 자동 로그아웃 타이머
    logoutTimerRef.current = setTimeout(() => {
      clearAllTimers();
      onTimeout();
    }, idleTimeoutMs);
  }, [enabled, idleTimeoutMs, warningBeforeMs, onTimeout, clearAllTimers]);

  // 활동 감지 이벤트 리스너
  useEffect(() => {
    if (!enabled) return;

    const THROTTLE_MS = 1000;
    let lastFired = 0;

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastFired < THROTTLE_MS) return;
      lastFired = now;

      // 경고 모달이 떠 있으면 활동으로 리셋하지 않음
      if (isWarningVisibleRef.current) return;

      resetTimers();
    };

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) =>
      document.addEventListener(e, handleActivity, { passive: true })
    );

    resetTimers();

    return () => {
      events.forEach((e) => document.removeEventListener(e, handleActivity));
      clearAllTimers();
    };
  }, [enabled, resetTimers, clearAllTimers]);

  const extendSession = useCallback(async () => {
    try {
      await onExtend();
    } finally {
      resetTimers();
    }
  }, [onExtend, resetTimers]);

  const logoutNow = useCallback(() => {
    clearAllTimers();
    onTimeout();
  }, [clearAllTimers, onTimeout]);

  return { isWarningVisible, remainingSeconds, extendSession, logoutNow };
}
