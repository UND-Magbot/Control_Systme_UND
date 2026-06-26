"use client";

import { useEffect, useRef } from "react";

type Options = {
  /** 탭이 보일 때(foreground) 폴링 주기(ms). */
  activeMs: number;
  /**
   * 탭이 가려졌을 때(background) 폴링 주기(ms).
   * `null`이면 백그라운드에서 폴링을 완전히 멈춘다(기본값).
   * 경보처럼 백그라운드에서도 최소 갱신이 필요한 경우 완화된 값(예: 10000)을 준다.
   */
  hiddenMs?: number | null;
  /** 마운트 직후 1회 즉시 실행할지. 기본 true. */
  immediate?: boolean;
  /** false면 타이머를 걸지 않는다(조건부 폴링). 기본 true. */
  enabled?: boolean;
};

/**
 * 탭 가시성(document.hidden)을 인지하는 폴링 인터벌 훅 (C-7).
 *
 * - 보일 때는 `activeMs`, 가려졌을 때는 `hiddenMs`(또는 일시정지) 주기로 콜백을 호출한다.
 * - 탭이 다시 보이게 되면 즉시 1회 갱신하여 stale 데이터를 빠르게 회복한다.
 * - 콜백은 ref로 최신값을 유지하므로, 의존성 배열에 콜백을 넣지 않아도
 *   항상 최신 클로저가 실행된다(과거 stale-closure 버그 방지에도 도움).
 */
export function useVisibilityAwareInterval(
  callback: () => void,
  { activeMs, hiddenMs = null, immediate = true, enabled = true }: Options,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      stop();
      const ms =
        typeof document !== "undefined" && document.hidden ? hiddenMs : activeMs;
      if (ms == null) return; // 백그라운드 일시정지
      timer = setInterval(() => cbRef.current(), ms);
    };

    const onVisibilityChange = () => {
      // 다시 보이게 되면 즉시 1회 갱신 후 active 주기로 재시작
      if (typeof document !== "undefined" && !document.hidden) {
        cbRef.current();
      }
      start();
    };

    if (immediate) cbRef.current();
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeMs, hiddenMs, immediate, enabled]);
}
