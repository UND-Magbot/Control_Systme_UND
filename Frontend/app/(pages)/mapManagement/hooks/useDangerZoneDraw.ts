"use client";

import { useCallback, useState } from "react";

export type DangerVertex = { x: number; y: number };

export function useDangerZoneDraw() {
  const [isDangerZoneMode, setIsDangerZoneMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState<DangerVertex[]>([]);

  const addVertex = useCallback((p: DangerVertex) => {
    setDraftPoints((prev) => [...prev, p]);
  }, []);

  const undoLastVertex = useCallback(() => {
    setDraftPoints((prev) => prev.slice(0, -1));
  }, []);

  const reset = useCallback(() => {
    setIsDangerZoneMode(false);
    setDraftPoints([]);
  }, []);

  return {
    isDangerZoneMode,
    setIsDangerZoneMode,
    draftPoints,
    setDraftPoints,
    addVertex,
    undoLastVertex,
    reset,
  };
}
