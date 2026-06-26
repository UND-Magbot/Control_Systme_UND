import { describe, it, expect } from "vitest";
import { detectIntrusions, evaluateZone } from "../intrusion";
import type { DangerZone } from "../types";

function makeZone(over: Partial<DangerZone>): DangerZone {
  return {
    id: "z1",
    name: "구역",
    floorId: 1,
    status: "active",
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ],
    ...over,
  };
}

describe("evaluateZone", () => {
  const zone = makeZone({});

  it("내부면 inside, distance 0", () => {
    const r = evaluateZone({ x: 2, y: 2 }, zone);
    expect(r.level).toBe("inside");
    expect(r.distance).toBe(0);
  });

  it("경고거리 이내면 warning", () => {
    const r = evaluateZone({ x: 4.3, y: 2 }, zone, 0.5);
    expect(r.level).toBe("warning");
    expect(r.distance).toBeCloseTo(0.3);
  });

  it("경고거리 밖이면 safe", () => {
    const r = evaluateZone({ x: 10, y: 2 }, zone, 0.5);
    expect(r.level).toBe("safe");
    expect(r.distance).toBeCloseTo(6);
  });
});

describe("detectIntrusions", () => {
  it("내부 진입 시 intruding/warning 모두 true", () => {
    const report = detectIntrusions({ x: 2, y: 2 }, [makeZone({})]);
    expect(report.intruding).toBe(true);
    expect(report.warning).toBe(true);
    expect(report.zones[0].level).toBe("inside");
  });

  it("근접만 했을 때 warning true, intruding false", () => {
    const report = detectIntrusions({ x: 4.2, y: 2 }, [makeZone({})], {
      warningDistance: 0.5,
    });
    expect(report.intruding).toBe(false);
    expect(report.warning).toBe(true);
  });

  it("멀리 있으면 둘 다 false", () => {
    const report = detectIntrusions({ x: 100, y: 100 }, [makeZone({})]);
    expect(report.intruding).toBe(false);
    expect(report.warning).toBe(false);
    expect(report.zones[0].level).toBe("safe");
  });

  it("inactive 구역은 기본 제외", () => {
    const report = detectIntrusions({ x: 2, y: 2 }, [
      makeZone({ status: "inactive" }),
    ]);
    expect(report.intruding).toBe(false);
    expect(report.zones).toHaveLength(0);
  });

  it("includeInactive=true면 inactive도 평가", () => {
    const report = detectIntrusions(
      { x: 2, y: 2 },
      [makeZone({ status: "inactive" })],
      { includeInactive: true }
    );
    expect(report.intruding).toBe(true);
  });

  it("점 3개 미만 구역은 제외", () => {
    const report = detectIntrusions({ x: 2, y: 2 }, [
      makeZone({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
    ]);
    expect(report.zones).toHaveLength(0);
  });

  it("여러 구역은 가까운 순 정렬", () => {
    const near = makeZone({
      id: "near",
      points: [
        { x: 5, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 1 },
        { x: 5, y: 1 },
      ],
    });
    const far = makeZone({
      id: "far",
      points: [
        { x: 50, y: 0 },
        { x: 51, y: 0 },
        { x: 51, y: 1 },
        { x: 50, y: 1 },
      ],
    });
    const report = detectIntrusions({ x: 0, y: 0.5 }, [far, near]);
    expect(report.zones[0].zoneId).toBe("near");
    expect(report.zones[1].zoneId).toBe("far");
  });
});
