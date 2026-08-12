import { describe, it, expect } from "vitest";
import { toPoiItem, isMappablePlace, isMovablePlace, isMovableCategory, type PlaceRow } from "@/app/lib/placeFilter";

const row = (over: Partial<PlaceRow> = {}): PlaceRow => ({
  id: 1,
  LacationName: "로비",
  LocationX: 1.5,
  LocationY: -2.25,
  Floor: "1층",
  FloorId: 3,
  MapId: 7,
  Category: "waypoint",
  ...over,
});

describe("toPoiItem", () => {
  it("장소 행을 지도 POI 로 옮긴다", () => {
    expect(toPoiItem(row())).toEqual({
      id: 1, name: "로비", x: 1.5, y: -2.25,
      floor: "1층", floorId: 3, mapId: 7, category: "waypoint",
    });
  });

  it("좌표·이름이 비어 있어도 터지지 않는다", () => {
    const poi = toPoiItem(row({ LacationName: null, LocationX: null, LocationY: null }));
    expect(poi.name).toBe("");
    expect(poi.x).toBe(0);
    expect(poi.y).toBe(0);
  });

  it("모르는 Category 는 work 로 떨어진다", () => {
    expect(toPoiItem(row({ Category: "remote" })).category).toBe("work");
    expect(toPoiItem(row({ Category: null })).category).toBe("work");
  });
});

describe("isMappablePlace", () => {
  it("위험구역은 지도 마커로 그리지 않는다 — 폴리곤이라 centroid 점이 범위를 오해시킨다", () => {
    expect(isMappablePlace(toPoiItem(row({ Category: "danger" })))).toBe(false);
  });

  it("그 외 장소는 모두 그린다 (충전소 포함 — 도크 위치가 원격 조작에 필요하다)", () => {
    for (const c of ["waypoint", "charge", "standby", "remote", null]) {
      expect(isMappablePlace(toPoiItem(row({ Category: c })))).toBe(true);
    }
  });
});

describe("isMovablePlace — 장소 이동 후보 (D-01)", () => {
  it("같은 층의 경유지는 보낼 수 있다", () => {
    expect(isMovablePlace(row({ Category: "waypoint", FloorId: 3 }), 3)).toBe(true);
  });

  it("작업지·대기소도 보낼 수 있다", () => {
    expect(isMovablePlace(row({ Category: "work" }), 3)).toBe(true);
    expect(isMovablePlace(row({ Category: "standby" }), 3)).toBe(true);
  });

  it("위험구역은 제외한다 — centroid 로 보내면 구역 한복판이다", () => {
    expect(isMovablePlace(row({ Category: "danger" }), 3)).toBe(false);
  });

  it("충전소는 제외한다 — 전용 '충전소 복귀' 액션이 따로 있다", () => {
    expect(isMovablePlace(row({ Category: "charge" }), 3)).toBe(false);
  });

  it("다른 층은 제외한다 — 다층 이동은 경로·작업으로만 한다", () => {
    expect(isMovablePlace(row({ FloorId: 4 }), 3)).toBe(false);
  });

  it("층을 모르는 장소는 제외한다", () => {
    expect(isMovablePlace(row({ FloorId: null }), 3)).toBe(false);
  });

  it("로봇 층을 모르면 아무것도 후보가 아니다", () => {
    expect(isMovablePlace(row(), null)).toBe(false);
    expect(isMovablePlace(row(), undefined)).toBe(false);
  });
});

describe("isMovableCategory", () => {
  it("보낼 수 있는 카테고리만 통과시킨다", () => {
    expect(isMovableCategory("waypoint")).toBe(true);
    expect(isMovableCategory("work")).toBe(true);
    expect(isMovableCategory("standby")).toBe(true);
    expect(isMovableCategory("danger")).toBe(false);
    expect(isMovableCategory("charge")).toBe(false);
    expect(isMovableCategory(null)).toBe(false);
  });
});
