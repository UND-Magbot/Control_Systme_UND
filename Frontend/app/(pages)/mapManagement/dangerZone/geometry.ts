// 위험구역 폴리곤 기하 유틸 (순수 함수)
// page.tsx 의 좌표 변환식을 그대로 따른다.
//   World → Pixel : px = (wx - originX) / res,  py = imgH - (wy - originY) / res
//   Pixel → World : wx = px * res + originX,     wy = (imgH - py) * res + originY
//   Pixel → SVG   : svgX = px - imgW/2,          svgY = py - imgH/2

import type { ZonePoint, MapMetaLike, SvgMetaLike } from "./types";

const EPS = 1e-9;

/** 부호있는 면적 (shoelace). 반시계(CCW)=양수, 시계(CW)=음수 */
export function signedArea(polygon: ZonePoint[]): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** 폴리곤 면적 (절댓값, 단위: 입력 좌표계의 제곱) */
export function polygonArea(polygon: ZonePoint[]): number {
  return Math.abs(signedArea(polygon));
}

/** 폴리곤 둘레 길이 (닫힌 폴리곤 기준) */
export function polygonPerimeter(polygon: ZonePoint[]): number {
  const n = polygon.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

/** 폴리곤 무게중심 (면적가중 centroid). 면적이 0이면 꼭짓점 평균 반환 */
export function polygonCentroid(polygon: ZonePoint[]): ZonePoint {
  const n = polygon.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { ...polygon[0] };

  const area = signedArea(polygon);
  if (Math.abs(area) < EPS) {
    // 퇴화(직선/점) — 단순 평균
    const avg = polygon.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 }
    );
    return { x: avg.x / n, y: avg.y / n };
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const factor = 1 / (6 * area);
  return { x: cx * factor, y: cy * factor };
}

/**
 * 점이 폴리곤 내부에 있는지 (ray casting).
 * 경계선 위의 점은 inside=true 로 본다.
 */
export function pointInPolygon(point: ZonePoint, polygon: ZonePoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  // 먼저 경계 위 판정
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (distancePointToSegment(point, a, b) < EPS) return true;
  }

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersect =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 점-선분 최단거리 */
export function distancePointToSegment(
  p: ZonePoint,
  a: ZonePoint,
  b: ZonePoint
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** 점에서 폴리곤 경계(가장 가까운 변)까지의 최단거리 */
export function distancePointToPolygonEdge(
  p: ZonePoint,
  polygon: ZonePoint[]
): number {
  const n = polygon.length;
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(p.x - polygon[0].x, p.y - polygon[0].y);
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const d = distancePointToSegment(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

/** 방향(orientation): 0=일직선, 1=시계, 2=반시계 */
function orientation(p: ZonePoint, q: ZonePoint, r: ZonePoint): number {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(val) < EPS) return 0;
  return val > 0 ? 1 : 2;
}

/** r 이 선분 pq 위에 있는지 (공선 상태에서) */
function onSegment(p: ZonePoint, q: ZonePoint, r: ZonePoint): boolean {
  return (
    q.x <= Math.max(p.x, r.x) + EPS &&
    q.x >= Math.min(p.x, r.x) - EPS &&
    q.y <= Math.max(p.y, r.y) + EPS &&
    q.y >= Math.min(p.y, r.y) - EPS
  );
}

/**
 * 두 선분 (p1-p2), (p3-p4) 가 교차하는지.
 * 끝점 공유/공선 겹침 포함(proper + improper).
 */
export function segmentsIntersect(
  p1: ZonePoint,
  p2: ZonePoint,
  p3: ZonePoint,
  p4: ZonePoint
): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  if (o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;

  return false;
}

/**
 * 폴리곤이 자기교차(단순하지 않음)하는지.
 * 인접한 변(끝점 공유)은 정상으로 보고, 비인접 변끼리 교차할 때만 true.
 */
export function isSelfIntersecting(polygon: ZonePoint[]): boolean {
  const n = polygon.length;
  if (n < 4) return false; // 삼각형 이하는 자기교차 불가

  const edges: [ZonePoint, ZonePoint][] = [];
  for (let i = 0; i < n; i++) {
    edges.push([polygon[i], polygon[(i + 1) % n]]);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // 인접 변(끝점 공유) 건너뛰기
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const [a1, a2] = edges[i];
      const [b1, b2] = edges[j];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// ────────────────────────── 좌표 변환 ──────────────────────────

/** 월드 → 이미지 픽셀 좌표 */
export function worldToPixel(
  w: ZonePoint,
  meta: MapMetaLike
): { px: number; py: number } {
  return {
    px: (w.x - meta.originX) / meta.resolution,
    py: meta.imgHeight - (w.y - meta.originY) / meta.resolution,
  };
}

/** 이미지 픽셀 → 월드 좌표 */
export function pixelToWorld(
  px: number,
  py: number,
  meta: MapMetaLike
): ZonePoint {
  return {
    x: px * meta.resolution + meta.originX,
    y: (meta.imgHeight - py) * meta.resolution + meta.originY,
  };
}

/** 월드 점 → centered SVG 좌표 (px - w/2, py - h/2) */
export function worldToSvg(
  w: ZonePoint,
  meta: SvgMetaLike
): { x: number; y: number } {
  const { px, py } = worldToPixel(w, meta);
  return { x: px - meta.imgWidth / 2, y: py - meta.imgHeight / 2 };
}

/** 월드 폴리곤 → SVG polygon points 속성 문자열 ("x1,y1 x2,y2 ...") */
export function worldPolygonToSvgPoints(
  polygon: ZonePoint[],
  meta: SvgMetaLike
): string {
  return polygon
    .map((p) => {
      const { x, y } = worldToSvg(p, meta);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
