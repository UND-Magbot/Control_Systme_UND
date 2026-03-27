import type { RobotRowData } from "@/app/type";
import { robotRows as mockStatistics } from "@/app/mock/robot_status";
import { getApiBase } from '@/app/constants/api';

export default async function getStatisticsData(): Promise<RobotRowData[]> {
  // TODO: 백엔드 통계 API 연동 시 아래 주석 해제
  // try {
  //   const res = await fetch(`${getApiBase()}/DB/statistics`, { cache: "no-store" });
  //   if (res.ok) return await res.json();
  // } catch {}

  // 현재: mock 데이터 반환
  return mockStatistics;
}
