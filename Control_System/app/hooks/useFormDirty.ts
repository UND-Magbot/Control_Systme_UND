"use client";

import { useRef, useMemo } from "react";

export function useFormDirty(deps: unknown[]): { isDirty: boolean; markClean: () => void } {
  const initialRef = useRef<string | null>(null);
  const cleanRef = useRef<string | null>(null);

  const currentSnapshot = JSON.stringify(deps);

  // 첫 렌더 시 초기값 저장
  if (initialRef.current === null) {
    initialRef.current = currentSnapshot;
    cleanRef.current = currentSnapshot;
  }

  const markClean = () => {
    cleanRef.current = JSON.stringify(deps);
  };

  const isDirty = currentSnapshot !== cleanRef.current;

  return useMemo(() => ({ isDirty, markClean }), [isDirty]);
}
