"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { RobotRowData } from "@/app/type";
import { apiFetch } from "@/app/lib/api";

const STATUS_API = `/robot/status`;
const POLL_INTERVAL = 5000;

type StatusEntry = {
  robot_id: number;
  robot_name: string;
  robot_type: string;
  battery: Record<string, unknown>;
  network: "Online" | "Offline" | "Error" | "-";
  power: "On" | "Off" | "-";
  is_charging: boolean;
  charge_state: number;
  charge_state_label: string;
  charge_error_code: number;
  charge_error_msg: string | null;
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

  // 초기 로봇 목록 로드 (DB)
  const loadInitial = useCallback(async () => {
    try {
      const mod = await import("@/app/lib/robotInfo");
      const data = await mod.default();
      setRobots(data);
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

      setRobots((prev) =>
        prev.map((r) => {
          const match = statuses.find((s) => s.robot_name === r.no);
          if (!match) {
            return { ...r, network: "-" as const, power: "-" as const };
          }

          const bat = match.battery ?? {};

          if (r.type === "QUADRUPED") {
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
              isCharging: match.is_charging ?? r.isCharging,
              chargeState: match.charge_state ?? r.chargeState,
              chargeStateLabel: match.charge_state_label ?? r.chargeStateLabel,
              chargeErrorCode: match.charge_error_code ?? r.chargeErrorCode,
              chargeErrorMsg: match.charge_error_msg ?? r.chargeErrorMsg,
              network: match.network,
              power: match.power,
            };
          }

          const soc = bat.SOC as number | undefined;
          return {
            ...r,
            battery: soc ?? r.battery,
            isCharging: match.is_charging ?? r.isCharging,
            chargeState: match.charge_state ?? r.chargeState,
            chargeStateLabel: match.charge_state_label ?? r.chargeStateLabel,
            chargeErrorCode: match.charge_error_code ?? r.chargeErrorCode,
            chargeErrorMsg: match.charge_error_msg ?? r.chargeErrorMsg,
            network: match.network,
            power: match.power,
          };
        })
      );
    } catch {
      setRobots((prev) =>
        prev.map((r) => ({
          ...r,
          network: "Offline" as const,
          power: "Off" as const,
        }))
      );
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
