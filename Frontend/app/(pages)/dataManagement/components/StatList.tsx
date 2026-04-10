"use client";

import React, { useState, useEffect, useRef } from "react";
import type { BarChartItem } from "@/app/utils/Charts";
import styles from "./StatList.module.css";

type Props = {
  items: BarChartItem[];
  color: string;
  unit?: string;
  prevItems?: BarChartItem[];
  prevLabel?: string;
};

export default function StatList({
  items, color, unit = "건", prevItems, prevLabel = "이전",
}: Props) {
  const [show, setShow] = useState(false);
  const maxVal = Math.max(...items.map(i => i.value), 1);

  const prevKey = useRef("");
  const itemsKey = items.map(i => `${i.label}:${i.value}`).join(",");
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
    <div className={styles.list}>
      {items.map((item, i) => {
        const pct = item.value > 0 ? Math.max((item.value / maxVal) * 100, 3) : 0;
        const itemColor = item.color ?? color;
        const prev = prevMap.get(item.label);
        const delta = prev ? item.value - prev.value : null;

        return (
          <div key={item.label} className={styles.row}>
            {/* 좌: dot + 라벨 */}
            <div className={styles.labelArea}>
              <span className={styles.dot} style={{ background: item.value > 0 ? itemColor : "rgba(255,255,255,0.1)" }} />
              <span className={styles.label}>{item.label}</span>
            </div>

            {/* 중: 인라인 바 */}
            <div className={styles.barTrack}>
              <div
                className={styles.bar}
                style={{
                  width: show ? `${pct}%` : "0%",
                  background: item.value > 0
                    ? `linear-gradient(90deg, ${itemColor}, ${itemColor}aa)`
                    : "rgba(255,255,255,0.04)",
                  transitionDelay: `${i * 0.06}s`,
                }}
              />
            </div>

            {/* 우: 값 + % + 델타 */}
            <div className={styles.valueArea}>
              <span className={styles.value} style={{ color: item.value > 0 ? itemColor : "var(--text-muted)" }}>
                {item.displayValue ?? `${item.value.toLocaleString()}`}
                <span className={styles.unit}>{item.displayValue ? "" : unit}</span>
              </span>
              <span className={styles.percent}>{item.percent.toFixed(1)}%</span>
              {delta !== null && delta !== 0 ? (
                <span className={`${styles.delta} ${delta > 0 ? styles.deltaUp : styles.deltaDown}`}>
                  {delta > 0 ? "\u25B2" : "\u25BC"}{Math.abs(delta)}
                </span>
              ) : (
                <span className={styles.deltaEmpty} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
