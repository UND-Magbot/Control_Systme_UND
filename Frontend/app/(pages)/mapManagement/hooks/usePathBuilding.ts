"use client";

import { useCallback, useState } from "react";
import { WORK_TYPES } from "@/app/lib/taskType";

/**
 * 경로 생성 모드(way_info) 상태 번들.
 * - isPathBuildMode: 모드 활성 여부
 * - pathBuildOrder: 현재까지 선택한 장소 이름 배열
 * - pathBuildName: 저장 시 사용할 경로명
 * - pathBuildWorkType: 작업 유형(길 안내/물품 운반/순찰·점검)
 *
 * reset(): 모드를 완전히 해제(활성화 off + 순서/이름 초기화).
 */
export function usePathBuilding() {
  const [isPathBuildMode, setIsPathBuildMode] = useState(false);
  const [pathBuildOrder, setPathBuildOrder] = useState<string[]>([]);
  const [pathBuildWaits, setPathBuildWaits] = useState<number[]>([]);
  const [pathBuildName, setPathBuildName] = useState("");
  const [pathBuildWorkType, setPathBuildWorkType] = useState(WORK_TYPES[0].label);

  const reset = useCallback(() => {
    setIsPathBuildMode(false);
    setPathBuildOrder([]);
    setPathBuildWaits([]);
  }, []);

  return {
    isPathBuildMode,
    setIsPathBuildMode,
    pathBuildOrder,
    setPathBuildOrder,
    pathBuildWaits,
    setPathBuildWaits,
    pathBuildName,
    setPathBuildName,
    pathBuildWorkType,
    setPathBuildWorkType,
    reset,
  };
}
