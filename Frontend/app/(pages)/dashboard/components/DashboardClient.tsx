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
import RobotStats from "./RobotStats";
import ScheduleTimeline from "./ScheduleTimeline";
import getRobots from "@/app/lib/robotInfo";
import { getCamerasForRobot } from "@/app/lib/cameraView";

type DashboardClientProps = {
  floors: Floor[];
  videoStatus: Video[];
};

export default function DashboardClient({
  floors,
  videoStatus,
}: DashboardClientProps) {
  const [robots, setRobots] = useState<RobotRowData[]>([]);
  const [selectedRobotId, setSelectedRobotId] = useState<number | null>(null);
  const [robotCameras, setRobotCameras] = useState<Camera[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const robotLocation = useRobotLocation();

  // 로봇 + 첫 번째 로봇의 카메라까지 로드 완료 후 로딩 해제
  useEffect(() => {
    setIsLoading(true);
    getRobots().then(async (fetched) => {
      setRobots(fetched);
      const firstId = fetched[0]?.id ?? null;
      setSelectedRobotId(firstId);
      if (firstId) {
        const cams = await getCamerasForRobot(firstId);
        setRobotCameras(cams);
      }
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  const selectedRobot = useMemo(
    () => robots.find((r) => r.id === selectedRobotId) ?? null,
    [robots, selectedRobotId]
  );

  // 로봇 선택 변경 시 카메라 재로드 (초기 로드 제외)
  useEffect(() => {
    if (isLoading) return; // 초기 로드 중이면 스킵
    if (!selectedRobotId) {
      setRobotCameras([]);
      return;
    }
    getCamerasForRobot(selectedRobotId).then(setRobotCameras);
  }, [selectedRobotId]);

  if (isLoading) {
    return (
      <div className={styles.dashboardLoading}>
        <div className={styles.dashboardSpinner} />
        <span>대시보드를 불러오는 중...</span>
      </div>
    );
  }

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
          cameras={robotCameras}
          selectedRobotId={selectedRobotId}
          selectedRobotName={selectedRobot?.no}
          robotFloor={robotLocation.floor}
        />
      </div>

      {/* ── 우측: 카메라 세로 스택 ── */}
      <div className={styles.cameraColumn}>
        <CameraSlots
          cameras={robotCameras}
          robotCameras={robotCameras}
          videoItems={[]}
          selectedRobot={selectedRobot}
          robots={robots}
          video={videoStatus}
        />
      </div>
    </div>
  );
}
