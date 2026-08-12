"use client";

/**
 * 로봇별 현재 위치("2F · 접수") 계산.
 *
 * 이전에는 `useRobotLocation()` 이 **대표 로봇 하나**(power==="On" 인 첫 로봇)의 위치를
 * 구해 모든 카드에 같은 값을 넘겼다. 그래서 M20-SIM 이 움직이면 목록의 로봇이 전부
 * 같이 움직이는 것처럼 보였다 — 화면이 자신 있게 틀린 정보를 말하는 상태였다.
 *
 * 좌표는 이미 로봇마다 `robot.position` 에 있다. 전역 `/robot/position` 을 폴링할
 * 이유가 없어 그 호출도 없앴다(로봇 수와 무관하게 상태는 이미 흐르고 있다).
 *
 * 장소·층 마스터는 로봇과 무관하므로 한 번만 받아 공유하고, **매칭만 로봇별로** 돈다.
 */

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import type { RobotRowData } from "@/app/types";

export type Place = {
  id: number;
  name: string;
  x: number;
  y: number;
  floor: string;
};

export type RobotLocation = {
  /** 층 이름. 미매칭·미확정이면 null(= 표시는 "-"). 임의 기본값으로 채우지 않는다. */
  floor: string | null;
  placeName: string | null;
};

export const EMPTY_LOCATION: RobotLocation = { floor: null, placeName: null };

const NEARBY_THRESHOLD = 1.5; // m — 이 거리 이내면 그 장소에 있다고 본다
const PLACE_FALLBACK_FLOOR = "1F"; // 장소 마스터에 Floor 가 비어있을 때만 쓰는 파싱 기본값

function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/** 이 로봇의 위치로 믿을 수 있는 좌표. 측위 미확정이면 마지막 신뢰 위치를 쓴다. */
function usablePosition(robot: RobotRowData): { x: number; y: number } | null {
  if (robot.initposePending) {
    const t = robot.trustedPosition;
    return t ? { x: t.x, y: t.y } : null;
  }
  const p = robot.position;
  return p ? { x: p.x, y: p.y } : null;
}

export function useRobotLocations(robots: RobotRowData[]): {
  places: Place[];
  byRobotId: Record<number, RobotLocation>;
} {
  const [places, setPlaces] = useState<Place[]>([]);
  const [floorNameById, setFloorNameById] = useState<Record<number, string>>({});

  // 층 목록 1회 로드 (id → 이름)
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

  // 장소 마스터 1회 로드
  useEffect(() => {
    apiFetch(`/DB/places`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { id: number; LacationName?: string; LocationX?: number; LocationY?: number; Floor?: string }[]) => {
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

  const byRobotId = useMemo(() => {
    const out: Record<number, RobotLocation> = {};
    for (const robot of robots) {
      // 층을 모르면 같은 층 장소를 고를 수 없다 → 층도 장소도 미확정이다.
      const floor =
        robot.currentFloorId != null ? (floorNameById[robot.currentFloorId] ?? null) : null;
      if (floor == null) {
        out[robot.id] = EMPTY_LOCATION;
        continue;
      }

      const pos = usablePosition(robot);
      if (!pos) {
        out[robot.id] = { floor, placeName: null };
        continue;
      }

      let nearest: Place | null = null;
      let minDist = Infinity;
      for (const p of places) {
        if (p.floor !== floor) continue;
        const d = distance(pos.x, pos.y, p.x, p.y);
        if (d < minDist) {
          minDist = d;
          nearest = p;
        }
      }
      out[robot.id] = {
        floor,
        placeName: nearest && minDist <= NEARBY_THRESHOLD ? nearest.name : null,
      };
    }
    return out;
  }, [robots, places, floorNameById]);

  return { places, byRobotId };
}
