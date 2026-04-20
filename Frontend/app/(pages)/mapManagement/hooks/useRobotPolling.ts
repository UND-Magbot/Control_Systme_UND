"use client";

import { useEffect } from "react";
import { apiFetch } from "@/app/lib/api";
import type { Robot } from "../types/map";

type RobotPos = { x: number; y: number; yaw: number } | null;

/**
 * 연결된 로봇이 있을 때 2초마다 /robot/position + /robot/status를 호출하여
 * - 로봇 좌표(robotPos) 갱신
 * - 연결된 로봇들의 CurrentFloorId를 응답에 맞춰 동기화
 *
 * 연결된 로봇이 없으면 robotPos를 null로 리셋하고 폴링을 건다.
 */
export function useRobotPolling(
  connectedRobots: Robot[],
  setConnectedRobots: React.Dispatch<React.SetStateAction<Robot[]>>,
  setRobotPos: React.Dispatch<React.SetStateAction<RobotPos>>
) {
  useEffect(() => {
    if (connectedRobots.length === 0) {
      setRobotPos(null);
      return;
    }
    const poll = async () => {
      try {
        const [posRes, statusRes] = await Promise.all([
          apiFetch(`/robot/position`),
          apiFetch(`/robot/status`),
        ]);
        const posData = await posRes.json();
        if (posData.timestamp > 0) {
          setRobotPos({ x: posData.x, y: posData.y, yaw: posData.yaw });
        }
        const statuses: { robot_name: string; current_floor_id: number | null }[] =
          await statusRes.json();
        setConnectedRobots((prev) =>
          prev.map((robot) => {
            const match = statuses.find((s) => s.robot_name === robot.RobotName);
            if (match && match.current_floor_id !== robot.CurrentFloorId) {
              return { ...robot, CurrentFloorId: match.current_floor_id };
            }
            return robot;
          })
        );
      } catch (e) {
        console.error("위치 폴링 실패:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedRobots.length]);
}
