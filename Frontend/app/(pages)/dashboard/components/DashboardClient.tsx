"use client";

import React, { useState, useMemo, useEffect } from "react";
import styles from "../dashboard.module.css";
import type { RobotRowData, Camera, Floor, Video } from "@/app/type";
import RobotCardList from "./RobotCardList";
import MapSection from "./MapSection";
import CameraSlots from "./CameraSlots";
import NoticeList from "./NoticeList";
import SectionHeader from "./SectionHeader";
import Link from "next/link";
import { useRobotLocation } from "@/app/hooks/useRobotLocation";
import type { POIItem } from "@/app/components/map/types";
import RobotStats from "./RobotStats";
import ScheduleTimeline from "./ScheduleTimeline";
import { getCamerasForRobot } from "@/app/lib/cameraView";
import { getStatistics, type PerRobotStats } from "@/app/lib/statisticsApi";
import { usePageReady } from "@/app/context/PageLoadingContext";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";

type DashboardClientProps = {
  floors: Floor[];
  videoStatus: Video[];
};

export default function DashboardClient({
  floors,
  videoStatus,
}: DashboardClientProps) {
  const { robots: liveRobots, loaded: statusLoaded } = useRobotStatusContext();
  const [robots, setRobots] = useState<RobotRowData[]>([]);
  const [selectedRobotId, setSelectedRobotId] = useState<number | null>(null);
  const [robotCameras, setRobotCameras] = useState<Camera[]>([]);
  const [robotStats, setRobotStats] = useState<PerRobotStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const robotLocation = useRobotLocation();

  // useRobotLocation에서 가져온 places를 MapSection용 POIItem으로 변환
  const mapPlaces = useMemo<POIItem[]>(
    () => robotLocation.places.map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      floor: p.floor,
      category: "work" as const,
    })),
    [robotLocation.places]
  );
  const setPageReady = usePageReady();

  // 컨텍스트 로드 완료 시 첫 번째 로봇 선택 + 카메라 로드
  useEffect(() => {
    if (!statusLoaded) return;
    const firstId = liveRobots[0]?.id ?? null;
    setSelectedRobotId((prev) => prev ?? firstId);
    if (firstId && isLoading) {
      getCamerasForRobot(firstId).then(setRobotCameras).finally(() => {
        setIsLoading(false);
        setPageReady();
      });
    } else {
      setIsLoading(false);
      setPageReady();
    }
  }, [statusLoaded]);

  const selectedRobot = useMemo(
    () => liveRobots.find((r) => r.id === selectedRobotId) ?? robots.find((r) => r.id === selectedRobotId) ?? null,
    [liveRobots, robots, selectedRobotId]
  );

  const selectedRobotNetwork = selectedRobot?.network;

  // 로봇 선택 변경 또는 online 복귀 시 카메라 재로드
  useEffect(() => {
    if (isLoading) return;
    if (!selectedRobotId || selectedRobotNetwork !== "Online") {
      setRobotCameras([]);
      return;
    }
    getCamerasForRobot(selectedRobotId).then(setRobotCameras);
  }, [selectedRobotId, selectedRobotNetwork]);

  // 선택된 로봇의 통계 데이터 로드
  useEffect(() => {
    if (!selectedRobot?.no) {
      setRobotStats(null);
      return;
    }
    let cancelled = false;
    getStatistics({ robot_name: selectedRobot.no }).then((result) => {
      if (!cancelled) setRobotStats(result.data.per_robot[0] ?? null);
    });
    return () => { cancelled = true; };
  }, [selectedRobot?.no]);

  if (isLoading) return null;

  return (
    <div className={styles.dashboardGrid}>
      {/* ── 좌측 컬럼 ── */}
      <div className={styles.leftColumn}>
        {/* 로봇 카드 리스트 */}
        <div className={styles.robotListPanel}>
          <RobotCardList
            robots={liveRobots}
            floors={floors}
            selectedRobotId={selectedRobotId}
            onSelectRobot={setSelectedRobotId}
            cameras={robotCameras}
            videoStatus={videoStatus}
            robotLocation={robotLocation}
          />
        </div>

        {/* 공지사항 */}
        <div className={styles.noticePanel}>
          <SectionHeader
            icon="/icon/notice_w.png"
            title="공지사항"
            rightSlot={
              <Link href="/alerts?tab=notice" prefetch={false} className={styles.moreLink}>
                더보기 ›
              </Link>
            }
          />
          <NoticeList />
        </div>
      </div>

      {/* ── 중앙: 통계 + 맵 ── */}
      <div className={styles.centerColumn}>
        <div className={styles.infoRow}>
          <RobotStats stats={robotStats} />
          <ScheduleTimeline robotName={selectedRobot?.no} />
        </div>
        <MapSection
          floors={floors}
          robots={liveRobots}
          video={videoStatus}
          cameras={robotCameras}
          selectedRobotId={selectedRobotId}
          selectedRobotName={selectedRobot?.no}
          robotFloorId={selectedRobot?.currentFloorId ?? null}
        />
      </div>

      {/* ── 우측: 카메라 세로 스택 ── */}
      <div className={styles.cameraColumn}>
        <CameraSlots
          cameras={robotCameras}
          robotCameras={robotCameras}
          videoItems={[]}
          selectedRobot={selectedRobot}
          robots={liveRobots}
          video={videoStatus}
        />
      </div>
    </div>
  );
}
