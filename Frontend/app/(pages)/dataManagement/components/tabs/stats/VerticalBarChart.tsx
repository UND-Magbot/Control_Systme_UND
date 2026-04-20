"use client";

import React, { useState, useEffect, useRef } from "react";
import type { BarChartItem } from "@/app/utils/Charts";
import styles from "./VerticalBarChart.module.css";

type Props = {
  items: BarChartItem[];
  color: string;
  unit?: string;
  prevItems?: BarChartItem[];
  prevLabel?: string;
};

export default function VerticalBarChart({
  items, color, unit = "건", prevItems, prevLabel = "이전",
}: Props) {
  const [show, setShow] = useState(false);
  const hasPrev = prevItems && prevItems.length > 0;

  const allValues = [...items.map(i => i.value), ...(prevItems ?? []).map(i => i.value)];
  const maxVal = Math.max(...allValues, 1);

  const prevKey = useRef("");
  const itemsKey = items.map(i => `${i.label}:${i.value}`).join(",")
    + (prevItems ? "|" + prevItems.map(i => `${i.label}:${i.value}`).join(",") : "");

  useEffect(() => {
    if (prevKey.current === itemsKey) return;
    prevKey.current = itemsKey;
    setShow(false);
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, [itemsKey]);

  const prevMap = new Map<string, BarChartItem>();
  (prevItems ?? []).forEach(p => prevMap.set(p.label, p));

  return (
    <div className={styles.wrapper}>
      {hasPrev && (
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendBox} style={{ background: color, opacity: 0.85 }} />현재
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendBox} style={{ background: color, opacity: 0.2 }} />{prevLabel}
          </span>
        </div>
      )}
      <div className={styles.chartArea}>
        {items.map((item, i) => {
          const pct = item.value > 0 ? Math.max((item.value / maxVal) * 100, 4) : 0;
          const itemColor = item.color ?? color;
          const prev = prevMap.get(item.label);
          const prevPct = prev && prev.value > 0 ? Math.max((prev.value / maxVal) * 100, 4) : 0;
          const delta = prev ? item.value - prev.value : null;

          return (
            <div key={item.label} className={styles.col}>
              <div className={styles.barArea}>
                {/* baseline (최소 높이 표시) */}
                <div className={styles.baseline} />
                {/* 이전 기간 바 */}
                {hasPrev && (
                  <div className={styles.barWrap}>
                    <div
                      className={`${styles.bar} ${styles.barPrev}`}
                      style={{
                        height: show ? (prevPct > 0 ? `${prevPct}%` : "3px") : "0%",
                        background: prevPct > 0 ? `${itemColor}30` : "rgba(255,255,255,0.04)",
                        transitionDelay: `${i * 0.08 + 0.05}s`,
                      }}
                    />
                  </div>
                )}
                {/* 현재 기간 바 */}
                <div className={styles.barWrap}>
                  <div
                    className={styles.bar}
                    style={{
                      height: show ? (pct > 0 ? `${pct}%` : "3px") : "0%",
                      background: pct > 0
                        ? `linear-gradient(0deg, ${itemColor}cc, ${itemColor})`
                        : "rgba(255,255,255,0.06)",
                      transitionDelay: `${i * 0.08}s`,
                    }}
                  />
                </div>
              </div>
              {/* 값 */}
              <div className={styles.value} style={{ color: item.value > 0 ? itemColor : "var(--text-muted)" }}>
                {item.displayValue ? (
                  <span>{item.displayValue}</span>
                ) : (
                  <span>{item.value.toLocaleString()}<span className={styles.unit}>{unit}</span></span>
                )}
              </div>
              {/* 라벨 */}
              <div className={styles.label}>
                <span>{item.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
