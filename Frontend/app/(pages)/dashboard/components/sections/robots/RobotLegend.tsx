import styles from './RobotLegend.module.css';

export type RobotLegendStats = {
  total: number;
  operating: number;
  standby: number;
  charging: number;
  offline: number;
  /** 관제 서버 응답 없음으로 분류 불가한 대수. 0이면 항목을 감춘다. */
  unknown?: number;
};

const LEGEND_ITEMS = [
  { key: "operating", label: "운영", color: "#22c55e" },
  { key: "standby",   label: "대기", color: "#3b82f6" },
  { key: "charging",  label: "충전", color: "#eab308" },
  { key: "offline",   label: "오프라인", color: "#6b7280" },
  { key: "unknown",   label: "확인 불가", color: "#94a3b8" },
] as const;

export default function RobotLegend({ stats }: { stats: RobotLegendStats }) {
  const items = LEGEND_ITEMS.filter((item) => item.key !== "unknown" || (stats.unknown ?? 0) > 0);
  return (
    <div className={styles.legendBox}>
      <span className={styles.legendItem}>
        <span>전체</span>
        <span className={styles.totalNumber}>{stats.total}</span>
      </span>
      {items.map((item) => (
        <span key={item.key} className={styles.legendGroup}>
          <span className={styles.divider}>|</span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: item.color }} />
            <span>{item.label}</span>
            <span className={styles.itemNumber}>{stats[item.key] ?? 0}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
