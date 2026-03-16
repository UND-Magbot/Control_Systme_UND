import type { RobotRowData } from "@/app/type";

const API_BASE = process.env.API_BASE ?? "http://localhost:8000";

export default async function getRobots(): Promise<RobotRowData[]> {
  const res = await fetch(`${API_BASE}/DB/robots`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch robots");
  }

  const raw = await res.json();

  const robots = raw.map((item: any, index: number): RobotRowData => ({
    id: item.id,

    // 🔥 여기 핵심: 자동 Robot 번호 생성
    no: `Robot ${index + 1}`,

    // 표시용 정보
    type: item.robot_type ?? "",
    info: item.robot_name ?? "",

    // 상태
    battery: item.battery ?? 0,
    return: item.limit_battery ?? 30,
    isCharging: item.is_charging ?? false,
    network: item.network ?? "Online",
    power: item.power ?? "On",
    mark: item.mark ?? "No",

    // 배열 필드는 반드시 방어
    tasks: Array.isArray(item.tasks) ? item.tasks : [],
    errors: Array.isArray(item.errors) ? item.errors : [],

    chargingTime: item.charging_time ?? 0,
    waitingTime: item.waiting_time ?? 0,
    dockingTime: item.docking_time ?? 0,

    // 메타 정보
    operator: item.admin_id ?? "",
    serialNumber: item.serial_number ?? "",
    model: item.model_name ?? "",
    group: item.group ?? "",
    softwareVersion: item.software_version ?? "",
    site: item.site ?? "",
    registrationDateTime: item.created_at ?? "",
  }));

  return robots;
}
