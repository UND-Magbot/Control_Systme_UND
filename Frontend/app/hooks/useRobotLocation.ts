"use client";

import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "@/app/lib/api";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";

type Place = {
  id: number;
  name: string;
  x: number;
  y: number;
  floor: string;
};

export type RobotLocation = {
  floor: string;
  placeName: string | null;
  places: Place[];
};

const NEARBY_THRESHOLD = 1.5; // 미터 단위, 이 거리 이내면 해당 장소에 있다고 판단
const DEFAULT_FLOOR = "1F";

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

  const currentFloor =
    currentFloorId != null && floorNameById[currentFloorId]
      ? floorNameById[currentFloorId]
      : DEFAULT_FLOOR;

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
            floor: p.Floor ?? DEFAULT_FLOOR,
          }))
        );
      })
      .catch(() => {});
  }, []);

  // 로봇 위치 폴링해서 가장 가까운 장소 매칭
  useEffect(() => {
    const poll = async () => {
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
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [places, currentFloor]);

  return { floor: currentFloor, placeName, places };
}
