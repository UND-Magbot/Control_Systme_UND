"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RobotPosition } from "@/app/components/map/types";
import { apiFetch } from "@/app/lib/api";
import { useVisibilityAwareInterval } from "@/app/hooks/useVisibilityAwareInterval";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** API 응답이 유효한 좌표(유한수 x/y/yaw)인지 검증한다. */
function isValidPosition(data: unknown): data is RobotPosition {
  if (!data || typeof data !== "object") return false;
  const p = data as Record<string, unknown>;
  return (
    Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.yaw)
  );
}

const LERP_FACTOR = 0.08;
const POLL_INTERVAL = 1000;
const FRAME_INTERVAL = 1000 / 15; // ~15fps로 throttle
const ERROR_THRESHOLD = 3; // 연속 실패 횟수 — 이 횟수 이상 실패해야 에러 처리

type UseRobotPositionReturn = {
  position: RobotPosition;
  hasError: boolean;
  isReady: boolean;
};

export function useRobotPosition(enabled = true): UseRobotPositionReturn {
  const [currentPos, setCurrentPos] = useState<RobotPosition>({ x: 0, y: 0, yaw: 0 });
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const targetRef = useRef<RobotPosition>({ x: 0, y: 0, yaw: 0 });
  const currentRef = useRef<RobotPosition>({ x: 0, y: 0, yaw: 0 });
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const failCountRef = useRef(0);

  const animate = useCallback((timestamp: number) => {
    // ~15fps throttle
    if (timestamp - lastFrameRef.current < FRAME_INTERVAL) {
      rafRef.current = requestAnimationFrame(animate);
      return;
    }
    lastFrameRef.current = timestamp;

    const t = targetRef.current;
    const c = currentRef.current;

    const nx = lerp(c.x, t.x, LERP_FACTOR);
    const ny = lerp(c.y, t.y, LERP_FACTOR);
    const nyaw = lerp(c.yaw, t.yaw, LERP_FACTOR);

    currentRef.current = { x: nx, y: ny, yaw: nyaw };
    setCurrentPos({ x: nx, y: ny, yaw: nyaw });

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  const fetchPos = useCallback(() => {
    apiFetch(`/robot/position`)
      .then((res) => res.json())
      .then((data: unknown) => {
        if (!isValidPosition(data)) {
          // 좌표 누락·비정상 응답 → 실패로 간주 (NaN 좌표 전파 방지)
          failCountRef.current += 1;
          if (failCountRef.current >= ERROR_THRESHOLD) {
            setHasError(true);
          }
          return;
        }
        targetRef.current = data;
        failCountRef.current = 0;
        setHasError(false);
        if (!isReady) {
          // 첫 응답: LERP 없이 즉시 위치 설정
          currentRef.current = data;
          setCurrentPos(data);
          setIsReady(true);
        }
      })
      .catch(() => {
        failCountRef.current += 1;
        if (failCountRef.current >= ERROR_THRESHOLD) {
          setHasError(true);
        }
      });
  }, [isReady]);

  // 위치 폴링 — 가시성 인지(C-7): 보일 때 1s, 백그라운드에서는 일시정지(hiddenMs=null).
  // 지도를 보지 않는 동안 1초 위치 폴링이 계속되던 낭비를 제거한다.
  useVisibilityAwareInterval(fetchPos, {
    activeMs: POLL_INTERVAL,
    hiddenMs: null,
    immediate: true,
    enabled,
  });

  // 부드러운 보간 애니메이션 (RAF) — 탭이 가려지면 브라우저가 자동으로 RAF를 멈춘다.
  useEffect(() => {
    if (!enabled) return;
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, animate]);

  return { position: currentPos, hasError, isReady };
}
