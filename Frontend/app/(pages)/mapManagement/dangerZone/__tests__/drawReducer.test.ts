import { describe, it, expect } from "vitest";
import {
  drawReducer,
  initialDrawState,
  canFinish,
  type DrawState,
} from "../drawReducer";

function build(points: { x: number; y: number }[]): DrawState {
  let s = drawReducer(initialDrawState, { type: "START" });
  for (const p of points) {
    s = drawReducer(s, { type: "ADD_POINT", point: p });
  }
  return s;
}

describe("drawReducer", () => {
  it("START는 drawing 상태로 초기화", () => {
    const s = drawReducer(initialDrawState, { type: "START" });
    expect(s.status).toBe("drawing");
    expect(s.points).toHaveLength(0);
  });

  it("idle 상태에서 ADD_POINT 무시", () => {
    const s = drawReducer(initialDrawState, {
      type: "ADD_POINT",
      point: { x: 1, y: 1 },
    });
    expect(s.points).toHaveLength(0);
  });

  it("점을 순서대로 추가", () => {
    const s = build([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);
    expect(s.points).toHaveLength(3);
  });

  it("최소 간격보다 가까운 중복점은 무시", () => {
    let s = drawReducer(initialDrawState, { type: "START" });
    s = drawReducer(s, { type: "ADD_POINT", point: { x: 0, y: 0 } });
    s = drawReducer(s, {
      type: "ADD_POINT",
      point: { x: 0.01, y: 0 }, // 기본 minGap 0.05 미만
    });
    expect(s.points).toHaveLength(1);
  });

  it("자기교차를 만드는 점은 거부", () => {
    // (0,0)(4,0)(4,4) 그린 뒤 (2,-1)로 가면 첫 변과 교차
    let s = build([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: -1, y: 2 },
    ]);
    const before = s.points.length;
    // (-1,2)→ 다음 점 (2,-1) 추가 시 (0,0)-(4,0) 변과 교차
    s = drawReducer(s, { type: "ADD_POINT", point: { x: 2, y: -1 } });
    expect(s.points.length).toBe(before); // 거부되어 변화 없음
  });

  it("UNDO는 마지막 점 제거", () => {
    let s = build([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    s = drawReducer(s, { type: "UNDO" });
    expect(s.points).toHaveLength(1);
  });

  it("점 없을 때 UNDO는 무변화", () => {
    let s = drawReducer(initialDrawState, { type: "START" });
    s = drawReducer(s, { type: "UNDO" });
    expect(s.points).toHaveLength(0);
  });

  it("CLOSE는 3점 이상에서만 closed로 전환", () => {
    let s = build([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    s = drawReducer(s, { type: "CLOSE" });
    expect(s.status).toBe("drawing"); // 2점이라 닫기 실패

    s = drawReducer(s, { type: "ADD_POINT", point: { x: 4, y: 4 } });
    s = drawReducer(s, { type: "CLOSE" });
    expect(s.status).toBe("closed");
  });

  it("RESET은 초기상태로", () => {
    let s = build([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);
    s = drawReducer(s, { type: "RESET" });
    expect(s).toEqual(initialDrawState);
  });

  it("불변성: 원본 state 변경 안 함", () => {
    const s0 = build([{ x: 0, y: 0 }]);
    const snapshot = JSON.stringify(s0);
    drawReducer(s0, { type: "ADD_POINT", point: { x: 4, y: 0 } });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});

describe("canFinish", () => {
  it("3점 정상 폴리곤이면 true", () => {
    const s = build([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);
    expect(canFinish(s)).toBe(true);
  });
  it("2점이면 false", () => {
    const s = build([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(canFinish(s)).toBe(false);
  });
});
