"use client";

import { useState, useEffect } from "react";
import type { RobotRowData } from "@/app/type";
import { apiFetch } from "@/app/lib/api";

const API_PATH = `/robot/status`;
const POLL_INTERVAL = 5000;

type StatusEntry = {
  robot_id: number;
  robot_name: string;
  robot_type: string;
  battery: Record<string, unknown>;
  network: "Online" | "Offline" | "Error" | "-";
  power: "On" | "Off" | "-";
  is_charging: boolean;
  current_floor_id: number | null;
  current_map_id: number | null;
  timestamp: number;
  position: { x: number; y: number; yaw: number; timestamp: number };
};

export function useRobotStatus(initialData: RobotRowData[]) {
  const [robots, setRobots] = useState<RobotRowData[]>(initialData);

  useEffect(() => {
    setRobots(initialData);
  }, [initialData]);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await apiFetch(API_PATH);
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
                currentFloorId: match.current_floor_id ?? r.currentFloorId,
                currentMapId: match.current_map_id ?? r.currentMapId,
                network: match.network,
                power: match.power,
              };
            }

            const soc = bat.SOC as number | undefined;
            return {
              ...r,
              battery: soc ?? r.battery,
              isCharging: match.is_charging ?? r.isCharging,
              currentFloorId: match.current_floor_id ?? r.currentFloorId,
              currentMapId: match.current_map_id ?? r.currentMapId,
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
    };

    poll();

    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  return robots;
}