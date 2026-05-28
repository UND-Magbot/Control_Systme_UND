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
import { useAuth } from "@/app/context/AuthContext";

type DashboardClientProps = {
  floors: Floor[];
  videoStatus: Video[];
};

export default function DashboardClient({
  floors,
  videoStatus,
}: DashboardClientProps) {
  const { robots: liveRobots, loaded: statusLoaded } = useRobotStatusContext();
  const { user } = useAuth();
  const isAdmin = user?.role === 1 || user?.role === 2;
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
    setPageReady();
    const firstOnline = liveRobots.find((r) => r.power === "On");
    const firstId = firstOnline?.id ?? null;
    setSelectedRobotId((prev) => {
      // 이미 선택된 로봇이 목록에 있으면 유지 — offline 으로 잠깐 전환돼도
      // 선택을 풀지 않는다(네트워크 블립마다 카메라/맵이 깜빡이는 것 방지).
      if (prev != null && liveRobots.some((r) => r.id === prev)) return prev;
      // 선택이 없거나 로봇이 목록에서 사라진 경우 → 첫 online 로봇 자동 선택
      return firstId;
    });
  }, [statusLoaded, liveRobots]);

  const selectedRobot = useMemo(
    () => liveRobots.find((r) => r.id === selectedRobotId) ?? robots.find((r) => r.id === selectedRobotId) ?? null,
    [liveRobots, robots, selectedRobotId]
  );

  // 로봇 선택 변경 시 카메라 목록 로드 (초기 로드 포함).
  // 네트워크 상태와 무관하게 selectedRobotId 기준으로만 로드한다 — 카메라
  // 목록은 DB 조회라 오프라인이어도 가져올 수 있고, 실제 스트림 끊김/재연결은
  // 백엔드 RTSP 프록시가 투명하게 처리하므로 오프라인 시 목록을 비우지 않는다.
  useEffect(() => {
    // statusLoaded 전에는 로봇 상태가 정착되지 않았으므로 로딩 UI를 유지한다.
    if (!statusLoaded) return;
    if (!selectedRobotId) {
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
  }, [statusLoaded, selectedRobotId]);

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
            canLinkRobots={isAdmin}
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
