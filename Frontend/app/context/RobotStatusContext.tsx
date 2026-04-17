"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { RobotRowData } from "@/app/types";
import { apiFetch } from "@/app/lib/api";
import { isDualBatteryType } from "@/app/constants/robotCapabilities";

const STATUS_API = `/robot/status`;
const POLL_INTERVAL = 5000;
const OFFLINE_THRESHOLD = 3; // 연속 실패 횟수 — 이 횟수 이상 실패해야 Offline 처리

// 충전→비충전 전환 디바운스 카운터 (로봇ID → 연속 false 횟수)
const _chargingDropCount: Record<number, number> = {};
const CHARGING_DROP_THRESHOLD = 2;


type StatusEntry = {
  robot_id: number;
  robot_name: string;
  robot_type: string;
  battery: Record<string, unknown>;
  network: "Online" | "Offline" | "Error" | "-";
  power: "On" | "Off" | "-";
  sleep: number | null;
  power_management: 0 | 1 | null;
  motion_state: number | null;
  is_charging: boolean;
  is_navigating: boolean;
  charge_state: number;
  charge_state_label: string;
  charge_error_code: number;
  charge_error_msg: string | null;
  current_floor_id: number | null;
  current_map_id: number | null;
  timestamp: number;
  position: { x: number; y: number; yaw: number; timestamp: number };
};

type RobotStatusContextType = {
  robots: RobotRowData[];
  loaded: boolean;
  refresh: () => Promise<void>;
};

const RobotStatusContext = createContext<RobotStatusContextType>({
  robots: [],
  loaded: false,
  refresh: async () => {},
});

export function useRobotStatusContext() {
  return useContext(RobotStatusContext);
}

export function RobotStatusProvider({ children }: { children: React.ReactNode }) {
  const [robots, setRobots] = useState<RobotRowData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const initialLoaded = useRef(false);
  const failCount = useRef(0);

  // 초기 로봇 목록 로드 (DB)
  const loadInitial = useCallback(async () => {
    try {
      const mod = await import("@/app/lib/robotInfo");
      const data = await mod.default();
      setRobots((prev) => {
        if (!prev.length) return data; // 최초 로드
        // refresh: DB 목록 갱신하되 런타임 상태는 유지
        return data.map((d) => {
          const existing = prev.find((r) => r.id === d.id);
          if (!existing) return d;
          return {
            ...d,
            isCharging: existing.isCharging,
            chargeState: existing.chargeState,
            chargeStateLabel: existing.chargeStateLabel,
            chargeErrorCode: existing.chargeErrorCode,
            chargeErrorMsg: existing.chargeErrorMsg,
            network: existing.network,
            power: existing.power,
            sleep: existing.sleep,
            powerManagement: existing.powerManagement,
            motionState: existing.motionState,
            position: existing.position,
            battery: existing.battery,
            batteryLeft: existing.batteryLeft,
            batteryRight: existing.batteryRight,
          };
        });
      });
      initialLoaded.current = true;
      setLoaded(true);
    } catch {
      // 실패 시 빈 배열 유지
    }
  }, []);

  // 실시간 상태 폴링
  const poll = useCallback(async () => {
    try {
      const res = await apiFetch(STATUS_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const statuses: StatusEntry[] = await res.json();

      failCount.current = 0; // 성공 시 실패 카운트 초기화

      setRobots((prev) =>
        prev.map((r) => {
          const match = statuses.find((s) => s.robot_name === r.no);
          if (!match) {
            // 응답에 없는 로봇은 이전 상태 유지 (즉시 Offline 처리하지 않음)
            return r;
          }

          const bat = match.battery ?? {};

          // 충전→비충전 전환 디바운스
          const rawCharging = match.is_charging ?? r.isCharging;
          let stableCharging: boolean;
          if (r.isCharging && !rawCharging) {
            _chargingDropCount[r.id] = (_chargingDropCount[r.id] ?? 0) + 1;
            stableCharging = _chargingDropCount[r.id] >= CHARGING_DROP_THRESHOLD ? false : true;
          } else {
            _chargingDropCount[r.id] = 0;
            stableCharging = rawCharging;
          }

          if (isDualBatteryType(r.type)) {
            return {
              ...r,
              batteryLeft: (bat.BatteryLevelLeft as number) ?? r.batteryLeft,
              batteryRight: (bat.BatteryLevelRight as number) ?? r.batteryRight,
              voltageLeft: (bat.VoltageLeft as number) ?? r.voltageLeft,
              voltageRight: (bat.VoltageRight as number) ?? r.voltageRight,
              batteryTempLeft: (bat.battery_temperatureLeft as number) ?? r.batteryTempLeft,
              batteryTempRight: (bat.battery_temperatureRight as number) ?? r.batteryTempRight,
              chargeLeft: (bat.chargeLeft as boolean) ?? r.chargeLeft,
              chargeRight: (bat.chargeRight as boolean) ?? r.chargeRight,
              serialLeft: (bat.serialLeft as string) ?? r.serialLeft,
              serialRight: (bat.serialRight as string) ?? r.serialRight,
              isCharging: stableCharging,
              chargeState: match.charge_state ?? r.chargeState,
              chargeStateLabel: match.charge_state_label ?? r.chargeStateLabel,
              chargeErrorCode: match.charge_error_code ?? r.chargeErrorCode,
              chargeErrorMsg: match.charge_error_msg ?? r.chargeErrorMsg,
              currentFloorId: match.current_floor_id ?? r.currentFloorId,
              currentMapId: match.current_map_id ?? r.currentMapId,
              position: match.position ?? r.position,
              isNavigating: match.is_navigating ?? r.isNavigating,
              network: match.network,
              power: match.power,
              sleep: match.sleep,
              powerManagement: match.power_management,
              motionState: match.motion_state,
            };
          }

          const soc = bat.SOC as number | undefined;
          return {
            ...r,
            battery: soc ?? r.battery,
            isCharging: stableCharging,
            chargeState: match.charge_state ?? r.chargeState,
            chargeStateLabel: match.charge_state_label ?? r.chargeStateLabel,
            chargeErrorCode: match.charge_error_code ?? r.chargeErrorCode,
            chargeErrorMsg: match.charge_error_msg ?? r.chargeErrorMsg,
            currentFloorId: match.current_floor_id ?? r.currentFloorId,
            currentMapId: match.current_map_id ?? r.currentMapId,
            position: match.position ?? r.position,
            isNavigating: match.is_navigating ?? r.isNavigating,
            network: match.network,
            power: match.power,
            sleep: match.sleep,
            powerManagement: match.power_management,
            motionState: match.motion_state,
          };
        })
      );
    } catch {
      failCount.current += 1;
      // 연속 실패가 임계값 이상일 때만 Offline 처리
      if (failCount.current >= OFFLINE_THRESHOLD) {
        setRobots((prev) =>
          prev.map((r) => ({
            ...r,
            network: "Offline" as const,
            power: "Off" as const,
          }))
        );
      }
    }
  }, []);

  // 외부에서 로봇 목록 갱신 (등록/삭제 후)
  const refresh = useCallback(async () => {
    await loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    loadInitial().then(() => poll());
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [loadInitial, poll]);

  const value = useMemo(() => ({ robots, loaded, refresh }), [robots, loaded, refresh]);

  return (
    <RobotStatusContext.Provider value={value}>
      {children}
    </RobotStatusContext.Provider>
  );
}
