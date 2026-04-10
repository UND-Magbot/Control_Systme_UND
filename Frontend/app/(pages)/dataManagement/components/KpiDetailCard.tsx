"use client";

import React from "react";
import type { BarChartItem } from "@/app/utils/Charts";
import styles from "./KpiDetailCard.module.css";

type Props = {
  title: string;
  color: string;
  total: string;
  totalUnit?: string;
  /** 우측 큰 비율 (예: 성공률 64%) */
  rate?: number | null;
  rateLabel?: string;
  /** 전기간 대비 델타 */
  delta?: { value: string; isUp: boolean; label: string } | null;
  /** 상세 항목 */
  items: BarChartItem[];
  colors: string[];
  unit?: string;
  prevItems?: BarChartItem[];
};

export default function KpiDetailCard({
  title, color, total, totalUnit = "", rate, rateLabel,
  delta, items, colors, unit = "건", prevItems,
}: Props) {
  const totalVal = items.reduce((s, i) => s + i.value, 0);

  const prevMap = new Map<string, BarChartItem>();
  (prevItems ?? []).forEach(p => prevMap.set(p.label, p));

  return (
    <div className={styles.card}>
      {/* ── 헤더: 타이틀 + 총합 + 비율 ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.accentBar} style={{ background: color }} />
          <span className={styles.title}>{title}</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.total}>{total}</span>
          <span className={styles.totalUnit}>{totalUnit}</span>
          {rate !== null && rate !== undefined && (
            <span className={styles.rate} style={{ color: rate > 0 ? color : "var(--text-muted)" }}>
              {rate}<span>%</span>
            </span>
          )}
        </div>
      </div>

      {/* ── 델타 ── */}
      {delta && (
        <div className={styles.deltaRow} style={{ color: delta.isUp ? "#77a251" : "#e06b73" }}>
          {delta.isUp ? "\u25B2" : "\u25BC"} {delta.value}
          <span className={styles.deltaVs}>{delta.label}</span>
        </div>
      )}

      {/* ── 상세 항목 리스트 ── */}
      <div className={styles.items}>
        {items.map((item, i) => {
          const itemColor = item.color ?? colors[i] ?? color;
          const prev = prevMap.get(item.label);
          const itemDelta = prev ? item.value - prev.value : null;
          const pct = totalVal > 0 ? (item.value / totalVal) * 100 : 0;

          return (
            <div key={item.label} className={styles.item}>
              <span className={styles.dot} style={{ background: item.value > 0 ? itemColor : "rgba(255,255,255,0.1)" }} />
              <span className={styles.label}>{item.label}</span>
              <span className={styles.value} style={{ color: item.value > 0 ? itemColor : "var(--text-muted)" }}>
                {item.displayValue ?? item.value.toLocaleString()}
                {!item.displayValue && <span className={styles.unit}>{unit}</span>}
              </span>
              <span className={styles.pct}>{item.percent.toFixed(1)}%</span>
              {itemDelta !== null && itemDelta !== 0 ? (
                <span className={`${styles.itemDelta} ${itemDelta > 0 ? styles.deltaUp : styles.deltaDown}`}>
                  {itemDelta > 0 ? "\u25B2" : "\u25BC"}{Math.abs(itemDelta)}
                </span>
              ) : (
                <span className={styles.itemDeltaEmpty} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── 하단 비율 바 ── */}
      <div className={styles.barTrack}>
        {items.map((item, i) => {
          const itemColor = item.color ?? colors[i] ?? color;
          const pct = totalVal > 0 ? (item.value / totalVal) * 100 : 0;
          return (
            <div
              key={item.label}
              className={styles.barSegment}
              style={{ width: `${pct}%`, background: item.value > 0 ? itemColor : "transparent" }}
            />
          );
        })}
      </div>
    </div>
  );
}
