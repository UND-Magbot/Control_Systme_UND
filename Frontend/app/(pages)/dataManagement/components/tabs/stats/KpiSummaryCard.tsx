"use client";

import React from "react";
import styles from "./KpiSummaryCard.module.css";

type Props = {
  title: string;
  color: string;
  value: string;
  unit?: string;
  subValue?: string;
  subColor?: string;
  tooltip?: string;
};

export default function KpiSummaryCard({
  title, color, value, unit = "", subValue, subColor, tooltip,
}: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.dot} style={{ background: color }} />
        <span className={styles.title}>{title}</span>
        {tooltip && (
          <span className={styles.tooltip} title={tooltip}>?</span>
        )}
      </div>
      <div className={styles.row}>
        <span className={styles.value}>{value}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
        {subValue && (
          <span className={styles.sub} style={{ color: subColor ?? "var(--text-tertiary)" }}>{subValue}</span>
        )}
      </div>
      <div className={styles.accent} style={{ background: color }} />
    </div>
  );
}
