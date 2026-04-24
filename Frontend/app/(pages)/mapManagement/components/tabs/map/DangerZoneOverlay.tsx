"use client";

import React from "react";
import type { DangerZone, PendingDangerZone } from "../../../types/map";
import { polygonCentroid } from "../../../utils/geometry";

type Point = { x: number; y: number };

type Props = {
  /** 저장된 위험지역 목록 */
  zones: DangerZone[];
  /** 미저장 위험지역 (pending) */
  pendingZones?: PendingDangerZone[];
  /** 그리기 중 draft 꼭짓점들 (world 좌표) */
  draftPoints?: Point[];
  /** 커서 위치 (world 좌표) — 마지막 꼭짓점 → 커서 프리뷰 선 */
  cursor?: Point | null;
  /** 현재 맵 메타 */
  mapMeta: { originX: number; originY: number; resolution: number };
  /** 이미지 크기 */
  imgSize: { w: number; h: number };
  /** 줌 (stroke/radius 역보정) */
  zoom: number;
  /** 삭제 모드 여부 — true면 폴리곤 클릭 가능 */
  deleteMode?: boolean;
  onZoneClick?: (zone: DangerZone) => void;
  onPendingZoneClick?: (zone: PendingDangerZone) => void;
};

export default function DangerZoneOverlay({
  zones,
  pendingZones = [],
  draftPoints,
  cursor,
  mapMeta,
  imgSize,
  zoom,
  deleteMode,
  onZoneClick,
  onPendingZoneClick,
}: Props) {
  const toSvgX = (wx: number) =>
    (wx - mapMeta.originX) / mapMeta.resolution - imgSize.w / 2;
  const toSvgY = (wy: number) =>
    imgSize.h - (wy - mapMeta.originY) / mapMeta.resolution - imgSize.h / 2;

  const polylinePoints = (pts: Point[]) =>
    pts.map((p) => `${toSvgX(p.x)},${toSvgY(p.y)}`).join(" ");

  return (
    <g>
      {/* 저장된 zone */}
      {zones.map((z) => {
        const pts = polylinePoints(z.points);
        const centroid = polygonCentroid(z.points);
        const cx = toSvgX(centroid.x);
        const cy = toSvgY(centroid.y);
        return (
          <g key={`dz_${z.ZoneName}`}>
            {/* 클릭 히트 (삭제 모드 전용) */}
            {deleteMode && (
              <polygon
                points={pts}
                fill="rgba(255,80,80,0.001)"
                stroke="transparent"
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onZoneClick?.(z);
                }}
              />
            )}
            <polygon
              points={pts}
              fill="rgba(255, 80, 80, 0.18)"
              stroke="rgba(255, 80, 80, 0.9)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="6 4"
              pointerEvents="none"
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#fff"
              fontSize={11}
              fontWeight={700}
              paintOrder="stroke"
              stroke="rgba(150, 0, 0, 0.85)"
              strokeWidth={3}
              transform={`translate(${cx}, ${cy}) scale(${1 / zoom}) translate(${-cx}, ${-cy})`}
              pointerEvents="none"
            >
              {z.ZoneName}
            </text>
          </g>
        );
      })}

      {/* 미저장(pending) zone — 더 옅고 점선으로 구분 */}
      {pendingZones.map((z) => {
        const pts = polylinePoints(z.points);
        const centroid = polygonCentroid(z.points);
        const cx = toSvgX(centroid.x);
        const cy = toSvgY(centroid.y);
        return (
          <g key={`dz_pending_${z.tempId}`}>
            {deleteMode && (
              <polygon
                points={pts}
                fill="rgba(255,80,80,0.001)"
                stroke="transparent"
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onPendingZoneClick?.(z);
                }}
              />
            )}
            <polygon
              points={pts}
              fill="rgba(255, 215, 0, 0.12)"
              stroke="rgba(255, 215, 0, 0.95)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 3"
              pointerEvents="none"
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#FFD700"
              fontSize={11}
              fontWeight={700}
              paintOrder="stroke"
              stroke="rgba(90, 60, 0, 0.9)"
              strokeWidth={3}
              transform={`translate(${cx}, ${cy}) scale(${1 / zoom}) translate(${-cx}, ${-cy})`}
              pointerEvents="none"
            >
              {z.ZoneName}
            </text>
          </g>
        );
      })}

      {/* 드래프트(그리는 중) */}
      {draftPoints && draftPoints.length > 0 && (
        <g pointerEvents="none">
          {/* 확정된 꼭짓점 연결선 */}
          {draftPoints.length >= 2 && (
            <polyline
              points={polylinePoints(draftPoints)}
              fill="none"
              stroke="rgba(255, 80, 80, 0.9)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="6 4"
            />
          )}
          {/* 3개 이상: 닫힘 프리뷰 — 마지막→첫 꼭짓점 점선 */}
          {draftPoints.length >= 3 && (
            <line
              x1={toSvgX(draftPoints[draftPoints.length - 1].x)}
              y1={toSvgY(draftPoints[draftPoints.length - 1].y)}
              x2={toSvgX(draftPoints[0].x)}
              y2={toSvgY(draftPoints[0].y)}
              stroke="rgba(255, 80, 80, 0.5)"
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="2 4"
            />
          )}
          {/* 커서 프리뷰 — 마지막 꼭짓점에서 커서까지 */}
          {cursor && (
            <line
              x1={toSvgX(draftPoints[draftPoints.length - 1].x)}
              y1={toSvgY(draftPoints[draftPoints.length - 1].y)}
              x2={toSvgX(cursor.x)}
              y2={toSvgY(cursor.y)}
              stroke="rgba(255, 80, 80, 0.5)"
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="3 3"
            />
          )}
          {/* 각 꼭짓점 마커 */}
          {draftPoints.map((p, i) => (
            <circle
              key={`dv_${i}`}
              cx={toSvgX(p.x)}
              cy={toSvgY(p.y)}
              r={4 / zoom}
              fill="#fff"
              stroke="rgba(200, 0, 0, 0.95)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}
    </g>
  );
}
