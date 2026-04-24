"use client";

import React from "react";
import type { BarChartItem } from "@/app/utils/Charts";
import styles from "./DonutWithLegend.module.css";

type Props = {
  items: BarChartItem[];
  colors: string[];
  centerLabel?: string;
  centerValue?: string;
  centerUnit?: string;
  unit?: string;
  prevItems?: BarChartItem[];
};

// 링 내부 라벨을 표시할 최소 퍼센트. 이 미만인 조각은 바깥 leader line 으로 처리.
const INNER_LABEL_THRESHOLD_PCT = 8;
// 도넛 중심(50%, 50%) 기준 거리(%). 아래 값들은 .donut 컨테이너의 너비/높이 비율.
const RING_CENTER_RADIUS = 39.5; // 링 두께의 중앙 (내부 라벨 위치)
const LEADER_START_RADIUS = 50;  // 링 바깥 가장자리 (leader line 시작점)
const OUTER_LABEL_RADIUS = 66;   // 외부 라벨 중심의 반경
const OUTER_LABEL_MIN_ANGLE_GAP = 22; // 인접 외부 라벨 사이 최소 각도(deg)
const OUTER_LABEL_MAX_ANGLE_SHIFT = 35; // 자연 위치 대비 허용 이동 한도(deg)
const LEADER_GAP = 4; // leader line 과 라벨 사이 공간(%)

/** 도넛 각도(12시 기준 시계방향, deg) + 중심거리(%) → 컨테이너 내부 위치(%) */
function polar(angleDeg: number, radiusPct: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: 50 + radiusPct * Math.cos(rad),
    y: 50 + radiusPct * Math.sin(rad),
  };
}

type OuterSegment = { item: BarChartItem; color: string; midAngle: number };
type OuterLayout = {
  seg: OuterSegment;
  labelX: number;
  labelY: number;
  leaderEndX: number;
  leaderEndY: number;
  startX: number;
  startY: number;
};

/** 외부 라벨을 조각 근처의 자연스러운 각도 위치에 놓되, 인접 라벨이 겹치면 원호를 따라 밀어서 벌린다. */
function layoutOuterLabels(outerSegs: OuterSegment[]): OuterLayout[] {
  if (outerSegs.length === 0) return [];

  // midAngle 기준 오름차순 — 원형을 시계방향 순서로 처리
  const sorted = [...outerSegs].sort((a, b) => a.midAngle - b.midAngle);
  const natural = sorted.map(s => s.midAngle);
  const display = [...natural];

  // forward cascade: 뒤쪽 라벨을 앞으로 밀어 최소 간격 확보
  for (let i = 1; i < display.length; i++) {
    const minAngle = display[i - 1] + OUTER_LABEL_MIN_ANGLE_GAP;
    if (display[i] < minAngle) {
      // 자연 위치에서 너무 많이 벗어나지 않도록 제한
      display[i] = Math.min(minAngle, natural[i] + OUTER_LABEL_MAX_ANGLE_SHIFT);
    }
  }

  // 마지막 → 처음의 wrap 간격이 부족하면 앞쪽 라벨들을 조금 뒤로 당김
  if (display.length >= 2) {
    const wrapGap = (display[0] + 360) - display[display.length - 1];
    if (wrapGap < OUTER_LABEL_MIN_ANGLE_GAP) {
      const deficit = OUTER_LABEL_MIN_ANGLE_GAP - wrapGap;
      // 첫 라벨을 자연 위치보다 최대 MAX_SHIFT 만큼 앞으로(작게) 이동
      const shiftable = Math.min(deficit, OUTER_LABEL_MAX_ANGLE_SHIFT);
      display[0] = natural[0] - shiftable;
      // 재-cascade
      for (let i = 1; i < display.length; i++) {
        const minAngle = display[i - 1] + OUTER_LABEL_MIN_ANGLE_GAP;
        if (display[i] < minAngle) {
          display[i] = Math.min(minAngle, natural[i] + OUTER_LABEL_MAX_ANGLE_SHIFT);
        }
      }
    }
  }

  return sorted.map((seg, i) => {
    const displayAngle = display[i];
    const labelPos = polar(displayAngle, OUTER_LABEL_RADIUS);
    const start = polar(seg.midAngle, LEADER_START_RADIUS);
    // leader 끝점을 라벨 직전에서 끊기 — (label - start) 방향으로 LEADER_GAP 만큼 떨어진 점
    const dx = labelPos.x - start.x;
    const dy = labelPos.y - start.y;
    const dist = Math.hypot(dx, dy) || 1;
    const endX = labelPos.x - (dx / dist) * LEADER_GAP;
    const endY = labelPos.y - (dy / dist) * LEADER_GAP;
    return {
      seg,
      labelX: labelPos.x,
      labelY: labelPos.y,
      leaderEndX: endX,
      leaderEndY: endY,
      startX: start.x,
      startY: start.y,
    };
  });
}

