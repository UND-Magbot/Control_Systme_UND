import type { RobotRowData } from "@/app/types";
import { apiFetch } from "@/app/lib/api";

export default async function getRobots(): Promise<RobotRowData[]> {
  let raw: any[] = [];

  try {
    const res = await apiFetch(`/DB/robots`);
    if (res.ok) {
      raw = await res.json();
    }
  } catch {
    // API 실패 시 raw는 빈 배열 유지
  }

  const robots = raw.map((item: any): RobotRowData => {
    // 배터리 통합: QUADRUPED → 1=Left,2=Right / 기타 → 1=SOC
    const isQuadruped = item.RobotType === "QUADRUPED";

    return {
    id: item.id,

    // DB 컬럼명: RobotName (PascalCase)
    no: item.RobotName ?? "",

    // 표시용 정보
    type: item.RobotType ?? "",
    info: item.RobotName ?? "",

    // 상태 (DB 마지막 값 → 실시간 폴링으로 덮어씌워짐)
    battery: isQuadruped ? 0 : (item.BatteryLevel1 ?? 0),
    batteryLeft: isQuadruped ? (item.BatteryLevel1 ?? undefined) : undefined,
    batteryRight: isQuadruped ? (item.BatteryLevel2 ?? undefined) : undefined,
    voltageLeft: isQuadruped ? (item.Voltage1 ?? undefined) : undefined,
    voltageRight: isQuadruped ? (item.Voltage2 ?? undefined) : undefined,
    batteryTempLeft: isQuadruped ? (item.BatteryTemp1 ?? undefined) : undefined,
    batteryTempRight: isQuadruped ? (item.BatteryTemp2 ?? undefined) : undefined,
    chargeLeft: isQuadruped ? (item.IsCharging1 === 1 ? true : item.IsCharging1 === 0 ? false : undefined) : undefined,
    chargeRight: isQuadruped ? (item.IsCharging2 === 1 ? true : item.IsCharging2 === 0 ? false : undefined) : undefined,
    return: item.LimitBattery ?? 30,
    isCharging: false,  // 런타임 폴링으로만 갱신 (DB 값은 미갱신 상태이므로 무시)
    chargeState: 0,
    chargeStateLabel: "대기",
    chargeErrorCode: 0,
    chargeErrorMsg: null,
    currentFloorId: item.CurrentFloorId ?? null,
    currentMapId: item.CurrentMapId ?? null,
    position: { x: 0, y: 0, yaw: 0, timestamp: 0 },
    network: item.LastHeartbeat ? "Offline" : "-",
    power: item.LastHeartbeat ? "Off" : "-",
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
    registrationDateTime: item.CreatedAt ?? "",
    robotIP: item.RobotIP ?? undefined,
    robotPort: item.RobotPort ?? undefined,
  }});

  return robots;
}
