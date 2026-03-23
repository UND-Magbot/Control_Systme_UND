"use client";

import React, { useRef, useMemo } from "react";
import { CanvasMap } from "@/app/components/map";
import type { CanvasMapHandle, POIItem, NavPath, NavPathSegment } from "@/app/components/map";
import { TEST_MAP_CONFIG } from "@/app/components/map/mapConfigs";
import type { ZoomAction } from "@/app/utils/zoom";
import styles from "./RobotList.module.css";

type PlaceRow = {
  id: number;
  robotNo: string;
  floor: string;
  placeName: string;
  x: number;
  y: number;
};

type PathRow = {
  id: number;
  robotNo: string;
  workType: string;
  pathName: string;
  pathOrder: string;
  updatedAt: string;
};

type Props = {
  /** 목록에서 선택된 경로 (pathOrder 문자열로 장소 매칭) */
  selectedPath?: PathRow | null;
  /** 전체 장소 목록 (좌표 매칭용) */
  placeRows?: PlaceRow[];
  /** 모달 내 실시간 미리보기용: selectedOrder 직접 전달 */
  orderPlaces?: PlaceRow[];
  /** compact 모드 (모달 내부에서 작게 표시) */
  compact?: boolean;
};

export default function PathMapView({
  selectedPath = null,
  placeRows = [],
  orderPlaces,
  compact = false,
}: Props) {
  const mapRef = useRef<CanvasMapHandle>(null);

  const optionItems = [
    { icon: "zoom-in", label: "Zoom In", action: "in" as ZoomAction },
    { icon: "zoom-out", label: "Zoom Out", action: "out" as ZoomAction },
  ];

  // 경로에 포함된 장소들 (순서대로)
  const routePlaces: PlaceRow[] = useMemo(() => {
    // 모달에서 직접 전달받은 경우
    if (orderPlaces && orderPlaces.length > 0) return orderPlaces;

    // 목록에서 선택된 경로의 pathOrder 문자열로 매칭
    if (!selectedPath) return [];
    const names = (selectedPath.pathOrder ?? "")
      .split(" - ")
      .map((s) => s.trim())
      .filter(Boolean);

    return names
      .map((nm) => placeRows.find((p) => p.placeName === nm))
      .filter((p): p is PlaceRow => p != null);
  }, [selectedPath, placeRows, orderPlaces]);

  // 첫 번째 장소의 층을 기준으로 표시
  const activeFloor = routePlaces[0]?.floor ?? "1F";

  // POI 변환 (경로에 포함된 장소만)
  const routePois: POIItem[] = useMemo(
    () =>
      routePlaces.map((p, idx) => ({
        id: p.id * 1000 + idx, // 같은 장소가 여러번 올 수 있으므로 고유 id
        name: `${idx + 1}. ${p.placeName}`,
        x: p.x,
        y: p.y,
        floor: p.floor,
        isSelected: false,
      })),
    [routePlaces]
  );

  // NavPath 생성 (장소를 순서대로 연결)
  const navPath: NavPath | null = useMemo(() => {
    if (routePlaces.length < 2) return null;

    const segments: NavPathSegment[] = [];
    for (let i = 0; i < routePlaces.length - 1; i++) {
      const from = routePlaces[i];
      const to = routePlaces[i + 1];
      segments.push({
        from: { x: from.x, y: from.y, name: from.placeName },
        to: { x: to.x, y: to.y, name: to.placeName },
        direction: "one-way",
      });
    }

    return { segments };
  }, [routePlaces]);

  return (
    <>
      {!compact && <div className={styles.floorBox}>{activeFloor}</div>}
      <CanvasMap
        ref={mapRef}
        config={TEST_MAP_CONFIG}
        pois={routePois}
        navPath={navPath}
        showPois
        showPath
        showLabels
      />

      {/* Zoom Buttons */}
      {!compact && (
        <div className={styles.zoomPosition}>
          <div className={styles.zoomFlex}>
            {optionItems.map((item, idx) => (
              <div
                key={idx}
                className={styles.zoomBox}
                onClick={() => mapRef.current?.handleZoom(item.action)}
              >
                <img src={`/icon/${item.icon}-w.png`} alt={item.label} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
