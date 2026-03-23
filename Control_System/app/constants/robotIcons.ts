import type { RobotRowData } from "@/app/type";

// ── 배터리 아이콘 ──
const BATTERY_ICONS = [
  { limit: 100, icon: "/icon/battery_full.png" },
  { limit: 75, icon: "/icon/battery_high.png" },
  { limit: 50, icon: "/icon/battery_half.png" },
  { limit: 25, icon: "/icon/battery_low.png" },
  { limit: 0, icon: "/icon/battery_empty.png" },
];

export function getBatteryIcon(battery: number, isCharging?: boolean): string {
  if (isCharging) return "/icon/battery_charging.png";
  const state = BATTERY_ICONS.find((item) => battery >= item.limit);
  return state ? state.icon : "/icon/battery_empty.png";
}

// ── 네트워크 아이콘 ──
const NETWORK_ICON_MAP: Record<string, string> = {
  Error: "/icon/status(2).png",
  Offline: "/icon/status(3).png",
  Online: "/icon/status(1).png",
};

export function getNetworkIcon(status: string): string {
  return NETWORK_ICON_MAP[status] || NETWORK_ICON_MAP["Online"];
}

// ── 전원 아이콘 ──
export function getPowerIcon(power: string): string {
  return power === "On" ? "/icon/power_on.png" : "/icon/power_off.png";
}

// ── 배터리 색상 ──
export function getBatteryColor(level: number, limitBattery: number): string {
  if (level > limitBattery) return "var(--color-success)";
  if (level > 10) return "var(--color-warning)";
  return "var(--color-error-soft)";
}

// ── 위험 배터리 판정 ──
export function isCriticalBattery(r: RobotRowData): boolean {
  return r.power === "On" && !r.isCharging && r.battery <= 10;
}

// ── 로봇 타입별 색상 (대시보드용 4색) ──
export const ROBOT_TYPE_COLOR: Record<RobotRowData["type"], string> = {
  QUADRUPED: "#fa0203",
  COBOT: "#03abf3",
  AMR: "#97ce4f",
  HUMANOID: "#f79418",
};

export const ROBOT_TYPE_INDEX: Record<RobotRowData["type"], number> = {
  QUADRUPED: 0,
  COBOT: 1,
  AMR: 2,
  HUMANOID: 3,
};

// ── 로봇 개별 색상 (로봇 관리용 7색 순환) ──
export const ROBOT_COLORS = [
  "#ed1c24", "#059fd7", "#92d050", "#f7941d",
  "#d65bdb", "#0fc6cc", "#51b77c",
];

// ── 로봇 번호 → 인덱스 변환 ──
export function getRobotIndexFromNo(robotNo: string): number {
  const match = robotNo.match(/\d+/);
  const num = match ? Number(match[0]) : 1;
  const idx = num - 1;
  return ((idx % ROBOT_COLORS.length) + ROBOT_COLORS.length) % ROBOT_COLORS.length;
}

// ── 로봇 아이콘 경로 빌드 ──
export function buildRobotIconPath(robotNo: string, kind: "icon" | "location"): string {
  const idx = getRobotIndexFromNo(robotNo);
  const iconNo = idx + 1;
  if (kind === "icon") return `/icon/robot_icon(${iconNo}).png`;
  return `/icon/robot_location(${iconNo}).png`;
}
