import type { LogItem } from "@/app/type";
import { logMockData } from "@/app/mock/log_data";

// const API_BASE = process.env.API_BASE ?? "http://localhost:8000";

export default async function getLogData(): Promise<LogItem[]> {
  // TODO: API 연동 시 아래 주석 해제
  // const res = await fetch(`${API_BASE}/DB/logs`, { cache: "no-store" });
  // if (!res.ok) throw new Error("Failed to fetch log data");
  // return res.json();

  return logMockData;
}
