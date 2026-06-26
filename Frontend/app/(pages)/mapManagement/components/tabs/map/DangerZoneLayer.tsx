"use client";

// 위험구역 폴리곤 렌더링 레이어.
// 맵 SVG 의 변환 그룹(<g transform=zoom/pan/rotate>) "내부"에 배치한다.
// 좌표는 월드 → centered SVG 로 변환 (worldToSvg). place 마커와 동일한 좌표계.

import React from "react";
import type { DangerZone, ZonePoint, SvgMetaLike } from "../../../dangerZone/types";
import {
  worldToSvg,
  worldPolygonToSvgPoints,
  polygonCentroid,
} from "../../../dangerZone/geometry";

const DANGER_FILL = "rgba(232, 120, 0, 0.18)";
const DANGER_FILL_SELECTED = "rgba(232, 120, 0, 0.32)";
const DANGER_STROKE = "#e87800";
const DRAFT_STROKE = "#ff9800";

type Props = {
  /** 완성된 위험구역 목록 (이미 현재 층으로 필터링된 것 권장) */
  zones: DangerZone[];
  /** 월드 → SVG 변환 메타 */
  meta: SvgMetaLike;
  /** 줌 배율 (선/꼭짓점 크기 보정용) */
  zoom: number;
  /** 그리는 중인 폴리곤 꼭짓점 (월드) */
  draftPoints?: ZonePoint[];
  /** 마우스 커서 월드 좌표 (미리보기 선) */
  cursorWorld?: ZonePoint | null;
  /** 선택된 구역 id */
  selectedZoneId?: string | null;
  /** 구역 클릭 */
  onZoneClick?: (zone: DangerZone) => void;
  /** 라벨 표시 */
  showLabels?: boolean;
};

export default function DangerZoneLayer({
  zones,
  meta,
  zoom,
  draftPoints = [],
  cursorWorld = null,
  selectedZoneId = null,
  onZoneClick,
  showLabels = true,
}: Props) {
  const stroke = 2 / zoom;
  const vertexR = 4 / zoom;
  const fontSize = 13 / zoom;

  return (
    <g className="dangerZoneLayer">
      {/* ── 완성된 위험구역 ── */}
      {zones.map((zone) => {
        if (zone.points.length < 3) return null;
        const isSelected = zone.id === selectedZoneId;
        const pts = worldPolygonToSvgPoints(zone.points, meta);
        const c = worldToSvg(polygonCentroid(zone.points), meta);
        const dimmed = zone.status === "inactive";
        return (
          <g key={zone.id} opacity={dimmed ? 0.45 : 1}>
            <polygon
              points={pts}
              fill={isSelected ? DANGER_FILL_SELECTED : DANGER_FILL}
              stroke={DANGER_STROKE}
              strokeWidth={stroke}
              strokeDasharray={dimmed ? `${6 / zoom},${4 / zoom}` : undefined}
              style={{ cursor: onZoneClick ? "pointer" : "default" }}
              onClick={
                onZoneClick
                  ? (e) => {
                      e.stopPropagation();
                      onZoneClick(zone);
                    }
                  : undefined
              }
            />
            {showLabels && (
              <text
                x={c.x}
                y={c.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight={700}
                fill="#fff"
                stroke="rgba(0,0,0,0.7)"
                strokeWidth={3 / zoom}
                paintOrder="stroke"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {zone.name}
              </text>
            )}
          </g>
        );
      })}

      {/* ── 그리는 중인 폴리곤 ── */}
      {draftPoints.length > 0 && (
        <DraftPolygon
          points={draftPoints}
          cursorWorld={cursorWorld}
          meta={meta}
          stroke={stroke}
          vertexR={vertexR}
        />
      )}
    </g>
  );
}

function DraftPolygon({
  points,
  cursorWorld,
  meta,
  stroke,
  vertexR,
}: {
  points: ZonePoint[];
  cursorWorld: ZonePoint | null;
  meta: SvgMetaLike;
  stroke: number;
  vertexR: number;
}) {
  const svgPts = points.map((p) => worldToSvg(p, meta));
  // 진행 중 선(열린 polyline) + 커서까지 미리보기 선
  const linePts = svgPts.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`);
  const cursorSvg = cursorWorld ? worldToSvg(cursorWorld, meta) : null;

  return (
    <g className="dangerZoneDraft">
      {/* 채움 미리보기 (3점 이상) */}
      {svgPts.length >= 3 && (
        <polygon
          points={linePts.join(" ")}
          fill="rgba(255, 152, 0, 0.12)"
          stroke="none"
        />
      )}
      {/* 확정된 변 */}
      {svgPts.length >= 2 && (
        <polyline
          points={linePts.join(" ")}
          fill="none"
          stroke={DRAFT_STROKE}
          strokeWidth={stroke}
          strokeLinejoin="round"
        />
      )}
      {/* 커서까지 미리보기 선 */}
      {cursorSvg && svgPts.length >= 1 && (
        <line
          x1={svgPts[svgPts.length - 1].x}
          y1={svgPts[svgPts.length - 1].y}
          x2={cursorSvg.x}
          y2={cursorSvg.y}
          stroke={DRAFT_STROKE}
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 2},${stroke * 2}`}
          opacity={0.6}
        />
      )}
      {/* 닫힘 미리보기 선 (시작점으로) */}
      {cursorSvg && svgPts.length >= 2 && (
        <line
          x1={cursorSvg.x}
          y1={cursorSvg.y}
          x2={svgPts[0].x}
          y2={svgPts[0].y}
          stroke={DRAFT_STROKE}
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 2},${stroke * 2}`}
          opacity={0.3}
        />
      )}
      {/* 꼭짓점 */}
      {svgPts.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={vertexR}
          fill={i === 0 ? "#fff" : DRAFT_STROKE}
          stroke={DRAFT_STROKE}
          strokeWidth={stroke}
        />
      ))}
    </g>
  );
}
