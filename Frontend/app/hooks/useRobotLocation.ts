"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "@/app/lib/api";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import { useVisibilityAwareInterval } from "@/app/hooks/useVisibilityAwareInterval";

type Place = {
  id: number;
  name: string;
  x: number;
  y: number;
  floor: string;
};

export type RobotLocation = {
  /** 층 이름. 층 목록 조회 실패·미매칭이면 null(= 표시는 "-"). 임의 기본값으로 채우지 않는다. */
  floor: string | null;
  placeName: string | null;
  places: Place[];
};

const NEARBY_THRESHOLD = 1.5; // 미터 단위, 이 거리 이내면 해당 장소에 있다고 판단
const PLACE_FALLBACK_FLOOR = "1F"; // 장소 마스터에 Floor 가 비어있을 때만 쓰는 파싱 기본값

function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

export function useRobotLocation(): RobotLocation {
  const [places, setPlaces] = useState<Place[]>([]);
  const [floorNameById, setFloorNameById] = useState<Record<number, string>>({});
  const [placeName, setPlaceName] = useState<string | null>(null);
  const { robots } = useRobotStatusContext();

  // 현재 대표 로봇의 층 id (On 우선, 없으면 첫 로봇)
  const currentFloorId = useMemo(() => {
    const onRobot = robots.find((r) => r.power === "On");
    return (onRobot ?? robots[0])?.currentFloorId ?? null;
  }, [robots]);

  // 층 id → 이름 매핑에 실패하면(층 목록 조회 실패, 미등록 id, 층 미확정) null 이다.
  // 예전엔 "1F" 로 채웠는데, 장애 시 화면이 실제 데이터인 것처럼 1F 를 보여줘 오판을 불렀다.
  const currentFloor =
    currentFloorId != null ? (floorNameById[currentFloorId] ?? null) : null;

  // 층 목록 1회 로드 (id → 이름 매핑)
  useEffect(() => {
    apiFetch(`/map/floors`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { id: number; FloorName: string }[]) => {
        const map: Record<number, string> = {};
        for (const f of data) map[f.id] = f.FloorName;
        setFloorNameById(map);
      })
      .catch(() => {});
  }, []);

  // 장소 데이터 1회 fetch
  useEffect(() => {
    apiFetch(`/DB/places`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: any[]) => {
        setPlaces(
          data.map((p) => ({
            id: p.id,
            name: p.LacationName ?? "",
            x: p.LocationX ?? 0,
            y: p.LocationY ?? 0,
            floor: p.Floor ?? PLACE_FALLBACK_FLOOR,
          }))
        );
      })
      .catch(() => {});
  }, []);

  // 로봇 위치 폴링해서 가장 가까운 장소 매칭
  const poll = useCallback(async () => {
    // 층을 모르면 같은 층 장소를 고를 수 없다 → 장소명도 미확정.
    if (currentFloor == null) {
      setPlaceName(null);
      return;
    }
    try {
      const res = await apiFetch(`/robot/position`);
      if (!res.ok) return;
      const pos = await res.json();

      const sameFloorPlaces = places.filter((p) => p.floor === currentFloor);
      let nearest: Place | null = null;
      let minDist = Infinity;

      for (const p of sameFloorPlaces) {
        const d = distance(pos.x, pos.y, p.x, p.y);
        if (d < minDist) {
          minDist = d;
          nearest = p;
        }
      }

      setPlaceName(nearest && minDist <= NEARBY_THRESHOLD ? nearest.name : null);
    } catch {
      // ignore
    }
  }, [places, currentFloor]);

  // 가시성 인지 폴링(C-7): 보일 때 3s, 백그라운드 일시정지, 복귀 시 즉시 갱신
  useVisibilityAwareInterval(poll, { activeMs: 3000, hiddenMs: null, immediate: true });

  return { floor: currentFloor, placeName, places };
}
