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

export default function DonutWithLegend({
  items, colors, centerLabel, centerValue, centerUnit = "", unit = "건", prevItems,
}: Props) {
  const total = items.reduce((s, i) => s + i.value, 0);

  // conic-gradient
  let gradientParts: string[] = [];
  let angle = 0;
  if (total > 0) {
    items.forEach((item, i) => {
      const deg = (item.value / total) * 360;
      gradientParts.push(`${colors[i] ?? "#888"} ${angle}deg ${angle + deg}deg`);
      angle += deg;
    });
  } else {
    // 0일 때 — 비어있는 도넛 링 (줄무늬 패턴으로 빈 상태 표현)
    gradientParts.push("rgba(255,255,255,0.05) 0deg 360deg");
  }

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
