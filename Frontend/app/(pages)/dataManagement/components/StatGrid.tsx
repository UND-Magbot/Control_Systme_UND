"use client";

import React from "react";
import type { BarChartItem } from "@/app/utils/Charts";
import styles from "./StatGrid.module.css";

type Props = {
  items: BarChartItem[];
  colors: string[];
  unit?: string;
  prevItems?: BarChartItem[];
};

export default function StatGrid({ items, colors, unit = "건", prevItems }: Props) {
  const total = items.reduce((s, i) => s + i.value, 0);

  const prevMap = new Map<string, BarChartItem>();
  (prevItems ?? []).forEach(p => prevMap.set(p.label, p));

  return (
    <div className={styles.grid}>
      {items.map((item, i) => {
        const itemColor = item.color ?? colors[i] ?? "#888";
        const prev = prevMap.get(item.label);
        const delta = prev ? item.value - prev.value : null;
        const pct = total > 0 ? (item.value / total) * 100 : 0;

        return (
          <div key={item.label} className={styles.card}>
            {/* 상단: dot + 라벨 */}
            <div className={styles.cardHead}>
              <span className={styles.dot} style={{ background: item.value > 0 ? itemColor : "rgba(255,255,255,0.12)" }} />
              <span className={styles.label}>{item.label}</span>
            </div>

            {/* 중앙: 큰 값 */}
            <div className={styles.valueRow}>
              <span className={styles.value} style={{ color: item.value > 0 ? itemColor : "var(--text-muted)" }}>
                {item.displayValue ?? item.value.toLocaleString()}
              </span>
              <span className={styles.unit} style={{ color: item.value > 0 ? itemColor : "var(--text-muted)" }}>{item.displayValue ? "" : unit}</span>
            </div>

            {/* 하단: 비율바 + % + 델타 */}
            <div className={styles.cardFoot}>
              <div className={styles.miniBar}>
                <div
                  className={styles.miniBarFill}
                  style={{ width: `${pct}%`, background: item.value > 0 ? itemColor : "transparent" }}
                />
              </div>
              <div className={styles.footValues}>
                <span className={styles.percent}>{item.percent.toFixed(1)}%</span>
                {delta !== null && delta !== 0 && (
                  <span className={`${styles.delta} ${delta > 0 ? styles.deltaUp : styles.deltaDown}`}>
                    {delta > 0 ? "\u25B2" : "\u25BC"}{Math.abs(delta)}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