export default function DonutWithLegend({
  items, colors, centerLabel, centerValue, centerUnit = "", unit = "건", prevItems,
}: Props) {
  const total = items.reduce((s, i) => s + i.value, 0);

  // conic-gradient + 각 조각 중간 각도 계산
  const segments: { item: BarChartItem; color: string; midAngle: number }[] = [];
  let gradientParts: string[] = [];
  let angle = 0;
  if (total > 0) {
    items.forEach((item, i) => {
      const deg = (item.value / total) * 360;
      const color = colors[i] ?? "#888";
      gradientParts.push(`${color} ${angle}deg ${angle + deg}deg`);
      if (item.value > 0) {
        segments.push({ item, color, midAngle: angle + deg / 2 });
      }
      angle += deg;
    });
  } else {
    // 0일 때 — 비어있는 도넛 링 (줄무늬 패턴으로 빈 상태 표현)
    gradientParts.push("rgba(255,255,255,0.05) 0deg 360deg");
  }

  // 내부/외부 라벨 분리
  const innerSegs = segments.filter(s => s.item.percent >= INNER_LABEL_THRESHOLD_PCT);
  const outerSegs = segments.filter(s => s.item.percent < INNER_LABEL_THRESHOLD_PCT);
  // 외부 라벨은 자연 각도 위치에 배치 + 겹침 시 원호를 따라 벌림
  const outerLayouts: OuterLayout[] = layoutOuterLabels(outerSegs);

  const prevMap = new Map<string, BarChartItem>();
  (prevItems ?? []).forEach(p => prevMap.set(p.label, p));

  return (
    <div className={styles.wrapper}>
      {/* 도넛 */}
      <div className={styles.donutArea}>
        <div
          className={`${styles.donut} ${total === 0 ? styles.donutEmpty : ""}`}
          style={{ backgroundImage: `conic-gradient(${gradientParts.join(", ")})` }}
        >
          {/* Leader lines (작은 조각용 — 조각 가장자리에서 라벨로 이어지는 직선) */}
          {outerLayouts.length > 0 && (
            <svg className={styles.leaderSvg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {outerLayouts.map(l => (
                <line
                  key={l.seg.item.label}
                  x1={l.startX} y1={l.startY}
                  x2={l.leaderEndX} y2={l.leaderEndY}
                  stroke={l.seg.color}
                  strokeWidth={0.5}
                  strokeLinecap="round"
                />
              ))}
            </svg>
          )}

          {/* 내부 라벨 (큰 조각) */}
          {innerSegs.map(seg => {
            const { x, y } = polar(seg.midAngle, RING_CENTER_RADIUS);
            return (
              <span
                key={seg.item.label}
                className={styles.sliceLabelInner}
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                {seg.item.percent.toFixed(1)}%
              </span>
            );
          })}

          {/* 외부 라벨 (작은 조각) */}
          {outerLayouts.map(l => (
            <span
              key={l.seg.item.label}
              className={styles.sliceLabelOuter}
              style={{ left: `${l.labelX}%`, top: `${l.labelY}%`, color: l.seg.color }}
            >
              {l.seg.item.percent.toFixed(1)}%
            </span>
          ))}

          <div className={styles.donutHole}>
            {centerLabel && <div className={styles.centerLabel}>{centerLabel}</div>}
            {centerValue && (
              <div className={styles.centerValue} style={{ color: total > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
                {centerValue}
                {centerUnit && <span className={styles.centerUnit}>{centerUnit}</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 범례 리스트 */}
      <div className={styles.legendList}>
        {items.map((item, i) => {
          const prev = prevMap.get(item.label);
          const delta = prev ? item.value - prev.value : null;
          return (
            <div key={item.label} className={styles.legendRow}>
              <span className={styles.legendDot} style={{ background: item.value > 0 ? (colors[i] ?? "#888") : "rgba(255,255,255,0.1)" }} />
              <span className={styles.legendLabel}>{item.label}</span>
              <span className={styles.legendValue} style={{ color: item.value > 0 ? colors[i] : "var(--text-muted)" }}>
                {item.value.toLocaleString()}<span className={styles.legendUnit}>{unit}</span>
              </span>
              <span className={styles.legendPercent}>{item.percent.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
