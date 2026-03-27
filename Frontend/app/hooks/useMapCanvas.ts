"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { MapConfig, NavPath } from "@/app/components/map/types";
import { worldToPixel, pixelToWorld as pixelToWorldUtil } from "@/app/utils/mapCoordinates";
import { createZoomHandler, type ZoomAction } from "@/app/utils/zoom";

/* ── 이미지 가공 캐시 ── */
const processedCache = new Map<string, HTMLCanvasElement>();

function processMapImage(img: HTMLImageElement, src: string): HTMLCanvasElement {
  const cached = processedCache.get(src);
  if (cached) return cached;

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  // 원본 픽셀 읽기
  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = W;
  rawCanvas.height = H;
  const rawCtx = rawCanvas.getContext("2d")!;
  rawCtx.drawImage(img, 0, 0);
  const srcData = rawCtx.getImageData(0, 0, W, H);
  const src8 = srcData.data;

  // OccupancyGrid 임계값
  const WALL_THRESH = 89;
  const FREE_THRESH = 205;

  // 색상 팔레트 (다크 테마 조화 + 가독성)
  const WALL_COLOR   = [130, 190, 255];    // 밝은 하늘색 벽
  const FREE_COLOR   = [90, 105, 140];     // 바닥 — 배경과 뚜렷한 대비
  const UNKNOWN_COLOR = [26, 29, 46];      // #1a1d2e — wrapper 배경과 동일

  // 1단계: 분류 맵 (0=unknown, 1=wall, 2=free)
  const classMap = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const gray = src8[i * 4];
    if (gray <= WALL_THRESH) classMap[i] = 1;
    else if (gray >= FREE_THRESH) classMap[i] = 2;
    else classMap[i] = 0;
  }

  // 2단계: 노이즈 제거 — 주변에 같은 종류가 적은 고립 픽셀 제거
  const cleaned = new Uint8Array(classMap);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      const cls = classMap[idx];
      if (cls === 0) continue;
      let sameCount = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (classMap[(y + dy) * W + (x + dx)] === cls) sameCount++;
        }
      }
      // 주변 8칸 중 같은 타입이 2개 이하면 노이즈로 판단
      if (sameCount <= 2) {
        // 주변에서 가장 많은 타입으로 교체
        const counts = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            counts[classMap[(y + dy) * W + (x + dx)]]++;
          }
        }
        cleaned[idx] = counts[0] >= counts[1] && counts[0] >= counts[2] ? 0
                      : counts[1] >= counts[2] ? 1 : 2;
      }
    }
  }

  // 3단계: 벽 팽창(dilate) 2회 — 끊어진 벽을 연결하고 두껍게
  let prev = cleaned;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(prev);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (prev[y * W + x] === 1) continue;
        if (
          prev[(y - 1) * W + x] === 1 ||
          prev[(y + 1) * W + x] === 1 ||
          prev[y * W + (x - 1)] === 1 ||
          prev[y * W + (x + 1)] === 1
        ) {
          next[y * W + x] = 1;
        }
      }
    }
    prev = next;
  }
  const dilated = prev;

  // 4단계: 색상 매핑 (glow 없이 깔끔하게)
  const outData = rawCtx.createImageData(W, H);
  const out8 = outData.data;

  for (let i = 0; i < W * H; i++) {
    const cls = dilated[i];
    let r: number, g: number, b: number;
    if (cls === 1) {
      [r, g, b] = WALL_COLOR;
    } else if (cls === 2) {
      [r, g, b] = FREE_COLOR;
    } else {
      [r, g, b] = UNKNOWN_COLOR;
    }
    const o = i * 4;
    out8[o] = r;
    out8[o + 1] = g;
    out8[o + 2] = b;
    out8[o + 3] = cls === 0 ? 0 : 255;  // 미탐색은 투명 → wrapper 배경이 비침
  }

  // 5단계: 안티앨리어싱 — 원본을 2배로 업스케일 후 다시 원래 크기로 (bilinear smoothing)
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = W;
  tmpCanvas.height = H;
  const tmpCtx = tmpCanvas.getContext("2d")!;
  tmpCtx.putImageData(outData, 0, 0);

  const UP = 2;
  const upCanvas = document.createElement("canvas");
  upCanvas.width = W * UP;
  upCanvas.height = H * UP;
  const upCtx = upCanvas.getContext("2d")!;
  upCtx.imageSmoothingEnabled = true;
  upCtx.imageSmoothingQuality = "high";
  upCtx.drawImage(tmpCanvas, 0, 0, W * UP, H * UP);

  const offscreen = document.createElement("canvas");
  offscreen.width = W * UP;
  offscreen.height = H * UP;
  const ctx = offscreen.getContext("2d")!;
  ctx.drawImage(upCanvas, 0, 0);

  processedCache.set(src, offscreen);
  return offscreen;
}

/* ── 이미지 로더 캐시 ── */
const imageCache = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && cached.complete) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}

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
  size: number
) {
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size, -size * 0.6);
  ctx.lineTo(-size, size * 0.6);
  ctx.closePath();
  ctx.fillStyle = "rgba(100, 180, 255, 0.9)";
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
  onWheel: (e: React.WheelEvent) => void;
  endPan: () => void;
  handleZoom: (action: ZoomAction) => void;
  worldToPixelScreen: (wx: number, wy: number) => { x: number; y: number };
  pixelToWorldScreen: (px: number, py: number) => { x: number; y: number };
};

export function useMapCanvas(
  config: MapConfig,
  navPath?: NavPath | null,
  interactive = true
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
        // 전체 포인트 수집: from → waypoints → to
        const allPoints = [
          seg.from,
          ...(seg.waypoints || []),
          seg.to,
        ];

        // 점선 경로 그리기
        ctx.save();
        ctx.strokeStyle = "rgba(100, 180, 255, 0.7)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
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

        // 4. 방향 화살표
        const fromPx = worldToPixel(seg.from.x, seg.from.y, config, renderSize);
        const toPx = worldToPixel(seg.to.x, seg.to.y, config, renderSize);
        const fsx = fromPx.x + rect.x;
        const fsy = fromPx.y + rect.y;
        const tsx = toPx.x + rect.x;
        const tsy = toPx.y + rect.y;

        if (seg.direction === "one-way") {
          drawArrowhead(ctx, fsx, fsy, tsx, tsy, 8);
        } else {
          // 양방향: 양쪽에 화살표
          drawArrowhead(ctx, fsx, fsy, tsx, tsy, 8);
          drawArrowhead(ctx, tsx, tsy, fsx, fsy, 8);
        }
      }
    }
  }, [mapSize, processedImg, navPath, config]);

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

  // wheel zoom
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!interactive) return;
      e.preventDefault();
      handleZoom(e.deltaY < 0 ? "in" : "out");
    },
    [interactive, handleZoom]
  );

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
    onWheel,
    endPan,
    handleZoom,
    worldToPixelScreen,
    pixelToWorldScreen,
  };
}
