"use client";

import React, { useEffect, useRef } from "react";
import { useDetectionOverlay, type DetectionBox } from "./useDetectionOverlay";

type Props = {
  /** MediaMTX path 이름 — 이 path의 검출 결과만 그린다. */
  pathName: string | null;
};

// 종류별 박스 색. 온도가 임계 이상이면 색을 덮어쓴다.
const KIND_COLOR: Record<string, string> = {
  person: "#4aa3ff",
  face: "#92d050",
  hotpack: "#f0c674",
};
const DEFAULT_COLOR = "#92d050";
// 위험 온도 — thermal_max_overlay.py 의 알람 임계와 맞춘다.
const HOT_TEMP = 45;
const HOT_COLOR = "#ff5a5a";

function colorOf(box: DetectionBox): string {
  if (typeof box.temp === "number" && box.temp >= HOT_TEMP) return HOT_COLOR;
  return KIND_COLOR[box.kind ?? ""] ?? DEFAULT_COLOR;
}

/**
 * 검출 박스·온도를 영상 위에 그리는 canvas.
 *
 * 박스 좌표는 정규화(0~1)로 오므로 표시 크기에 그대로 곱하면 된다 —
 * 검출 해상도와 송출 해상도가 달라도, 창 크기가 바뀌어도 맞는다.
 * 검출 결과가 없으면 아무것도 그리지 않으므로 열화상이 아닌 카메라에 붙여도 무해하다.
 */
export default function DetectionOverlay({ pathName }: Props) {
  const boxes = useDetectionOverlay(pathName);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      // CSS 크기 → 실제 픽셀(레티나 대응). 크기가 바뀌면 canvas 버퍼도 맞춘다.
      const dpr = window.devicePixelRatio || 1;
      const cssW = parent.clientWidth;
      const cssH = parent.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      if (boxes.length === 0) return;

      // 작은 슬롯에서도 읽히도록 폭에 비례해 글씨/선 두께를 잡는다.
      const fontPx = Math.max(10, Math.min(16, cssW / 40));
      const lineW = Math.max(1.2, cssW / 500);
      ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
      ctx.textBaseline = "bottom";

      for (const b of boxes) {
        const x = b.x * cssW;
        const y = b.y * cssH;
        const w = b.w * cssW;
        const h = b.h * cssH;
        const color = colorOf(b);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineW;
        ctx.strokeRect(x, y, w, h);

        if (!b.label) continue;
        // 라벨은 박스 위에 두되, 화면 밖으로 나가면 박스 안쪽으로 넣는다.
        const tw = ctx.measureText(b.label).width;
        const padX = 4;
        const boxH = fontPx + 4;
        let lx = x;
        let ly = y - 2;
        if (ly - boxH < 0) ly = y + boxH + 2;
        if (lx + tw + padX * 2 > cssW) lx = Math.max(0, cssW - tw - padX * 2);

        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(lx, ly - boxH, tw + padX * 2, boxH);
        ctx.fillStyle = color;
        ctx.fillText(b.label, lx + padX, ly - 2);
      }
    };

    draw();
    // 창/슬롯 크기 변화 추적 — 확대 모달 전환에서도 좌표가 맞는다.
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [boxes]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 3,
        pointerEvents: "none",
      }}
    />
  );
}
