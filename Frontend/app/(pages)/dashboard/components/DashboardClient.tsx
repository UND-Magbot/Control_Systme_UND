"use client";

import React, { useState, useMemo } from "react";
import styles from "../dashboard.module.css";
import type { RobotRowData, Camera, Floor, Video, VideoItem } from "@/app/type";
import RobotCardList from "./RobotCardList";
import MapSection from "./MapSection";
import CameraSlots from "./CameraSlots";
import NoticeList from "./NoticeList";
import SectionHeader from "./SectionHeader";
import Link from "next/link";
import { useRobotLocation } from "@/app/hooks/useRobotLocation";
import RobotStats from "./RobotStats";
import ScheduleTimeline from "./ScheduleTimeline";

type DashboardClientProps = {
  robots: RobotRowData[];
  cameras: Camera[];
  floors: Floor[];
  videoStatus: Video[];
  videoItems: VideoItem[];
};

export default function DashboardClient({
  robots,
  cameras,
  floors,
  videoStatus,
  videoItems,
}: DashboardClientProps) {
  const [selectedRobotId, setSelectedRobotId] = useState<number | null>(
    robots[0]?.id ?? null
  );
  const robotLocation = useRobotLocation();

  const selectedRobot = useMemo(
    () => robots.find((r) => r.id === selectedRobotId) ?? null,
    [robots, selectedRobotId]
  );

  // 선택된 로봇에 매핑된 카메라 목록
  const robotCameras = useMemo(() => {
    if (!selectedRobot) return [];
    const matched = videoItems
      .filter((v) => v.robotNo === selectedRobot.no)
      .map((v) => cameras.find((c) => c.label === v.cameraNo))
      .filter(Boolean) as Camera[];
    return matched;
  }, [selectedRobot, videoItems, cameras]);

  return (
    <div className={styles.dashboardGrid}>
      {/* ── 좌측 컬럼 ── */}
      <div className={styles.leftColumn}>
        {/* 로봇 카드 리스트 */}
        <div className={styles.robotListPanel}>
          <RobotCardList
            robots={robots}
            floors={floors}
            selectedRobotId={selectedRobotId}
            onSelectRobot={setSelectedRobotId}
            cameras={cameras}
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
              <Link href="/alerts?tab=notice" className={styles.moreLink}>
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
          <RobotStats robot={selectedRobot} />
          <ScheduleTimeline robotName={selectedRobot?.no} />
        </div>
        <MapSection
          floors={floors}
          robots={robots}
          video={videoStatus}
          cameras={cameras}
          selectedRobotId={selectedRobotId}
          robotFloor={robotLocation.floor}
        />
      </div>

      {/* ── 우측: 카메라 세로 스택 ── */}
      <div className={styles.cameraColumn}>
        <CameraSlots
          cameras={cameras}
          robotCameras={robotCameras}
          videoItems={videoItems}
          selectedRobot={selectedRobot}
          robots={robots}
          video={videoStatus}
        />
      </div>
    </div>
  );
}
