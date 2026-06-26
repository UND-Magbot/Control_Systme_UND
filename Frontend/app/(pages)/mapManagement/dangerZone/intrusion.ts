// 로봇의 위험구역 침입/근접 감지 (순수 함수)

import type { DangerZone, ZonePoint } from "./types";
import { pointInPolygon, distancePointToPolygonEdge } from "./geometry";

/** 침입 판정 상태 */
export type IntrusionLevel = "inside" | "warning" | "safe";

export type ZoneProximity = {
  zoneId: string;
  zoneName: string;
  level: IntrusionLevel;
  /** 경계까지 최단거리(m). inside면 0, 그 외엔 양수 */
  distance: number;
};

export type IntrusionReport = {
  /** 어느 한 구역이라도 내부에 있으면 true */
  intruding: boolean;
  /** warning 이상(내부 또는 경고거리 이내)이 하나라도 있으면 true */
  warning: boolean;
  /** 구역별 상세 (가까운 순 정렬) */
  zones: ZoneProximity[];
};

export type IntrusionOptions = {
  /** 경고 거리(m). 경계로부터 이 거리 이내면 warning. 기본 0.5 */
  warningDistance?: number;
  /** inactive 구역도 평가할지. 기본 false (활성만) */
  includeInactive?: boolean;
};

const DEFAULT_WARNING_DISTANCE = 0.5;

/** 단일 점-구역 근접 평가 */
export function evaluateZone(
  point: ZonePoint,
  zone: DangerZone,
  warningDistance = DEFAULT_WARNING_DISTANCE
): ZoneProximity {
  if (zone.points.length >= 3 && pointInPolygon(point, zone.points)) {
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      level: "inside",
      distance: 0,
    };
  }
  const distance = distancePointToPolygonEdge(point, zone.points);
  const level: IntrusionLevel =
    distance <= warningDistance ? "warning" : "safe";
  return { zoneId: zone.id, zoneName: zone.name, level, distance };
}

/**
 * 로봇 위치가 여러 위험구역에 대해 어떤 상태인지 종합 평가.
 * 같은 층 필터링은 호출부 책임(이미 같은 층 zones만 넘기는 것을 권장).
 */
export function detectIntrusions(
  robot: ZonePoint,
  zones: DangerZone[],
  options: IntrusionOptions = {}
): IntrusionReport {
  const warningDistance = options.warningDistance ?? DEFAULT_WARNING_DISTANCE;
  const includeInactive = options.includeInactive ?? false;

  const target = zones.filter(
    (z) => (includeInactive || z.status === "active") && z.points.length >= 3
  );

  const results = target.map((z) => evaluateZone(robot, z, warningDistance));
  results.sort((a, b) => a.distance - b.distance);

  return {
    intruding: results.some((r) => r.level === "inside"),
    warning: results.some((r) => r.level !== "safe"),
    zones: results,
  };
}
