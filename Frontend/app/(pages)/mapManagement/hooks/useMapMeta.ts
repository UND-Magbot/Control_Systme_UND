"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";

export type MapMeta = {
  resolution: number;
  originX: number;
  originY: number;
};

/**
 * 선택된 맵의 메타데이터(해상도, 원점)를 로드.
 * selectedMap이 ""이면 null.
 */
export function useMapMeta(selectedMap: number | "") {
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null);

  useEffect(() => {
    if (selectedMap === "") {
      setMapMeta(null);
      return;
    }
    apiFetch(`/map/maps/${selectedMap}/meta`)
      .then((res) => res.json())
      .then((data) => setMapMeta(data))
      .catch(() => setMapMeta(null));
  }, [selectedMap]);

  return mapMeta;
}
