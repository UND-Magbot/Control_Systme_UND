"use client";

import React, { useMemo, useState, useEffect } from "react";
import type { DonutCommonInfo } from "@/app/type";
import styles from "./StatDonut.module.css";

type Props = {
  data: DonutCommonInfo[];
  colors: string[];
};

export default function StatDonut({ data, colors }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [data]);

  const gradient = useMemo(() => {
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return "conic-gradient(rgba(255,255,255,0.06) 0deg 360deg)";

    let deg = 0;
    const parts: string[] = [];
    data.forEach((d, i) => {
      const slice = (d.value / total) * 360;
      parts.push(`${colors[i % colors.length]} ${deg}deg ${deg + slice}deg`);
      deg += slice;
    });
    if (deg < 360) parts.push(`rgba(255,255,255,0.06) ${deg}deg 360deg`);
    return `conic-gradient(${parts.join(", ")})`;
  }, [data, colors]);

  return (
    <div className={`${styles.wrap} ${visible ? styles.visible : ""}`}>
      <div className={styles.ring} style={{ backgroundImage: gradient }}>
        <div className={styles.hole} />
      </div>
    </div>
  );
}
