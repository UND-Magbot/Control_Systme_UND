export type RobotCapabilities = {
  hasStandSit: boolean;
  hasDualBattery: boolean;
  hasLights: boolean;
  hasSpeed: boolean;
};

export const ROBOT_CAPABILITIES: Record<string, RobotCapabilities> = {
  QUADRUPED: { hasStandSit: true, hasDualBattery: true, hasLights: true, hasSpeed: true },
  COBOT:     { hasStandSit: false, hasDualBattery: false, hasLights: true, hasSpeed: true },
  AMR:       { hasStandSit: false, hasDualBattery: false, hasLights: true, hasSpeed: true },
  HUMANOID:  { hasStandSit: true, hasDualBattery: false, hasLights: true, hasSpeed: true },
};

export function getRobotCapabilities(type: string): RobotCapabilities {
  return ROBOT_CAPABILITIES[type] ?? ROBOT_CAPABILITIES.AMR;
}

const DUAL_BATTERY_TYPES = new Set(["기본 4족", "순찰 4족", "보안 4족"]);

export function isDualBatteryType(type: string): boolean {
  return DUAL_BATTERY_TYPES.has(type);
}
