"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RobotPosition } from "@/app/components/map/types";
import { apiFetch } from "@/app/lib/api";

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

  useEffect(() => {
    if (!enabled) return;

    const fetchPos = () => {
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
    };

    fetchPos();
    const interval = setInterval(fetchPos, POLL_INTERVAL);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      clearInterval(interval);
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, animate]);

  return { position: currentPos, hasError, isReady };
}
