"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RobotPosition } from "@/app/components/map/types";
import { API_BASE } from '@/app/constants/api';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const LERP_FACTOR = 0.08;
const POLL_INTERVAL = 1000;

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

  const animate = useCallback(() => {
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
      fetch(`${API_BASE}/robot/position`)
        .then((res) => res.json())
        .then((data: RobotPosition) => {
          targetRef.current = data;
          setHasError(false);
          if (!isReady) setIsReady(true);
        })
        .catch(() => {
          setHasError(true);
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
