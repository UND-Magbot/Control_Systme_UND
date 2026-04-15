"use client";

import React from "react";
import styles from "./ComparisonCard.module.css";

type MetricItem = { label: string; value: string };

type Props = {
  title: string;
  color: string;
  current: MetricItem[];
  previous: MetricItem[];
  prevPeriodLabel: string;
  delta?: { value: string; isUp: boolean } | null;
  tooltip?: string;
};

export default function ComparisonCard({
  title, color, current, previous, prevPeriodLabel, delta, tooltip,
}: Props) {
  const hasPrev = previous.length > 0;

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.dot} style={{ background: color }} />
        <span className={styles.title}>{title}</span>
        {tooltip && (
          <span className={styles.tooltip} title={tooltip}>?</span>
        )}
        {delta && (
          <span className={styles.headDelta} style={{ color: delta.isUp ? "#77a251" : "#e06b73" }}>
            {delta.isUp ? "\u25B2" : "\u25BC"} {delta.value}
            <span className={styles.headDeltaLabel}>({prevPeriodLabel})</span>
          </span>
        )}
      </div>

      {/* 열 헤더 */}
      <div className={styles.colHeaders}>
        <span className={styles.labelCol} />
        <span className={styles.valCol}>현재</span>
        {hasPrev && <span className={styles.valCol}>{prevPeriodLabel}</span>}
      </div>

      {/* 항목 행 */}
      <div className={styles.rows}>
        {current.map((item, i) => {
          const prev = previous[i];
          return (
            <div key={item.label} className={styles.row}>
              <span className={styles.labelCol}>{item.label}</span>
              <span className={styles.valCol} style={{ color }}>{item.value}</span>
              {hasPrev && (
                <span className={`${styles.valCol} ${styles.prevVal}`}>{prev?.value ?? "-"}</span>
              )}
            </div>
          );
        })}
      </div>

      {!hasPrev && (
        <div className={styles.noPrev}>비교 데이터 없음</div>
      )}
    </div>
  );
}
