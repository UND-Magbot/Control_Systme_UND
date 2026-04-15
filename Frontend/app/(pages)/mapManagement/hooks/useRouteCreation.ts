"use client";

import { useCallback, useState } from "react";
import type { RouteDirection, RouteSegment, DbRoute } from "../types/map";

/**
 * 구간(route) 생성/편집 모드 상태 번들.
 * - isRouteMode: 구간 생성 모드 활성 여부
 * - routeStartName / routeEndName: 현재 선택된 양 끝 장소
 * - routeDirection: forward / reverse / bidirectional
 * - pendingRoutes: 저장 전까지 로컬에 추가된 구간
 * - dbRoutes: 현재 맵의 DB 구간 목록 (로드 시 여기에 set)
 * - deletedRouteDbIds: 저장 전까지 삭제 예정으로 표시된 DB 구간 id
 */
export function useRouteCreation() {
  const [isRouteMode, setIsRouteMode] = useState(false);
  const [routeStartName, setRouteStartName] = useState<string | null>(null);
  const [routeEndName, setRouteEndName] = useState<string | null>(null);
  const [routeDirection, setRouteDirection] = useState<RouteDirection>("forward");
  const [pendingRoutes, setPendingRoutes] = useState<RouteSegment[]>([]);
  const [dbRoutes, setDbRoutes] = useState<DbRoute[]>([]);
  const [deletedRouteDbIds, setDeletedRouteDbIds] = useState<Set<number>>(new Set());

  const reset = useCallback(() => {
    setIsRouteMode(false);
    setRouteStartName(null);
    setRouteEndName(null);
  }, []);

  return {
    isRouteMode,
    setIsRouteMode,
    routeStartName,
    setRouteStartName,
    routeEndName,
    setRouteEndName,
    routeDirection,
    setRouteDirection,
    pendingRoutes,
    setPendingRoutes,
    dbRoutes,
    setDbRoutes,
    deletedRouteDbIds,
    setDeletedRouteDbIds,
    reset,
  };
}
