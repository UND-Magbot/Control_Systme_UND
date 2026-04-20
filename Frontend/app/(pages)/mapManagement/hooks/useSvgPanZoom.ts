"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * SVG 맵 뷰의 viewport 상태와 마우스 휠 줌을 관리.
 *
 * 반환:
 * - zoom, rotation, offset: 현재 viewport 상태
 * - setZoom, setRotation, setOffset: 직접 제어(초기 중앙 배치, 회전 버튼 등)
 * - svgRef: `<svg>` element에 붙이는 ref (`.current`도 지원)
 *
 * 마우스 드래그 팬과 장소 드래그는 page.tsx의 통합 핸들러에서 처리되므로
 * 이 훅은 wheel 이벤트만 자체적으로 바인딩한다.
 */
type SvgCallbackRef = ((el: SVGSVGElement | null) => void) & {
  current: SVGSVGElement | null;
};

export function useSvgPanZoom(_processedImgReady: boolean) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);

  // Why: 탭 전환으로 <svg>가 재마운트돼도 wheel 리스너가 새 엘리먼트에 다시 붙도록,
  // useRef 대신 state 갱신을 유발하는 콜백 ref로 노출한다. 기존 `.current` 접근도 유지.
  const svgRef = useMemo<SvgCallbackRef>(() => {
    const ref = ((el: SVGSVGElement | null) => {
      ref.current = el;
      setSvgEl(el);
    }) as SvgCallbackRef;
    ref.current = null;
    return ref;
  }, []);

  // 마우스 휠 줌 (passive: false로 등록해야 preventDefault 가능)
  useEffect(() => {
    if (!svgEl) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((prev) =>
        Math.max(0.1, Math.min(10, prev * (e.deltaY < 0 ? 1.1 : 0.9)))
      );
    };
    svgEl.addEventListener("wheel", handler, { passive: false });
    return () => svgEl.removeEventListener("wheel", handler);
  }, [svgEl]);

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
