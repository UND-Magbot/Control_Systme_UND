/**
 * 위험지역 그리기 시 기존 POI / 구간(RouteInfo) / 경로(WayInfo) 와의 충돌 감지.
 *
 * Backend `app/database/routes/danger_zone.py::detect_zone_conflicts` 와 동일한 판정 기준을
 * 프론트엔드 로컬 상태로 실행한다 (네트워크 호출 없음).
 */

import type { Point } from "./geometry";
import { pointInPolygon, segmentIntersectsPolygon } from "./geometry";

export type MapPlaceLike = {
  id: number;
  LacationName: string;
  LocationX: number;
  LocationY: number;
  Category?: string | null;
};

export type PendingPlaceLike = {
  tempId: string;
  LacationName: string;
  LocationX: number;
  LocationY: number;
};

export type DbRouteLike = {
  id: number;
  StartPlaceName: string;
  EndPlaceName: string;
  Direction: string;
};

export type PendingRouteLike = {
  tempId: string;
  startName: string;
  endName: string;
  direction: string;
};

export type WayInfoLike = {
  id: number;
  WayName: string;
  WayPoints: string; // " - " 로 분리된 POI 이름들
};

export type PoiConflict = {
  kind: "db" | "pending";
  id: number | string; // db면 number, pending이면 tempId
  name: string;
  x: number;
  y: number;
  category?: string | null;
};

export type RouteConflict = {
  kind: "db" | "pending";
  id: number | string;
  startName: string;
  endName: string;
  direction: string;
};

export type WayConflict = {
  id: number;
  wayName: string;
  reason: "poi_included" | "segment_crossed";
  affectedPoiNames?: string[]; // poi_included 인 경우
};

export type ZoneConflicts = {
  poisInside: PoiConflict[];
  routesCrossing: RouteConflict[];
  waysAffected: WayConflict[];
};

type DetectInput = {
  polygon: Point[];
  dbPlaces: MapPlaceLike[];
  pendingPlaces: PendingPlaceLike[];
  dbRoutes: DbRouteLike[];
  pendingRoutes: PendingRouteLike[];
  wayInfos: WayInfoLike[];
  /** 좌표 맵 — Route 의 시작/끝 POI 좌표 조회용. DB + pending + movedPlaces 병합된 맵 권장. */
  placeCoordMap: Map<string, Point>;
};

/** 최소 3개 꼭짓점 필요. 미만이면 빈 결과. */
export function detectZoneConflicts(input: DetectInput): ZoneConflicts {
  const { polygon, dbPlaces, pendingPlaces, dbRoutes, pendingRoutes, wayInfos, placeCoordMap } = input;
  const result: ZoneConflicts = { poisInside: [], routesCrossing: [], waysAffected: [] };

  if (polygon.length < 3) return result;

  // 1) POI 포함 검사 (DB + pending). "danger" 카테고리(zone 꼭짓점)는 제외.
  for (const p of dbPlaces) {
    if (p.Category === "danger") continue;
    if (pointInPolygon({ x: p.LocationX, y: p.LocationY }, polygon)) {
      result.poisInside.push({
        kind: "db",
        id: p.id,
        name: p.LacationName,
        x: p.LocationX,
        y: p.LocationY,
        category: p.Category,
      });
    }
  }
  for (const p of pendingPlaces) {
    if (pointInPolygon({ x: p.LocationX, y: p.LocationY }, polygon)) {
      result.poisInside.push({
        kind: "pending",
        id: p.tempId,
        name: p.LacationName,
        x: p.LocationX,
        y: p.LocationY,
      });
    }
  }

  // 2) RouteInfo 교차 검사 — 시작/끝 POI 좌표를 placeCoordMap 에서 lookup
  const poisInsideNames = new Set(result.poisInside.map((p) => p.name));
  for (const r of dbRoutes) {
    const a = placeCoordMap.get(r.StartPlaceName);
    const b = placeCoordMap.get(r.EndPlaceName);
    if (!a || !b) continue;
    if (
      poisInsideNames.has(r.StartPlaceName) ||
      poisInsideNames.has(r.EndPlaceName) ||
      segmentIntersectsPolygon(a, b, polygon)
    ) {
      result.routesCrossing.push({
        kind: "db",
        id: r.id,
        startName: r.StartPlaceName,
        endName: r.EndPlaceName,
        direction: r.Direction,
      });
    }
  }
  for (const r of pendingRoutes) {
    const a = placeCoordMap.get(r.startName);
    const b = placeCoordMap.get(r.endName);
    if (!a || !b) continue;
    if (
      poisInsideNames.has(r.startName) ||
      poisInsideNames.has(r.endName) ||
      segmentIntersectsPolygon(a, b, polygon)
    ) {
      result.routesCrossing.push({
        kind: "pending",
        id: r.tempId,
        startName: r.startName,
        endName: r.endName,
        direction: r.direction,
      });
    }
  }

  // 3) WayInfo 검사
  for (const w of wayInfos) {
    const names = (w.WayPoints || "").split(" - ").map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) continue;

    // indirect: POI 이름이 poisInside 에 있으면 영향
    const affectedNames = names.filter((n) => poisInsideNames.has(n));
    if (affectedNames.length > 0) {
      result.waysAffected.push({
        id: w.id,
        wayName: w.WayName,
        reason: "poi_included",
        affectedPoiNames: affectedNames,
      });
      continue;
    }

    // direct: 인접 쌍 선분 중 하나라도 교차
    let segmentCrossed = false;
    for (let i = 0; i < names.length - 1; i++) {
      const a = placeCoordMap.get(names[i]);
      const b = placeCoordMap.get(names[i + 1]);
      if (!a || !b) continue;
      if (segmentIntersectsPolygon(a, b, polygon)) {
        segmentCrossed = true;
        break;
      }
    }
    if (segmentCrossed) {
      result.waysAffected.push({
        id: w.id,
        wayName: w.WayName,
        reason: "segment_crossed",
      });
    }
  }

  return result;
}

export function hasAnyConflict(c: ZoneConflicts): boolean {
  return c.poisInside.length > 0 || c.routesCrossing.length > 0 || c.waysAffected.length > 0;
}
