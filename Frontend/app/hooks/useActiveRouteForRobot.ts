"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import type { NavPath, NavPathSegment, NavGuideLine } from "@/app/components/map/types";

const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 15_000;
const ERROR_THRESHOLD = 3;

type ActivePlace = {
  name: string;
  x: number;
  y: number;
  map_id: number | null;
  floor_id: number | null;
};

type ActiveRouteResponse = {
  schedule: {
    id: number;
    work_name: string;
    way_name: string;
    robot_name: string;
    task_status: string;
  } | null;
  progress: {
    current_wp_index: number;
    total_wp: number;
  } | null;
  route: {
    places: ActivePlace[];
  } | null;
};

type Params = {
  robotName: string | null | undefined;
  robotPosition: { x: number; y: number } | null;
  selectedFloorId: number | null;
  isNavigating: boolean;
};

type Result = {
  navPath: NavPath | null;
  guideLine: NavGuideLine;
  activeFloorId: number | null;
  activeSchedule: { id: number; workName: string; wayName: string } | null;
};

export function useActiveRouteForRobot({
  robotName,
  robotPosition,
  selectedFloorId,
  isNavigating,
}: Params): Result {
  const [response, setResponse] = useState<ActiveRouteResponse | null>(null);
  const failCountRef = useRef(0);

  useEffect(() => {
    if (!robotName) {
      setResponse(null);
      return;
    }

    // 네비게이션 아님 → 즉시 클리어 (5초 대기 없이) 후 저주기 폴링
    if (!isNavigating) {
      setResponse(null);
    }

    let cancelled = false;
    let controller: AbortController | null = null;

    const fetchRoute = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await apiFetch(
          `/DB/schedule/active/route?robot_name=${encodeURIComponent(robotName)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: ActiveRouteResponse = await res.json();
        if (cancelled) return;
        failCountRef.current = 0;
        setResponse(data);
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === "AbortError") return;
        if (cancelled) return;
        failCountRef.current += 1;
        if (failCountRef.current >= ERROR_THRESHOLD) {
          setResponse(null);
        }
      }
    };

    fetchRoute();
    const intervalMs = isNavigating ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const interval = setInterval(fetchRoute, intervalMs);

    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(interval);
    };
  }, [robotName, isNavigating]);

  const schedule = response?.schedule ?? null;
  const places = response?.route?.places ?? [];
  const progress = response?.progress ?? null;

  // 활성 층: current_wp_index 인근 place의 floor_id (없으면 첫 place)
  let activeFloorId: number | null = null;
  if (places.length > 0) {
    const idx = progress?.current_wp_index ?? 0;
    const clamped = Math.min(Math.max(idx, 0), places.length - 1);
    activeFloorId = places[clamped].floor_id ?? places[0].floor_id ?? null;
  }

  // 현재 층에 속하는 연속 세그먼트만 생성
  let navPath: NavPath | null = null;
  if (places.length >= 2 && selectedFloorId != null) {
    const segments: NavPathSegment[] = [];
    for (let i = 0; i < places.length - 1; i++) {
      const a = places[i];
      const b = places[i + 1];
      if (a.floor_id !== selectedFloorId || b.floor_id !== selectedFloorId) continue;
      segments.push({
        from: { x: a.x, y: a.y, name: a.name },
        to: { x: b.x, y: b.y, name: b.name },
        direction: "one-way",
        floorId: a.floor_id ?? undefined,
      });
    }
    if (segments.length > 0) navPath = { segments };
  }

  // 가이드 라인: 로봇 위치 → 다음 목적지 POI
  // current_wp_index는 "다음으로 향하는 place"의 인덱스(1-based 전송 후 증가 직전까지)
  let guideLine: NavGuideLine = null;
  if (
    navPath &&
    robotPosition &&
    progress &&
    places.length > 0 &&
    selectedFloorId != null
  ) {
    const targetIdx = Math.min(Math.max(progress.current_wp_index, 0), places.length - 1);
    const target = places[targetIdx];
    if (target && target.floor_id === selectedFloorId) {
      guideLine = {
        from: { x: robotPosition.x, y: robotPosition.y },
        to: { x: target.x, y: target.y },
      };
    }
  }

  return {
    navPath,
    guideLine,
    activeFloorId,
    activeSchedule: schedule
      ? { id: schedule.id, workName: schedule.work_name, wayName: schedule.way_name }
      : null,
  };
}
