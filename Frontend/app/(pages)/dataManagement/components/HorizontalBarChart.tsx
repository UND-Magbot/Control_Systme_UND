"use client";

import React, { useState, useEffect, useRef } from "react";
import type { BarChartItem } from "@/app/utils/Charts";
import styles from "./HorizontalBarChart.module.css";

type Props = {
  items: BarChartItem[];
  color: string;
  unit?: string;
};

export default function HorizontalBarChart({ items, color, unit = "건" }: Props) {
  const [show, setShow] = useState(false);
  const maxVal = Math.max(...items.map((i) => i.value), 1);

  // items 내용이 실제로 바뀔 때만 애니메이션 재실행
  const prevKey = useRef("");
  const itemsKey = items.map(i => `${i.label}:${i.value}`).join(",");

  useEffect(() => {
    if (prevKey.current === itemsKey) return;
    prevKey.current = itemsKey;
    setShow(false);
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, [itemsKey]);

  return (
    <div className={styles.list}>
      {items.map((item, i) => {
        const pct = item.value > 0 ? Math.max((item.value / maxVal) * 100, 3) : 0;
        const itemColor = item.color ?? color;
        return (
          <div key={item.label} className={styles.row}>
            <span className={styles.name}>{item.label}</span>
            <div className={styles.track}>
              <div
                className={styles.bar}
                style={{
                  width: show ? `${pct}%` : "0%",
                  background: itemColor,
                  transitionDelay: `${i * 0.08}s`,
                }}
              />
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
