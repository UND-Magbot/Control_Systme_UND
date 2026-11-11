export type RobotCapabilities = {
  hasStandSit: boolean;
  hasDualBattery: boolean;
  hasLights: boolean;
  hasSpeed: boolean;
};

export const ROBOT_CAPABILITIES: Record<string, RobotCapabilities> = {
  QUADRUPED:  { hasStandSit: true, hasDualBattery: true, hasLights: true, hasSpeed: true },
  "기본 4족": { hasStandSit: true, hasDualBattery: true, hasLights: true, hasSpeed: true },
  "순찰 4족": { hasStandSit: true, hasDualBattery: true, hasLights: true, hasSpeed: true },
  "보안 4족": { hasStandSit: true, hasDualBattery: true, hasLights: true, hasSpeed: true },
  COBOT:      { hasStandSit: false, hasDualBattery: false, hasLights: true, hasSpeed: true },
  AMR:        { hasStandSit: false, hasDualBattery: false, hasLights: true, hasSpeed: true },
  HUMANOID:   { hasStandSit: true, hasDualBattery: false, hasLights: true, hasSpeed: true },
};

export function getRobotCapabilities(type: string): RobotCapabilities {
  return ROBOT_CAPABILITIES[type] ?? ROBOT_CAPABILITIES.AMR;
}

const DUAL_BATTERY_TYPES = new Set(["기본 4족", "순찰 4족", "보안 4족"]);

export function isDualBatteryType(type: string): boolean {
  return DUAL_BATTERY_TYPES.has(type);
}

// 듀얼 배터리 슬롯 잔량. 배터리를 1개만 꽂으면 빈 슬롯은 잔량·전압이 모두 0으로 보고되므로
// (실제 방전 배터리는 전압이 남는다) 둘 다 0이면 미장착으로 보고 undefined 를 반환한다.
export function dualSlotLevel(level?: number | null, voltage?: number | null): number | undefined {
  if (level == null) return undefined;
  return level === 0 && voltage === 0 ? undefined : level;
}

// 장착된 슬롯 중 낮은 잔량(보수적). 장착된 슬롯이 없으면 0.
export function minInstalledBattery(left?: number, right?: number): number {
  const vals = [left, right].filter((v): v is number => v != null);
  return vals.length ? Math.min(...vals) : 0;
}
