"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import type { POIItem } from "@/app/components/map/types";
import { toPoiItem, isMappablePlace, type PlaceRow } from "@/app/lib/placeFilter";

/**
 * 로봇의 현재 층에 등록된 장소를 원격 화면 맵용 POI 로 반환한다.
 * 맵이 없거나 조회 실패면 빈 배열.
 *
 * useRemoteFloorMap 과 층→맵 조회가 겹치지만, 맵 렌더(이미 검증된 경로)를 건드리지 않으려고
 * 별도 훅으로 둔다. 층이 바뀔 때만 도는 저빈도 요청이라 비용도 작다.
 *
 * ⚠ 한 층에 맵이 여러 개일 수 있어(개발 DB floorId=3 → map 21·22) 둘 다 maps[0] 을 쓴다.
 *   서버가 id desc 로 정렬해 주므로 같은 맵이 선택된다 — 이 정렬이 바뀌면 POI 가 다른 맵
 *   좌표계로 찍히니 useRemoteFloorMap 과 함께 고쳐야 한다.
 */
export function useRemoteFloorPois(floorId: number | null): POIItem[] {
  const [pois, setPois] = useState<POIItem[]>([]);

  useEffect(() => {
    if (floorId == null) {
      setPois([]);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const mapsRes = await apiFetch(`/map/maps?floor_id=${floorId}`);
        const maps = await mapsRes.json();
        if (cancelled) return;
        if (!Array.isArray(maps) || maps.length === 0) {
          setPois([]);
          return;
        }

        const res = await apiFetch(`/DB/places?map_id=${maps[0].id}`);
        const rows: PlaceRow[] = res.ok ? await res.json() : [];
        if (cancelled) return;

        setPois(
          (Array.isArray(rows) ? rows : []).map(toPoiItem).filter(isMappablePlace)
        );
      } catch {
        if (!cancelled) setPois([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [floorId]);

  return pois;
}
