"use client";

// 위험구역 그리기 훅 — 순수 drawReducer 를 React useReducer 로 감싼다.
// 맵 클릭 핸들러에서 addPoint(world) 를 호출하면 폴리곤 꼭짓점이 쌓인다.

import { useReducer, useCallback, useMemo } from "react";
import {
  drawReducer,
  initialDrawState,
  canFinish,
} from "../dangerZone/drawReducer";
import type { ZonePoint } from "../dangerZone/types";

export type UseDangerZoneDraw = {
  /** 현재 찍힌 꼭짓점 (월드 좌표) */
  points: ZonePoint[];
  /** idle | drawing | closed */
  status: "idle" | "drawing" | "closed";
  /** 그리는 중인지 */
  isDrawing: boolean;
  /** 닫기(완성) 가능 여부 */
  canFinish: boolean;
  /** 그리기 시작 */
  start: () => void;
  /** 꼭짓점 추가 (월드 좌표) */
  addPoint: (point: ZonePoint) => void;
  /** 마지막 점 취소 */
  undo: () => void;
  /** 폴리곤 닫기(완성). 성공 시 점 배열 반환, 실패 시 null */
  finish: (minArea?: number) => ZonePoint[] | null;
  /** 초기화 */
  reset: () => void;
};

export function useDangerZoneDraw(minArea = 0.01): UseDangerZoneDraw {
  const [state, dispatch] = useReducer(drawReducer, initialDrawState);

  const start = useCallback(() => dispatch({ type: "START" }), []);
  const addPoint = useCallback(
    (point: ZonePoint) => dispatch({ type: "ADD_POINT", point }),
    []
  );
  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  const finish = useCallback(
    (area = minArea): ZonePoint[] | null => {
      if (!canFinish(state, area)) return null;
      dispatch({ type: "CLOSE", minArea: area });
      return state.points;
    },
    [state, minArea]
  );

  const finishable = useMemo(() => canFinish(state, minArea), [state, minArea]);

  return {
    points: state.points,
    status: state.status,
    isDrawing: state.status === "drawing",
    canFinish: finishable,
    start,
    addPoint,
    undo,
    finish,
    reset,
  };
}
