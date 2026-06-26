import { describe, it, expect } from "vitest";
import { validateDangerZone, canClosePolygon } from "../validation";
import type { ZonePoint } from "../types";

const validSquare: ZonePoint[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe("validateDangerZone", () => {
  it("정상 위험구역은 valid", () => {
    const r = validateDangerZone({
      name: "출입금지구역 A",
      points: validSquare,
      floorId: 3,
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("이름 공백이면 에러", () => {
    const r = validateDangerZone({ name: "   ", points: validSquare, floorId: 3 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("이름"))).toBe(true);
  });

  it("이름 길이 초과 에러", () => {
    const r = validateDangerZone({
      name: "가".repeat(51),
      points: validSquare,
      floorId: 3,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("50자"))).toBe(true);
  });

  it("점 3개 미만이면 에러", () => {
    const r = validateDangerZone({
      name: "구역",
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      floorId: 3,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("3개"))).toBe(true);
  });

  it("면적 너무 작으면 에러", () => {
    const tiny: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 0.05, y: 0 },
      { x: 0.05, y: 0.05 },
    ];
    const r = validateDangerZone({ name: "구역", points: tiny, floorId: 3 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("면적"))).toBe(true);
  });

  it("자기교차 폴리곤은 에러", () => {
    const bowtie: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ];
    const r = validateDangerZone({ name: "구역", points: bowtie, floorId: 3 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("자기교차"))).toBe(true);
  });

  it("층 미선택이면 에러 (기본 requireFloor)", () => {
    const r = validateDangerZone({ name: "구역", points: validSquare, floorId: null });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("층"))).toBe(true);
  });

  it("requireFloor=false면 층 없어도 통과", () => {
    const r = validateDangerZone(
      { name: "구역", points: validSquare, floorId: null },
      { requireFloor: false }
    );
    expect(r.valid).toBe(true);
  });

  it("에러 여러개 동시 수집", () => {
    const r = validateDangerZone({ name: "", points: [], floorId: null });
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("canClosePolygon", () => {
  it("정상 사각형은 닫기 가능", () => {
    expect(canClosePolygon(validSquare)).toBe(true);
  });
  it("점 2개는 불가", () => {
    expect(canClosePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
  it("자기교차는 불가", () => {
    expect(
      canClosePolygon([
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        { x: 4, y: 0 },
        { x: 0, y: 4 },
      ])
    ).toBe(false);
  });
});
