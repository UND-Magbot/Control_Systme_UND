// /DB/places 응답을 지도용 POI 로 바꾸고 거르는 공통 규칙.
// 대시보드 맵·원격제어 맵·장소 이동 목록이 같은 기준을 쓰도록 여기서만 관리한다.

import type { POIItem } from "@/app/components/map/types";
import { toPoiCategory } from "@/app/components/map/poiStyle";

/** /DB/places 응답 한 행 중 지도 표시에 필요한 최소 필드. */
export type PlaceRow = {
  id: number;
  LacationName?: string | null;
  LocationX?: number | null;
  LocationY?: number | null;
  Floor?: string | null;
  FloorId?: number | null;
  MapId?: number | null;
  Category?: string | null;
};

export function toPoiItem(p: PlaceRow): POIItem {
  return {
    id: p.id,
    name: p.LacationName ?? "",
    x: p.LocationX ?? 0,
    y: p.LocationY ?? 0,
    floor: p.Floor ?? "",
    floorId: p.FloorId ?? null,
    mapId: p.MapId ?? null,
    category: toPoiCategory(p.Category),
  };
}

/**
 * 지도에 마커로 그릴 수 있는 장소인가.
 * 위험구역은 폴리곤이라 centroid 를 점으로 찍으면 실제 범위를 오해하게 된다 — 전용 레이어로만 그린다.
 */
export function isMappablePlace(poi: POIItem): boolean {
  return poi.category !== "danger";
}

/**
 * '장소 이동'으로 로봇을 보낼 수 있는 카테고리 (D-01 · Q8).
 *
 * - `danger` 제외: 폴리곤의 centroid 로 보내는 것이라 **위험구역 한복판으로 보낸다**
 * - `charge`  제외: 전용 '충전소 복귀' 액션이 따로 있다. 여기 두면 같은 일을 하는 길이 둘이 된다
 *
 * DB 의 Category 는 waypoint/work/standby/charge/danger 5종이다.
 */
const MOVABLE_CATEGORIES = new Set(["waypoint", "work", "standby"]);

/**
 * 로봇을 보낼 수 있는 장소인가.
 *
 * 층이 다르면 뺀다 — 다층 이동은 경로·작업으로만 수행한다(Q8, 다층 스택 성숙 후 재검토).
 * `FloorId` 가 없는 장소도 뺀다. 어느 층인지 모르는 좌표로 로봇을 보낼 수는 없다.
 */
export function isMovablePlace(row: PlaceRow, robotFloorId: number | null | undefined): boolean {
  if (!MOVABLE_CATEGORIES.has(row.Category ?? "")) return false;
  if (robotFloorId == null) return false;
  return row.FloorId === robotFloorId;
}

/**
 * 이 카테고리의 지점으로 로봇을 보낼 수 있는가 — 지도 POI 카드에서 쓴다.
 * 층 판정은 호출부가 한다(지도는 보고 있는 층이 로봇 층과 다를 수 있다).
 */
export function isMovableCategory(category: string | null | undefined): boolean {
  return MOVABLE_CATEGORIES.has(category ?? "");
}
