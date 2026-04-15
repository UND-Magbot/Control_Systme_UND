"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import { API_BASE } from "@/app/config";
import type { MapConfig } from "@/app/components/map/types";

/** 서버에서 내려오는 RobotMapInfo row (관심 필드만). */
export type FloorMapRow = {
  id: number;
  BusinessId: number;
  FloorId: number;
  MapName: string;
  PgmFilePath?: string | null;
  YamlFilePath?: string | null;
  ImgFilePath?: string | null;
};

/** 특정 map row + meta 로 CanvasMap용 MapConfig 를 생성하는 훅.
 *  mapId가 null이거나 maps에 해당 row가 없으면 null을 반환. */
export function useFloorMapConfig(
  mapId: number | null,
  maps: FloorMapRow[],
): MapConfig | null {
  const [config, setConfig] = useState<MapConfig | null>(null);

  useEffect(() => {
    if (mapId == null) {
      setConfig(null);
      return;
    }
    const row = maps.find((m) => m.id === mapId);
    if (!row) {
      setConfig(null);
      return;
    }

    const relPath = (row.ImgFilePath || row.PgmFilePath || "").replace("./", "");
    if (!relPath) {
      setConfig(null);
      return;
    }
    const imageSrc = `${API_BASE}/${relPath}`;

    let cancelled = false;

    // 이미지 자연 크기 + YAML meta 병렬 로드
    const loadImage = () =>
      new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = imageSrc;
      });

    Promise.all([
      loadImage(),
      apiFetch(`/map/maps/${mapId}/meta`).then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([size, meta]) => {
        if (cancelled) return;
        if (!meta || !size.w || !size.h) {
          setConfig(null);
          return;
        }
        setConfig({
          imageSrc,
          resolution: meta.resolution ?? 0.1,
          originX: meta.originX ?? 0,
          originY: meta.originY ?? 0,
          pixelWidth: size.w,
          pixelHeight: size.h,
        });
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });

    return () => {
      cancelled = true;
    };
  }, [mapId, maps]);

  return config;
}
