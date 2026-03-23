import type { RobotRowData } from "@/app/type";
import { API_BASE } from "@/app/config";

export default async function getRobots(): Promise<RobotRowData[]> {
  let raw: any[] = [];

  try {
    const res = await fetch(`${API_BASE}/DB/robots`, {
      cache: "no-store",
    });
    if (res.ok) {
      raw = await res.json();
    }
  } catch {
    // API 실패 시 raw는 빈 배열 유지 → 아래에서 mock 데이터로 대체
  }

  const robots = raw.map((item: any): RobotRowData => ({
    id: item.id,

    // DB 컬럼명: RobotName (PascalCase)
    no: item.RobotName ?? "",

    // 표시용 정보
    type: item.robot_type ?? "",
    info: item.RobotName ?? "",

    // 상태 (실시간 폴링으로 덮어씌워짐)
    battery: item.battery ?? 0,
    return: item.LimitBattery ?? 30,
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

    // 메타 정보 (DB 컬럼명: PascalCase)
    operator: item.ProductCompany ?? "",
    serialNumber: item.SerialNumber ?? "",
    model: item.ModelName ?? "",
    group: item.Group ?? "",
    softwareVersion: item.SWversion ?? "",
    site: item.Site ?? "",
    registrationDateTime: item.Adddate ?? "",
  }));

  return robots;
}
