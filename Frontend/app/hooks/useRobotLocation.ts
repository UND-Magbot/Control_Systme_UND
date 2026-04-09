"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/app/lib/api";

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

function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

export function useRobotLocation(): RobotLocation {
  const [places, setPlaces] = useState<Place[]>([]);
  const [location, setLocation] = useState<Omit<RobotLocation, "places">>({ floor: "1F", placeName: null });

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
            floor: p.Floor ?? "1F",
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

        // 현재 floor 정보가 API에 없으므로 기본 1F
        const currentFloor = "1F";

        // 같은 층 장소 중 가장 가까운 곳 찾기
        const samFloorPlaces = places.filter((p) => p.floor === currentFloor);
        let nearest: Place | null = null;
        let minDist = Infinity;

        for (const p of samFloorPlaces) {
          const d = distance(pos.x, pos.y, p.x, p.y);
          if (d < minDist) {
            minDist = d;
            nearest = p;
          }
        }

        setLocation({
          floor: currentFloor,
          placeName: nearest && minDist <= NEARBY_THRESHOLD ? nearest.name : null,
        });
      } catch {
        // ignore
      }
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [places]);

  return { ...location, places };
}
