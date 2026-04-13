"use client";

import React, { useState, useEffect, useRef } from "react";
import type { BarChartItem } from "@/app/utils/Charts";
import styles from "./StackedBar.module.css";

type Props = {
  items: BarChartItem[];
  colors: string[];
  prevItems?: BarChartItem[];
  prevLabel?: string;
};

export default function StackedBar({ items, colors, prevItems, prevLabel = "이전" }: Props) {
  const [show, setShow] = useState(false);
  const hasPrev = prevItems && prevItems.length > 0;

  const prevKey = useRef("");
  const itemsKey = items.map(i => `${i.label}:${i.value}`).join(",");
  useEffect(() => {
    if (prevKey.current === itemsKey) return;
    prevKey.current = itemsKey;
    setShow(false);
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, [itemsKey]);

  const total = items.reduce((s, i) => s + i.value, 0);
  const prevTotal = prevItems?.reduce((s, i) => s + i.value, 0) ?? 0;

  return (
    <div className={styles.wrapper}>
      {/* 세로 바 + 범례 영역 */}
      <div className={styles.chartRow}>
        {/* 세로 stacked bar들 */}
        <div className={styles.barGroup}>
          {/* 현재 기간 */}
          <div className={styles.barCol}>
            <div className={styles.vTrack}>
              {[...items].reverse().map((item, i) => {
                const ri = items.length - 1 - i;
                const pct = total > 0 ? (item.value / total) * 100 : 0;
                return (
                  <div
                    key={item.label}
                    className={styles.vSegment}
                    style={{
                      height: show ? `${pct}%` : "0%",
                      background: colors[ri] ?? "#888",
                      transitionDelay: `${ri * 0.06}s`,
                    }}
                  />
                );
              })}
            </div>
            <span className={styles.barColLabel}>현재</span>
          </div>

          {/* 이전 기간 */}
          {hasPrev && (
            <div className={styles.barCol}>
              <div className={styles.vTrack}>
                {[...(prevItems ?? [])].reverse().map((item, i) => {
                  const ri = (prevItems ?? []).length - 1 - i;
                  const pct = prevTotal > 0 ? (item.value / prevTotal) * 100 : 0;
                  return (
                    <div
                      key={item.label}
                      className={`${styles.vSegment} ${styles.vSegmentPrev}`}
                      style={{
                        height: show ? `${pct}%` : "0%",
                        background: `${colors[ri] ?? "#888"}50`,
                        transitionDelay: `${ri * 0.06 + 0.1}s`,
                      }}
                    />
                  );
                })}
              </div>
              <span className={styles.barColLabel}>{prevLabel}</span>
            </div>
          )}
        </div>

        {/* 항목별 수치 */}
        <div className={styles.details}>
          {items.map((item, i) => {
            const prev = prevItems?.[i];
            const delta = prev ? item.value - prev.value : null;
            return (
              <div key={item.label} className={styles.detailItem}>
                <span className={styles.detailDot} style={{ background: colors[i] ?? "#888" }} />
                <span className={styles.detailLabel}>{item.label}</span>
                <span className={styles.detailValue} style={{ color: item.value > 0 ? (colors[i] ?? "#888") : "var(--text-muted)" }}>
                  {item.displayValue ?? `${item.value.toLocaleString()}`}
                </span>
                <span className={styles.detailPercent}>{item.percent.toFixed(1)}%</span>
                {delta !== null && delta !== 0 && (
                  <span className={`${styles.detailDelta} ${delta > 0 ? styles.deltaUp : styles.deltaDown}`}>
                    {delta > 0 ? "\u25B2" : "\u25BC"}{Math.abs(delta)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
