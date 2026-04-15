"use client";

import { useCallback, useState } from "react";

export type DeleteConfirmTarget = {
  type: "db" | "pending" | "route_db" | "route_pending";
  id: number | string;
  name: string;
} | null;

/**
 * 장소/구간 삭제 모드 상태 번들.
 * - isDeleteMode: 삭제 모드 활성 여부
 * - deletedDbIds: 저장 전까지 "삭제 예정"으로 표시된 DB 장소 id 집합
 * - deleteConfirmTarget: 삭제 확인 팝오버 대상
 */
export function usePlaceDelete() {
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [deletedDbIds, setDeletedDbIds] = useState<Set<number>>(new Set());
  const [deleteConfirmTarget, setDeleteConfirmTarget] =
    useState<DeleteConfirmTarget>(null);

  const reset = useCallback(() => {
    setIsDeleteMode(false);
    setDeleteConfirmTarget(null);
  }, []);

  return {
    isDeleteMode,
    setIsDeleteMode,
    deletedDbIds,
    setDeletedDbIds,
    deleteConfirmTarget,
    setDeleteConfirmTarget,
    reset,
  };
}
