import { describe, it, expect } from "vitest";
import {
  signedArea,
  polygonArea,
  polygonPerimeter,
  polygonCentroid,
  pointInPolygon,
  distancePointToSegment,
  distancePointToPolygonEdge,
  segmentsIntersect,
  isSelfIntersecting,
  worldToPixel,
  pixelToWorld,
  worldToSvg,
  worldPolygonToSvgPoints,
} from "../geometry";
import type { ZonePoint, SvgMetaLike } from "../types";

const square: ZonePoint[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe("signedArea / polygonArea", () => {
  it("CCW 사각형은 양의 부호면적", () => {
    expect(signedArea(square)).toBeCloseTo(16);
  });
  it("CW 사각형은 음의 부호면적", () => {
    expect(signedArea([...square].reverse())).toBeCloseTo(-16);
  });
  it("절대면적은 방향 무관", () => {
    expect(polygonArea(square)).toBeCloseTo(16);
    expect(polygonArea([...square].reverse())).toBeCloseTo(16);
  });
  it("점이 3개 미만이면 면적 0", () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
  it("삼각형 면적", () => {
    const tri: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ];
    expect(polygonArea(tri)).toBeCloseTo(6);
  });
});

describe("polygonPerimeter", () => {
  it("4x4 사각형 둘레는 16", () => {
    expect(polygonPerimeter(square)).toBeCloseTo(16);
  });
});

describe("polygonCentroid", () => {
  it("사각형 무게중심은 (2,2)", () => {
    const c = polygonCentroid(square);
    expect(c.x).toBeCloseTo(2);
    expect(c.y).toBeCloseTo(2);
  });
  it("퇴화(공선) 폴리곤은 꼭짓점 평균", () => {
    const c = polygonCentroid([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(c.x).toBeCloseTo(2);
    expect(c.y).toBeCloseTo(0);
  });
});

describe("pointInPolygon", () => {
  it("내부 점은 true", () => {
    expect(pointInPolygon({ x: 2, y: 2 }, square)).toBe(true);
  });
  it("외부 점은 false", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 2 }, square)).toBe(false);
  });
  it("경계 위 점은 true", () => {
    expect(pointInPolygon({ x: 0, y: 2 }, square)).toBe(true);
    expect(pointInPolygon({ x: 4, y: 4 }, square)).toBe(true);
  });
  it("점 3개 미만 폴리곤은 항상 false", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false);
  });
  it("오목(concave) 폴리곤의 홈 안쪽은 외부", () => {
    // ㄷ자 모양: (0,0)(4,0)(4,4)(3,4)(3,1)(1,1)(1,4)(0,4)
    const concave: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(pointInPolygon({ x: 2, y: 3 }, concave)).toBe(false); // 홈 안
    expect(pointInPolygon({ x: 2, y: 0.5 }, concave)).toBe(true); // 바닥부
  });
});

describe("distancePointToSegment", () => {
  it("선분 위로의 수직거리", () => {
    expect(
      distancePointToSegment({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 })
    ).toBeCloseTo(3);
  });
  it("끝점 너머는 끝점까지 거리", () => {
    expect(
      distancePointToSegment({ x: 6, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 })
    ).toBeCloseTo(2);
  });
  it("길이 0 선분은 점까지 거리", () => {
    expect(
      distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    ).toBeCloseTo(5);
  });
});

describe("distancePointToPolygonEdge", () => {
  it("내부 점도 가장 가까운 변까지 거리", () => {
    expect(distancePointToPolygonEdge({ x: 1, y: 2 }, square)).toBeCloseTo(1);
  });
  it("외부 점의 경계 거리", () => {
    expect(distancePointToPolygonEdge({ x: 6, y: 2 }, square)).toBeCloseTo(2);
  });
});

describe("segmentsIntersect", () => {
  it("교차하는 X자", () => {
    expect(
      segmentsIntersect(
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 4, y: 0 }
      )
    ).toBe(true);
  });
  it("교차하지 않는 평행선", () => {
    expect(
      segmentsIntersect(
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 1 },
        { x: 4, y: 1 }
      )
    ).toBe(false);
  });
  it("끝점 공유(T자)", () => {
    expect(
      segmentsIntersect(
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 }
      )
    ).toBe(true);
  });
});

describe("isSelfIntersecting", () => {
  it("정상 사각형은 자기교차 아님", () => {
    expect(isSelfIntersecting(square)).toBe(false);
  });
  it("나비넥타이(bowtie)는 자기교차", () => {
    const bowtie: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ];
    expect(isSelfIntersecting(bowtie)).toBe(true);
  });
  it("삼각형 이하는 자기교차 불가", () => {
    expect(
      isSelfIntersecting([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ])
    ).toBe(false);
  });
});

describe("좌표 변환 (worldToPixel / pixelToWorld)", () => {
  const meta = { originX: -10, originY: -5, resolution: 0.05, imgHeight: 400 };

  it("world→pixel→world 왕복 일치", () => {
    const w: ZonePoint = { x: 3.25, y: 1.5 };
    const { px, py } = worldToPixel(w, meta);
    const back = pixelToWorld(px, py, meta);
    expect(back.x).toBeCloseTo(w.x);
    expect(back.y).toBeCloseTo(w.y);
  });

  it("page.tsx 공식과 동일: px=(wx-originX)/res, py=imgH-(wy-originY)/res", () => {
    const { px, py } = worldToPixel({ x: 0, y: 0 }, meta);
    expect(px).toBeCloseTo((0 - -10) / 0.05); // 200
    expect(py).toBeCloseTo(400 - (0 - -5) / 0.05); // 400 - 100 = 300
  });
});

describe("worldToSvg / worldPolygonToSvgPoints", () => {
  const meta: SvgMetaLike = {
    originX: 0,
    originY: 0,
    resolution: 1,
    imgWidth: 4,
    imgHeight: 4,
  };
  it("centered svg 좌표 (px-w/2, py-h/2)", () => {
    // world(0,0) → px=0, py=4 → svg(-2, 2)
    const s = worldToSvg({ x: 0, y: 0 }, meta);
    expect(s.x).toBeCloseTo(-2);
    expect(s.y).toBeCloseTo(2);
  });
  it("polygon points 문자열 포맷", () => {
    const str = worldPolygonToSvgPoints(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      meta
    );
    expect(str).toBe("-2.00,2.00 2.00,2.00");
  });
});
