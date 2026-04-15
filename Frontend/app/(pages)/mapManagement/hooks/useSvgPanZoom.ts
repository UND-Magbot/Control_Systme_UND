"use client";

import { useEffect, useRef, useState } from "react";

/**
 * SVG 맵 뷰의 viewport 상태와 마우스 휠 줌을 관리.
 *
 * 반환:
 * - zoom, rotation, offset: 현재 viewport 상태
 * - setZoom, setRotation, setOffset: 직접 제어(초기 중앙 배치, 회전 버튼 등)
 * - svgRef: `<svg>` element에 붙이는 ref
 *
 * 마우스 드래그 팬과 장소 드래그는 page.tsx의 통합 핸들러에서 처리되므로
 * 이 훅은 wheel 이벤트만 자체적으로 바인딩한다.
 */
export function useSvgPanZoom(processedImgReady: boolean) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  // 마우스 휠 줌 (passive: false로 등록해야 preventDefault 가능)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((prev) =>
        Math.max(0.1, Math.min(10, prev * (e.deltaY < 0 ? 1.1 : 0.9)))
      );
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [processedImgReady]);

  return {
    zoom,
    setZoom,
    rotation,
    setRotation,
    offset,
    setOffset,
    svgRef,
  };
}
