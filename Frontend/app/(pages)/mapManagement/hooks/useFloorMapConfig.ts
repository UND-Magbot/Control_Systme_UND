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

    const loadImage = () =>
      new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        // 같은 static 이미지 URL 을 맵 편집 페이지(page.tsx)에서는
        // crossOrigin="anonymous"(캔버스 processMapImage 용)로 로드한다.
        // 이 훅에서 crossOrigin 없이 먼저 로드하면 비-CORS 응답이 브라우저
        // 캐시에 남고, 뒤이은 crossOrigin 요청이 그 캐시를 재사용하며
        // "No Access-Control-Allow-Origin header" CORS 에러가 난다(크롬 캐시 동작).
        // 두 로더의 CORS 모드를 반드시 일치시켜 캐시 오염을 막는다.
        img.crossOrigin = "anonymous";
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = imageSrc;
      });

    // meta(=/map/maps/{id}/meta)는 ensure_local 로 로컬에 없는 맵 파일을
    // 공유 DB BLOB 에서 복원한 뒤 응답한다. 이미지를 meta 와 병렬로 로드하면
    // 복원 완료 전에 정적요청(/static/maps/x.png)이 나가 404 → 맵이 안 뜬다
    // (로컬에 파일이 있는 맵만 우연히 성공). 따라서 meta 를 먼저 끝내
    // 복원을 보장한 뒤 이미지를 로드한다.
    apiFetch(`/map/maps/${mapId}/meta`)
      .then((res) => (res.ok ? res.json() : null))
      .then((meta) => {
        if (cancelled) return;
        if (!meta) {
          setConfig(null);
          return;
        }
        loadImage()
          .then((size) => {
            if (cancelled) return;
            if (!size.w || !size.h) {
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
