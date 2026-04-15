import type { StatisticsResponse } from "@/app/lib/statisticsApi";
import { convertMinutesToText } from "@/app/utils/convertMinutesToText";

export type StatsSummary = {
  totalRobots: number;
  totalTasks: number;
  totalErrors: number;
  completed: number;
  failed: number;
  cancelled: number;
  taskSuccessRate: number;
  errorRate: number;
  opHText: string;
  opMText: string;
  timeHText: string;
  timeMText: string;
  opMin: number;
  chgMin: number;
  stdMin: number;
  totalMin: number;
  opRate: number;
  taskDelta: number | null;
  errorDelta: number | null;
  opDelta: number | null;
  robotDelta: number | null;
  prevLabel: string;
};

/** 통계 응답(+이전 기간)을 Summary Card용 구조로 가공한다. */
export function computeStatsSummary(
  statsData: StatisticsResponse | null,
  prevStatsData: StatisticsResponse | null,
  prevLabel: string,
): StatsSummary {
  const totalRobots = statsData?.robot_types.reduce((s, t) => s + t.count, 0) ?? 0;
  const totalTasks = statsData ? Object.values(statsData.tasks).reduce((s, v) => s + v, 0) : 0;
  const totalErrors = statsData ? Object.values(statsData.errors).reduce((s, v) => s + v, 0) : 0;
  const completed = statsData?.tasks.completed ?? 0;
  const failed = statsData?.tasks.failed ?? 0;
  const cancelled = statsData?.tasks.cancelled ?? 0;
  const taskSuccessRate = totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0;
  const errorRate = totalTasks > 0 ? Math.round((failed / totalTasks) * 100) : 0;

  const opMin = statsData?.time_minutes.operating ?? 0;
  const opParts = convertMinutesToText(opMin).split(" ");
  const totalMin = statsData ? Object.values(statsData.time_minutes).reduce((s, v) => s + v, 0) : 0;
  const totalParts = convertMinutesToText(totalMin).split(" ");
  const opRate = totalMin > 0 ? Math.round((opMin / totalMin) * 100) : 0;
  const chgMin = statsData?.time_minutes.charging ?? 0;
  const stdMin = statsData?.time_minutes.standby ?? 0;

  // 이전 기간 총합
  const prevTasks = prevStatsData ? Object.values(prevStatsData.tasks).reduce((s, v) => s + v, 0) : null;
  const prevErrors = prevStatsData ? Object.values(prevStatsData.errors).reduce((s, v) => s + v, 0) : null;
  const prevOpMin = prevStatsData?.time_minutes.operating ?? null;
  const prevRobots = prevStatsData?.robot_types.reduce((s, t) => s + t.count, 0) ?? null;

  // 델타 (null = 비교 데이터 없음)
  const taskDelta = prevTasks !== null ? totalTasks - prevTasks : null;
  const errorDelta = prevErrors !== null ? totalErrors - prevErrors : null;
  const opDelta = prevOpMin !== null ? opMin - prevOpMin : null;
  const robotDelta = prevRobots !== null ? totalRobots - prevRobots : null;

  return {
    totalRobots,
    totalTasks,
    totalErrors,
    completed,
    failed,
    cancelled,
    taskSuccessRate,
    errorRate,
    opHText: opParts[0] ?? "0h",
    opMText: opParts[1] ?? "0m",
    timeHText: totalParts[0] ?? "0h",
    timeMText: totalParts[1] ?? "0m",
    opMin,
    chgMin,
    stdMin,
    totalMin,
    opRate,
    taskDelta,
    errorDelta,
    opDelta,
    robotDelta,
    prevLabel,
  };
}
