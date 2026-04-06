"use client";

import styles from "./RobotStats.module.css";
import type { PerRobotStats } from "@/app/lib/statisticsApi";

type RobotStatsProps = {
  stats: PerRobotStats | null;
};

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h${m}m`;
}

export default function RobotStats({ stats }: RobotStatsProps) {
  const doneTasks = stats?.tasks_completed ?? 0;
  const totalTasks = stats?.tasks_total ?? 0;
  const errors = stats?.errors_total ?? 0;
  const uptime = stats?.operating_minutes ?? 0;

  const fmt = (n: number) => n.toLocaleString();

  const statItems = [
    {
      label: "작업 (완료/총)",
      value: `${fmt(doneTasks)}/${fmt(totalTasks)}건`,
      color: "var(--color-info)",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      ),
    },
    {
      label: "오류",
      value: `${fmt(errors)}건`,
      color: errors > 0 ? "var(--color-error-soft)" : "var(--color-success)",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
    },
    {
      label: "가동",
      value: formatTime(uptime),
      color: "var(--color-success)",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
  ];

  return (
    <div className={styles.statsRow}>
      {statItems.map((s) => (
        <div key={s.label} className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>{s.label}</span>
            <span className={styles.statIcon} style={{ color: s.color }}>{s.icon}</span>
          </div>
          <span className={styles.statValue} style={{ color: s.color }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}
