"use client";

import { useState, useEffect, useRef } from "react";
import type { RobotRowData } from "@/app/type";
import { getApiBase } from '@/app/constants/api';

const API_URL = `${getApiBase()}/robot/status`;
const POLL_INTERVAL = 5000;

// 로봇 heartbeat timestamp 기준 판정 임계값 (초)
const ONLINE_MAX_AGE = 5;   // 5초 이내 → Online
const ERROR_MAX_AGE = 15;   // 5~15초 → Error, 15초 초과 → Offline

/**
 * 로봇 heartbeat timestamp로 실제 통신 상태를 판정한다.
 * - timestamp가 없으면 → 한 번도 heartbeat를 받지 못한 것 → Offline
 * - timestamp가 오래됐으면 → 통신 끊김
 */
function deriveNetworkStatus(timestamp: number | undefined): "Online" | "Error" | "Offline" {
  if (!timestamp) return "Offline";
  const age = Date.now() / 1000 - timestamp;
  if (age <= ONLINE_MAX_AGE) return "Online";
  if (age <= ERROR_MAX_AGE) return "Error";
  return "Offline";
}

export function useRobotStatus(initialData: RobotRowData[]) {
  const [robots, setRobots] = useState<RobotRowData[]>(initialData);

  useEffect(() => {
    setRobots(initialData);
  }, [initialData]);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const status = await res.json();

        // 핵심: 서버 응답이 와도 robot_status.timestamp로 실제 로봇 통신 여부를 판정
        const network = deriveNetworkStatus(status.timestamp);
        const isConnected = network === "Online";

        const targetName = status.robot_name as string | undefined;
        const soc = status.battery?.SOC;
        const charging = status.battery?.Charging ?? false;

        setRobots((prev) =>
          prev.map((r) => {
            if (targetName && r.no === targetName) {
              return {
                ...r,
                battery: soc != null ? soc : r.battery,
                isCharging: charging,
                network,
                power: network === "Offline" ? "Off" as const : "On" as const,
              };
            }
            return r;
          })
        );
      } catch {
        // FastAPI 서버 자체가 응답하지 않는 경우
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
