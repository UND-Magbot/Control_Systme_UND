"use client";

import React, { useState, useEffect, useRef } from "react";
import type { BarChartItem } from "@/app/utils/Charts";
import styles from "./HorizontalBarChart.module.css";

type Props = {
  items: BarChartItem[];
  color: string;
  unit?: string;
  showPercent?: boolean;
  compact?: boolean;
  /** 이전 기간 비교 데이터 (같은 label 순서) */
  prevItems?: BarChartItem[];
  prevLabel?: string;
};

export default function HorizontalBarChart({
  items, color, unit = "건", showPercent = true, compact = false,
  prevItems, prevLabel = "이전",
}: Props) {
  const [show, setShow] = useState(false);
  const hasPrev = prevItems && prevItems.length > 0;

  // 현재+이전 합산 max (두 기간 같은 스케일로 비교)
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

  // label → prevItem 매핑
  const prevMap = new Map<string, BarChartItem>();
  (prevItems ?? []).forEach(p => prevMap.set(p.label, p));

  return (
    <div className={`${styles.list} ${compact ? styles.compact : ""}`}>
      {hasPrev && (
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={styles.legendBar} style={{ background: color, opacity: 0.85 }} />현재</span>
          <span className={styles.legendItem}><span className={styles.legendBar} style={{ background: color, opacity: 0.25 }} />{prevLabel}</span>
        </div>
      )}
      {items.map((item, i) => {
        const pct = item.value > 0 ? Math.max((item.value / maxVal) * 100, 3) : 0;
        const itemColor = item.color ?? color;
        const prev = prevMap.get(item.label);
        const prevPct = prev && prev.value > 0 ? Math.max((prev.value / maxVal) * 100, 3) : 0;
        const delta = prev ? item.value - prev.value : null;

        return (
          <div key={item.label} className={styles.row}>
            <div className={styles.nameGroup}>
              <span className={styles.dot} style={{ background: itemColor }} />
              <span className={styles.name}>{item.label}</span>
            </div>
            <div className={styles.trackGroup}>
              {/* 현재 기간 바 */}
              <div className={styles.track}>
                <div
                  className={styles.bar}
                  style={{
                    width: show ? `${pct}%` : "0%",
                    background: `linear-gradient(90deg, ${itemColor}, ${itemColor}cc)`,
                    transitionDelay: `${i * 0.08}s`,
                  }}
                />
              </div>
              {/* 이전 기간 바 (반투명) */}
              {hasPrev && (
                <div className={styles.track}>
                  <div
                    className={`${styles.bar} ${styles.barPrev}`}
                    style={{
                      width: show ? `${prevPct}%` : "0%",
                      background: `linear-gradient(90deg, ${itemColor}40, ${itemColor}25)`,
                      transitionDelay: `${i * 0.08 + 0.05}s`,
                    }}
                  />
                </div>
              )}
            </div>
            <div className={styles.valueGroup} style={{ color: item.value > 0 ? itemColor : "var(--text-muted)" }}>
              {item.displayValue ? (
                <span className={styles.count}>
                  {item.displayValue.split(/([hm])/).map((part, idx) =>
                    part === "h" || part === "m"
                      ? <span key={idx} className={styles.timeUnit}>{part}</span>
                      : part
                  )}
                </span>
              ) : (
                <>
                  <span className={styles.count}>{item.value.toLocaleString()}</span>
                  <span className={styles.unit}>{unit}</span>
                </>
              )}
              {showPercent && (
                <span className={styles.percent}>{item.percent.toFixed(1)}%</span>
              )}
              {delta !== null && delta !== 0 && (
                <span className={`${styles.delta} ${delta > 0 ? styles.deltaUp : styles.deltaDown}`}>
                  {delta > 0 ? "\u25B2" : "\u25BC"}{Math.abs(delta)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
