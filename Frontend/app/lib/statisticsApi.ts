import { apiFetch } from "@/app/lib/api";

export type RobotTypeCount = { type: string; count: number };

export type TaskCounts = {
  completed: number;
  failed: number;
  cancelled: number;
};

export type TimeMinutes = {
  operating: number;
  charging: number;
  standby: number;
};

export type ErrorCounts = {
  network: number;
  navigation: number;
  battery: number;
  etc: number;
};

export type PerRobotStats = {
  robot_id: number;
  robot_name: string;
  robot_type: string;
  tasks_completed: number;
  tasks_total: number;
  errors_total: number;
  operating_minutes: number;
  charging_minutes: number;
  standby_minutes: number;
};

export type StatisticsResponse = {
  robot_types: RobotTypeCount[];
  tasks: TaskCounts;
  time_minutes: TimeMinutes;
  errors: ErrorCounts;
  per_robot: PerRobotStats[];
};

export type StatisticsParams = {
  start_date?: string;
  end_date?: string;
  robot_type?: string;
  robot_name?: string;
};

export type StatisticsResult = {
  data: StatisticsResponse;
  error: string | null;
};

const EMPTY_RESPONSE: StatisticsResponse = {
  robot_types: [],
  tasks: { completed: 0, failed: 0, cancelled: 0 },
  time_minutes: { operating: 0, charging: 0, standby: 0 },
  errors: { network: 0, navigation: 0, battery: 0, etc: 0 },
  per_robot: [],
};

export async function getStatistics(
  params?: StatisticsParams
): Promise<StatisticsResult> {
  const query = new URLSearchParams();
  if (params?.start_date) query.set("start_date", params.start_date);
  if (params?.end_date) query.set("end_date", params.end_date);
  if (params?.robot_type) query.set("robot_type", params.robot_type);
  if (params?.robot_name) query.set("robot_name", params.robot_name);

  const qs = query.toString();
  const path = qs ? `/DB/statistics?${qs}` : "/DB/statistics";

  try {
    const res = await apiFetch(path);
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      return { data: EMPTY_RESPONSE, error: detail?.detail ?? `HTTP ${res.status}` };
    }
    return { data: await res.json(), error: null };
  } catch {
    return { data: EMPTY_RESPONSE, error: "네트워크 오류" };
  }
}
