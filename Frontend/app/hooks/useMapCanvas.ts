"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { MapConfig, NavPath } from "@/app/components/map/types";
import { worldToPixel, pixelToWorld as pixelToWorldUtil } from "@/app/utils/mapCoordinates";
import { createZoomHandler, type ZoomAction } from "@/app/utils/zoom";
import { processMapImage, loadImage } from "@/app/utils/mapImageProcessor";

/* ── contain-fit 계산 ── */
function computeContainRect(
  containerW: number,
  containerH: number,
  imgW: number,
  imgH: number
) {
  const ratio = Math.min(containerW / imgW, containerH / imgH);
  const w = imgW * ratio;
  const h = imgH * ratio;
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h };
}

/* ── 방향 화살표 그리기 ── */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  size: number,
  t: number = 0.5,
  color: string = "rgba(100, 180, 255, 0.9)"
) {
  const px = fromX + (toX - fromX) * t;
  const py = fromY + (toY - fromY) * t;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size, -size * 0.6);
  ctx.lineTo(-size, size * 0.6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/* ── 메인 훅 ── */
export type UseMapCanvasReturn = {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  wrapperRef: React.RefObject<HTMLDivElement>;
  scale: number;
  translate: { x: number; y: number };
  isPanning: boolean;
  mapSize: { w: number; h: number };
  imageRect: { x: number; y: number; w: number; h: number };
  isMapLoading: boolean;
  hasMapError: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  endPan: () => void;
  handleZoom: (action: ZoomAction) => void;
  worldToPixelScreen: (wx: number, wy: number) => { x: number; y: number };
  pixelToWorldScreen: (px: number, py: number) => { x: number; y: number };
};

export function useMapCanvas(
  config: MapConfig,
  navPath?: NavPath | null,
  interactive = true,
  scanPoints?: number[][],
  poseArrow?: { x: number; y: number; yaw: number; toX?: number; toY?: number } | null
): UseMapCanvasReturn {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [mapSize, setMapSize] = useState({ w: 1, h: 1 });
  const [imageRect, setImageRect] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [processedImg, setProcessedImg] = useState<HTMLCanvasElement | null>(null);
  const [isMapLoading, setIsMapLoading] = useState(true);
  const [hasMapError, setHasMapError] = useState(false);

  // 이미지 로드 & 가공
  useEffect(() => {
    setIsMapLoading(true);
    setHasMapError(false);
    loadImage(config.imageSrc)
      .then((img) => {
        const processed = processMapImage(img, config.imageSrc);
        setProcessedImg(processed);
        setIsMapLoading(false);
      })
      .catch(() => {
        setIsMapLoading(false);
        setHasMapError(true);
      });
  }, [config.imageSrc]);

  // 리사이즈 감지
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const update = () => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      if (w > 0 && h > 0) setMapSize({ w, h });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  // Canvas 그리기
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !processedImg) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = mapSize.w * dpr;
    canvas.height = mapSize.h * dpr;
    canvas.style.width = `${mapSize.w}px`;
    canvas.style.height = `${mapSize.h}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. 배경을 미탐색 색상과 동일하게 채워서 이음새 제거
    ctx.fillStyle = "#1a1d2e";
    ctx.fillRect(0, 0, mapSize.w, mapSize.h);

    // 2. contain-fit 이미지 그리기
    const rect = computeContainRect(
      mapSize.w, mapSize.h,
      processedImg.width, processedImg.height
    );
    setImageRect(rect);
    ctx.drawImage(processedImg, rect.x, rect.y, rect.w, rect.h);

    // 3. NavPath 렌더링
    if (navPath && navPath.segments.length > 0) {
      const renderSize = { w: rect.w, h: rect.h };

      for (const seg of navPath.segments) {
        const isBidi = seg.direction === "two-way";
        const lineColor = isBidi ? "rgba(0, 230, 180, 0.75)" : "rgba(255, 180, 50, 0.8)";
        const arrowColor = isBidi ? "rgba(0, 230, 180, 0.95)" : "rgba(255, 180, 50, 0.95)";

        // 전체 포인트 수집: from → waypoints → to
        const allPoints = [
          seg.from,
          ...(seg.waypoints || []),
          seg.to,
        ];

        // 경로 선 그리기
        ctx.save();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = isBidi ? 2.5 : 2;
        ctx.setLineDash(isBidi ? [] : [6, 4]);
        ctx.beginPath();

        for (let i = 0; i < allPoints.length; i++) {
          const sp = worldToPixel(allPoints[i].x, allPoints[i].y, config, renderSize);
          const sx = sp.x + rect.x;
          const sy = sp.y + rect.y;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.restore();

        // 방향 화살표
        const fromPx = worldToPixel(seg.from.x, seg.from.y, config, renderSize);
        const toPx = worldToPixel(seg.to.x, seg.to.y, config, renderSize);
        const fsx = fromPx.x + rect.x;
        const fsy = fromPx.y + rect.y;
        const tsx = toPx.x + rect.x;
        const tsy = toPx.y + rect.y;

        if (isBidi) {
          // 양방향 <->: 짧은 선에서도 가운데 선이 보이도록 위치만 조정
          const segLen = Math.hypot(tsx - fsx, tsy - fsy);
          const t = segLen < 50 ? 0.88 : 0.75;
          drawArrowhead(ctx, tsx, tsy, fsx, fsy, 6, t, arrowColor);
          drawArrowhead(ctx, fsx, fsy, tsx, tsy, 6, t, arrowColor);
        } else {
          drawArrowhead(ctx, fsx, fsy, tsx, tsy, 7, 0.5, arrowColor);
        }
      }
    }

    // 4. 위치 재조정 — 정합 스캔 점군 오버레이(주황-빨강점). 벽과 어긋나면 측위 오차 = 재조정 대상.
    //    맵/로봇 마커가 파랑 계열이라, 스캔은 대비되는 주황-빨강으로 그려 구분한다.
    if (scanPoints && scanPoints.length > 0) {
      const renderSize = { w: rect.w, h: rect.h };
      ctx.save();
      ctx.fillStyle = "rgba(255, 94, 20, 0.92)";
      for (const pt of scanPoints) {
        const sp = worldToPixel(pt[0], pt[1], config, renderSize);
        ctx.fillRect(sp.x + rect.x - 1, sp.y + rect.y - 1, 2, 2);
      }
      ctx.restore();
    }

    // 5. 위치 재조정 — 운영자가 지정 중인 pose 화살표(위치 + 방향).
    if (poseArrow) {
      const renderSize = { w: rect.w, h: rect.h };
      const sp = worldToPixel(poseArrow.x, poseArrow.y, config, renderSize);
      const bx = sp.x + rect.x;
      const by = sp.y + rect.y;
      // 드래그 끝점(toX,toY)이 있으면 시작→끝으로 늘어나는 화살표(rviz식). 없으면 yaw+고정 길이.
      let tipX: number;
      let tipY: number;
      if (poseArrow.toX != null && poseArrow.toY != null) {
        const ep = worldToPixel(poseArrow.toX, poseArrow.toY, config, renderSize);
        tipX = ep.x + rect.x;
        tipY = ep.y + rect.y;
        // 너무 짧으면 방향이 안 보이므로 최소 길이 보장(yaw 방향으로)
        if (Math.hypot(tipX - bx, tipY - by) < 14) {
          const ang = -poseArrow.yaw;
          tipX = bx + Math.cos(ang) * 24;
          tipY = by + Math.sin(ang) * 24;
        }
      } else {
        // 화면 Y축 반전(RobotMarker 와 동일 규약): rotationDeg = -yaw
        const ang = -poseArrow.yaw;
        const len = 34;
        tipX = bx + Math.cos(ang) * len;
        tipY = by + Math.sin(ang) * len;
      }
      ctx.save();
      ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";   // 초록(위치 재조정 드래그 화살표)
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      drawArrowhead(ctx, bx, by, tipX, tipY, 8, 1.0, "rgba(34, 197, 94, 0.98)");
      ctx.fillStyle = "rgba(34, 197, 94, 0.98)";
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }, [mapSize, processedImg, navPath, config, scanPoints, poseArrow]);

  // contain-fit 기준 좌표 변환
  const worldToPixelScreen = useCallback(
    (wx: number, wy: number) => {
      const renderSize = { w: imageRect.w, h: imageRect.h };
      const p = worldToPixel(wx, wy, config, renderSize);
      return { x: p.x + imageRect.x, y: p.y + imageRect.y };
    },
    [config, imageRect]
  );

  const pixelToWorldScreen = useCallback(
    (px: number, py: number) => {
      const renderSize = { w: imageRect.w, h: imageRect.h };
      return pixelToWorldUtil(px - imageRect.x, py - imageRect.y, config, renderSize);
    },
    [config, imageRect]
  );

  // clamp
  const clampTranslate = useCallback(
    (nx: number, ny: number) => {
      const wrap = wrapperRef.current;
      if (!wrap) return { x: nx, y: ny };
      const wrapW = wrap.clientWidth;
      const wrapH = wrap.clientHeight;
      const scaledW = mapSize.w * scale;
      const scaledH = mapSize.h * scale;
      const maxX = Math.max(0, (scaledW - wrapW) / 2);
      const maxY = Math.max(0, (scaledH - wrapH) / 2);
      return {
        x: Math.min(Math.max(nx, -maxX), maxX),
        y: Math.min(Math.max(ny, -maxY), maxY),
      };
    },
    [mapSize, scale]
  );

  // zoom
  const handleZoom = useCallback(
    createZoomHandler(setScale, { min: 0.5, max: 3, step: 0.2, resetScale: 1 }),
    []
  );

  // pan handlers
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!interactive || scale <= 1) return;
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: translate.x,
        ty: translate.y,
      };
    },
    [interactive, scale, translate]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning || !panStartRef.current) return;
      const { x, y, tx, ty } = panStartRef.current;
      const next = clampTranslate(tx + (e.clientX - x), ty + (e.clientY - y));
      setTranslate(next);
    },
    [isPanning, clampTranslate]
  );

  const endPan = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  // wheel zoom — DOM에 직접 등록 (passive: false로 preventDefault 허용)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !interactive) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      handleZoom(e.deltaY < 0 ? "in" : "out");
    };
    wrapper.addEventListener("wheel", handler, { passive: false });
    return () => wrapper.removeEventListener("wheel", handler);
  }, [interactive, handleZoom]);

  // onWheel은 더 이상 사용하지 않지만 인터페이스 유지
  const onWheel = useCallback(() => {}, []);

  // 스케일 변경 시 translate 보정
  useEffect(() => {
    setTranslate((prev) => clampTranslate(prev.x, prev.y));
  }, [scale, clampTranslate]);

  return {
    canvasRef,
    wrapperRef,
    scale,
    translate,
    isPanning,
    mapSize,
    imageRect,
    isMapLoading,
    hasMapError,
    onMouseDown,
    onMouseMove,
    endPan,
    handleZoom,
    worldToPixelScreen,
    pixelToWorldScreen,
  };
}
