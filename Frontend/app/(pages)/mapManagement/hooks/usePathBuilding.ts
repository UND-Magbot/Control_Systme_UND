"use client";

import { useCallback, useState } from "react";

/**
 * 경로 생성 모드(way_info) 상태 번들.
 * - isPathBuildMode: 모드 활성 여부
 * - pathBuildOrder: 현재까지 선택한 장소 이름 배열
 * - pathBuildName: 저장 시 사용할 경로명
 * - pathBuildWorkType: 작업 타입(task1/2/3)
 *
 * reset(): 모드를 완전히 해제(활성화 off + 순서/이름 초기화).
 */
export function usePathBuilding() {
  const [isPathBuildMode, setIsPathBuildMode] = useState(false);
  const [pathBuildOrder, setPathBuildOrder] = useState<string[]>([]);
  const [pathBuildName, setPathBuildName] = useState("");
  const [pathBuildWorkType, setPathBuildWorkType] = useState("task1");

  const reset = useCallback(() => {
    setIsPathBuildMode(false);
    setPathBuildOrder([]);
  }, []);

  return {
    isPathBuildMode,
    setIsPathBuildMode,
    pathBuildOrder,
    setPathBuildOrder,
    pathBuildName,
    setPathBuildName,
    pathBuildWorkType,
    setPathBuildWorkType,
    reset,
  };
}
