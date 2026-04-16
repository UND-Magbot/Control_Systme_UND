"use client";

import React, { useState, useMemo, useEffect } from "react";
import styles from "../dashboard.module.css";
import type { RobotRowData, Camera, Floor, Video } from "@/app/types";
import RobotCardList from "./sections/robots/RobotCardList";
import MapSection from "./sections/map/MapSection";
import CameraSlots from "./sections/cameras/CameraSlots";
import NoticeList from "./sections/notices/NoticeList";
import SectionHeader from "./SectionHeader";
import Link from "next/link";
import { useRobotLocation } from "@/app/hooks/useRobotLocation";
import type { POIItem } from "@/app/components/map/types";
import RobotStats from "./sections/robots/RobotStats";
import ScheduleTimeline from "./sections/schedule/ScheduleTimeline";
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
  const [camerasLoading, setCamerasLoading] = useState(true);
  const [robotStats, setRobotStats] = useState<PerRobotStats | null>(null);
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

  // 컨텍스트 로드 완료 → 즉시 대시보드 표시.
  // 카메라 로드는 백그라운드에서 진행되며 완료되면 CameraSlots가 자동 반영한다.
  // (NoticeList / MapSection 등 독립 컴포넌트가 카메라 로드에 블록되지 않도록 게이트 제거)
  useEffect(() => {
    if (!statusLoaded) return;
    const firstId = liveRobots[0]?.id ?? null;
    setSelectedRobotId((prev) => prev ?? firstId);
    setPageReady();
  }, [statusLoaded]);

  const selectedRobot = useMemo(
    () => liveRobots.find((r) => r.id === selectedRobotId) ?? robots.find((r) => r.id === selectedRobotId) ?? null,
    [liveRobots, robots, selectedRobotId]
  );

  const selectedRobotNetwork = selectedRobot?.network;

  // 로봇 선택 변경 또는 online 복귀 시 카메라 로드 (초기 로드 포함)
  useEffect(() => {
    // statusLoaded 전에는 로봇/네트워크 상태가 아직 정착되지 않았으므로
    // camerasLoading을 true로 유지해 CameraSlots가 로딩 UI를 계속 표시하도록 둔다.
    // (이 상태에서 false로 뒤집으면 "로봇 연결 끊김" 이 잠깐 깜빡임)
    if (!statusLoaded) return;
    if (!selectedRobotId || selectedRobotNetwork !== "Online") {
      setRobotCameras([]);
      setCamerasLoading(false);
      return;
    }
    let cancelled = false;
    setCamerasLoading(true);
    getCamerasForRobot(selectedRobotId)
      .then((cams) => {
        if (!cancelled) setRobotCameras(cams);
      })
      .finally(() => {
        if (!cancelled) setCamerasLoading(false);
      });
    return () => { cancelled = true; };
  }, [statusLoaded, selectedRobotId, selectedRobotNetwork]);

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
          loading={camerasLoading}
        />
      </div>
    </div>
  );
}
