"use client";

import { useEffect, useCallback } from "react";
import { apiFetch } from "@/app/lib/api";
import { useVisibilityAwareInterval } from "@/app/hooks/useVisibilityAwareInterval";
import type { Robot } from "../types/map";

type RobotPos = { x: number; y: number; yaw: number } | null;

type RobotStatus = {
  robot_id: number;
  robot_name: string;
  network: string; // "Online" | "Error" | "Offline" | "-"
  current_floor_id: number | null;
};

/**
 * 실시간 위치(/robot/position)의 timestamp 가 이 시간(초)보다 오래되면
 * '통신 끊김(stale)'으로 보고 맵 마커를 숨긴다. 백엔드 Offline 판정(heartbeat
 * 12초 초과, runtime.ERROR_MAX_AGE)과 정합하도록 12초로 둔다.
 */
const POSITION_STALE_SEC = 12;

/**
 * 연결된 로봇이 있을 때 2초마다 /robot/position + /robot/status를 호출하여
 * - 로봇 좌표(robotPos) 갱신 — 단, 위치가 stale(끊김)이면 마커 제거
 * - 연결된 로봇들의 CurrentFloorId를 응답에 맞춰 동기화
 * - 통신이 끊긴(Offline / 상태에서 사라진) 로봇은 연결 목록에서 자동 해제
 *   (연결/해제는 online 상태에서만 가능하므로, 끊긴 로봇은 수동 해제가 불가능하다.
 *    따라서 통신 두절을 곧 '연결 해제'로 간주해 마커·연결 표시가 stale 로 남지 않게 한다.)
 *
 * 연결된 로봇이 없으면 robotPos를 null로 리셋하고 폴링을 멈춘다.
 */
export function useRobotPolling(
  connectedRobots: Robot[],
  setConnectedRobots: React.Dispatch<React.SetStateAction<Robot[]>>,
  setRobotPos: React.Dispatch<React.SetStateAction<RobotPos>>,
  onCommsLost?: (robotNames: string[]) => void
) {
  const enabled = connectedRobots.length > 0;

  // 연결된 로봇이 없으면 좌표 리셋
  useEffect(() => {
    if (!enabled) setRobotPos(null);
  }, [enabled, setRobotPos]);

  // 가시성 헬퍼(cbRef)가 항상 최신 클로저를 실행하므로, connectedRobots 를 직접
  // 참조해도 stale 클로저가 돌지 않고 타이머도 재시작되지 않는다.
  const poll = useCallback(async () => {
    try {
      const markerRobotId = connectedRobots[0]?.id;
      const positionUrl = markerRobotId
        ? `/robot/position?robot_id=${markerRobotId}`
        : `/robot/position`;
      const [posRes, statusRes] = await Promise.all([
        apiFetch(positionUrl),
        apiFetch(`/robot/status`),
      ]);
      const posData = await posRes.json();
      const statuses: RobotStatus[] = await statusRes.json();

      // 1) 마커: 위치 신선도 검사. timestamp 가 stale(끊김)이면 마커를 숨긴다.
      //    /robot/position 의 timestamp 는 '마지막 위치 수신 시각'이라 통신이
      //    끊겨도 0 으로 리셋되지 않으므로, 단순히 > 0 만 보면 마커가 영구 잔존한다.
      const nowSec = Date.now() / 1000;
      const fresh = posData.timestamp > 0 && nowSec - posData.timestamp <= POSITION_STALE_SEC;
      if (fresh) {
        setRobotPos({ x: posData.x, y: posData.y, yaw: posData.yaw });
      } else {
        setRobotPos(null);
      }

      // 2) 연결 상태 동기화 + 통신 끊긴 로봇 자동 해제.
      const statusByName = new Map(statuses.map((s) => [s.robot_name, s]));
      const dropped: string[] = [];
      setConnectedRobots((prev) => {
        let changed = false;
        const next: Robot[] = [];
        for (const robot of prev) {
          const match = statusByName.get(robot.RobotName);
          // 상태 목록에서 사라졌거나 Offline → 통신 두절로 간주해 연결 해제.
          // (Error 는 짧은 과도기이므로 유지한다.)
          if (!match || match.network === "Offline") {
            dropped.push(robot.RobotName);
            changed = true;
            continue;
          }
          if (match.current_floor_id !== robot.CurrentFloorId) {
            next.push({ ...robot, CurrentFloorId: match.current_floor_id });
            changed = true;
          } else {
            next.push(robot);
          }
        }
        return changed ? next : prev;
      });
      if (dropped.length > 0) onCommsLost?.(dropped);
    } catch (e) {
      console.error("위치 폴링 실패:", e);
    }
  }, [connectedRobots, setConnectedRobots, setRobotPos, onCommsLost]);

  // 가시성 인지 폴링(C-7): 연결 로봇이 있을 때만, 보일 때 2s, 백그라운드 일시정지
  useVisibilityAwareInterval(poll, {
    activeMs: 2000,
    hiddenMs: null,
    immediate: true,
    enabled,
  });
}
