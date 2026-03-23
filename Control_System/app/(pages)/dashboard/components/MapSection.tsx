"use client";

import styles from "./MapSection.module.css";
import { ZoomControl, FloorSelectBox, RobotPathBtn } from "@/app/components/button";
import SectionHeader from "./SectionHeader";
import selectModernStyles from "@/app/components/button/SelectModern.module.css";
import { useState, useEffect, useRef } from "react";
import type { Floor, RobotRowData, Video, Camera } from "@/app/type";
import { CanvasMap } from "@/app/components/map";
import type { CanvasMapHandle } from "@/app/components/map";
import { OCC_GRID_CONFIG } from "@/app/components/map/mapConfigs";
import { useRobotPosition } from "@/app/hooks/useRobotPosition";
import { API_BASE } from "@/app/config";

type MapSectionProps = {
  floors: Floor[];
  robots: RobotRowData[];
  video: Video[];
  cameras: Camera[];
};

export default function MapSection({ floors, robots, video, cameras }: MapSectionProps) {
  const [floorActiveIndex, setFloorActiveIndex] = useState<number>(0);
  const [selectedFloor, setSelectedFloor] = useState<Floor | null>(null);
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);

  const mapRef = useRef<CanvasMapHandle>(null);
  const { position: robotPos, hasError: robotPosError, isReady: robotPosReady } = useRobotPosition(true);

  const hasFloors = floors.length > 0;
  const hasRobots = robots.length > 0;

  // 초기 마운트 시 첫 번째 층 자동 선택
  useEffect(() => {
    if (hasFloors && !selectedFloor) {
      setSelectedFloor(floors[0]);
    }
  }, [floors]);

  const handleFloorSelect = (idx: number, floor: Floor) => {
    setFloorActiveIndex(idx);
    setSelectedFloor(floor);
  };

  const displayFloorName = selectedFloor?.label || floors[0]?.label || "1F";

  const handleZoomFromChild = (action: string) => {
    mapRef.current?.handleZoom(action as "in" | "out" | "reset");
  };

  return (
    <>
      <SectionHeader
        icon="/icon/map_w.png"
        title="로봇 위치"
      />
      <div className={styles["middle-div"]}>
        <div className={styles["view-div"]}>
          {/* 로봇 미등록 */}
          {!hasRobots && (
            <div className={styles.emptyOverlay}>
              <span>등록된 로봇이 없습니다.</span>
              <span className={styles.emptySubText}>로봇을 등록하면 위치를 확인할 수 있습니다.</span>
            </div>
          )}

          {/* 층 데이터 없음 */}
          {hasRobots && !hasFloors && (
            <div className={styles.emptyOverlay}>
              <span>등록된 층이 없습니다.</span>
              <span className={styles.emptySubText}>층 정보를 등록하면 맵을 확인할 수 있습니다.</span>
            </div>
          )}

          {/* 로봇 위치 수신 에러 표시 */}
          {hasRobots && hasFloors && robotPosError && (
            <div className={styles.posErrorBadge}>위치 수신 불가</div>
          )}

          {/* 층 이름 오버레이: 데이터 있을 때만 */}
          {hasRobots && hasFloors && (
            <div className={styles.FloorName}>{displayFloorName}</div>
          )}

          <CanvasMap
            ref={mapRef}
            config={OCC_GRID_CONFIG}
            robotPos={hasRobots && robotPosReady && !robotPosError ? robotPos : null}
            showRobot
          />
          {hasRobots && hasFloors && <ZoomControl onClick={handleZoomFromChild} />}
        </div>
      </div>

      <div className={styles["bottom-div"]}>
        {hasFloors ? (
          <FloorSelectBox
            floors={floors}
            activeIndex={floorActiveIndex}
            selectedFloor={selectedFloor}
            onSelect={handleFloorSelect}
            className={styles.customSelectBox}
            selectStyles={selectModernStyles}
          />
        ) : (
          <div />
        )}
        <RobotPathBtn selectedRobots={selectedRobot} robots={robots} video={video} camera={cameras} variant="modern" />
      </div>
    </>
  );
}
