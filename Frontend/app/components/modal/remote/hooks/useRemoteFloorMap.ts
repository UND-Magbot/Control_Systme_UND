"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import { getApiBase } from "@/app/config";
import type { MapConfig } from "@/app/components/map/types";

/**
 * 로봇의 현재 층(floorId)에 등록된 맵을 로드해 CanvasMap용 MapConfig를 반환한다.
 * 맵이 없거나 로딩 실패 시 null. 대시보드 MapSection과 동일한 방식
 * (맵 row → yaml meta(origin/resolution) → 이미지 자연 크기)으로 구성한다.
 *
 * 원격 화면 맵을 고정 데모 맵 대신 실제 층 맵으로 표시하기 위함. origin/resolution이
 * 실제 맵 기준이 되므로 로봇 마커 좌표도 정확히 찍힌다.
 */
export function useRemoteFloorMap(floorId: number | null): MapConfig | null {
  const [config, setConfig] = useState<MapConfig | null>(null);

  useEffect(() => {
    if (floorId == null) {
      setConfig(null);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const mapsRes = await apiFetch(`/map/maps?floor_id=${floorId}`);
        const maps = await mapsRes.json();
        if (cancelled) return;
        if (!Array.isArray(maps) || maps.length === 0) {
          setConfig(null);
          return;
        }

        const map = maps[0];
        const imgPath =
          map.ImgFilePath?.replace("./", "/") || map.PgmFilePath?.replace("./", "/");
        if (!imgPath) {
          setConfig(null);
          return;
        }
        const imageSrc = `${getApiBase()}${imgPath}`;

        const metaRes = await apiFetch(`/map/maps/${map.id}/meta`);
        const meta = await metaRes.json();
        if (cancelled) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imageSrc;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
        if (cancelled) return;

        setConfig({
          imageSrc,
          resolution: meta.resolution ?? 0.1,
          originX: meta.originX ?? 0,
          originY: meta.originY ?? 0,
          pixelWidth: img.naturalWidth || 335,
          pixelHeight: img.naturalHeight || 450,
        });
      } catch {
        if (!cancelled) setConfig(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [floorId]);

  return config;
}
