import type { RobotRowData } from "@/app/type";
import { robotRows as mockStatistics } from "@/app/mock/robot_status";

export default function getStatisticsData(): RobotRowData[] {
  return mockStatistics;
}
