"use client";
import React, { useRef, useState } from "react";
import type { RobotRowData, Camera, Floor, Video } from "@/app/type";
import { CanvasMap } from "@/app/components/map";
import type { CanvasMapHandle } from "@/app/components/map";
import { OCC_GRID_CONFIG } from "@/app/components/map/mapConfigs";
import styles from "./RobotList.module.css";
import { ZoomControl } from "@/app/components/button";
import RemoteMapModal from "@/app/components/modal/RemoteMapModal";
import { useRobotPosition } from "@/app/hooks/useRobotPosition";

type CombinedProps = {
  selectedRobotId: number | null;
  selectedRobot: RobotRowData | null;
  cameras: Camera[];
  robots: RobotRowData[];
  video: Video[];
  floors: Floor[];
};

export default function MapViewComponent({
  selectedRobot,
  robots,
  video,
  cameras,
}: CombinedProps) {
  const mapRef = useRef<CanvasMapHandle>(null);
  const [pathModalOpen, setPathModalOpen] = useState(false);
  const { position: robotPos } = useRobotPosition(!!selectedRobot);

  const handleZoom = (action: string) => {
    mapRef.current?.handleZoom(action as "in" | "out" | "reset");
  };

  return (
    <div className={styles.mapWrapper}>
      <CanvasMap
        ref={mapRef}
        config={OCC_GRID_CONFIG}
        className={styles.mapCanvas}
        showRobot={!!selectedRobot}
        robotPos={selectedRobot ? robotPos : undefined}
        robotMarkerSize={14}
      />

      {/* 좌상단: 층 */}
      <div className={styles.cornerTopLeft}>
        <span className={styles.cornerLabel}>1F</span>
      </div>

      {/* 우상단: 전체보기 */}
      <div className={styles.cornerTopRight}>
        <div className={styles.overlayBtn} onClick={() => setPathModalOpen(true)}>
          <img src="/icon/full-screen.png" alt="전체보기" />
        </div>
      </div>

      {/* 우하단: 줌 버튼 (대시보드와 동일) */}
      <ZoomControl onClick={handleZoom} />

      <RemoteMapModal
        isOpen={pathModalOpen}
        onClose={() => setPathModalOpen(false)}
        selectedRobots={selectedRobot}
        robots={robots}
        video={video}
        camera={cameras}
        primaryView="map"
      />
    </div>
  );
}
