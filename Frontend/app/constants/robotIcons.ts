import type { RobotRowData } from "@/app/types";

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

// ── 4족 배터리 모드 판정 ──
// PowerManagement는 Sleep=0(전원 On) 상태에서만 유효하며,
// 0=regular(배터리 2개), 1=single(단일 배터리). 값이 없으면 regular로 간주.
export function isQuadrupedSingleBatteryMode(r: RobotRowData): boolean {
  return r.type === "QUADRUPED" && r.powerManagement === 1;
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
