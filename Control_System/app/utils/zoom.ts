// app/utils/zoom.ts
import type { Dispatch, SetStateAction } from "react";

export type ZoomAction = "in" | "out" | "reset";

export type ZoomOptions = {
  min?: number;       // 최소 배율
  max?: number;       // 최대 배율
  step?: number;      // 한번 클릭시 변경량
  resetScale?: number; // reset 일 때 값
};

/**
 * 공통 Zoom 핸들러 생성 함수
 * 각 컴포넌트에서 setScale만 넘겨주고 재사용
 */
export function createZoomHandler(
  setScale: Dispatch<SetStateAction<number>>,
  options: ZoomOptions = {}
) {
  const {
    min = 0.5,
    max = 3,
    step = 0.2,
    resetScale = 1,
  } = options;

  return (action: ZoomAction) => {
    setScale(prev => {
      if (action === "in")  return Math.min(prev + step, max);
      if (action === "out") return Math.max(prev - step, min);
      // 나머지("reset" 등)은 초기값으로
      return resetScale;
    });
  };
}