"use client";

import React, { useState, useMemo } from "react";
import styles from "./RobotCardList.module.css";
import type { RobotRowData, Floor, Camera, Video } from "@/app/type";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import RobotCard from "./RobotCard";
import SectionHeader from "./SectionHeader";
import RobotLegend from "@/app/components/common/RobotLegend";
import Link from "next/link";

type RobotLocation = {
  floor: string;
  placeName: string | null;
};

type RobotCardListProps = {
  robots: RobotRowData[];
  floors: Floor[];
  selectedRobotId: number | null;
  onSelectRobot: (id: number) => void;
  cameras: Camera[];
  videoStatus: Video[];
  robotLocation: RobotLocation;
  canLinkRobots?: boolean;
  canControlRobot?: boolean;
};

export default function RobotCardList({
  robots,
  floors,
  selectedRobotId,
  onSelectRobot,
  cameras,
  videoStatus,
  robotLocation,
  canLinkRobots = true,
  canControlRobot = true,
}: RobotCardListProps) {
  const { robots: liveRobots } = useRobotStatusContext();
  const [search, setSearch] = useState("");

  const visibleRobots = useMemo(() => {
    const active = liveRobots.filter((r) => r.power !== "Off");
    if (!search.trim()) return active;

    const q = search.trim().toLowerCase();
    return active.filter(
      (r) =>
        r.no.toLowerCase().includes(q) ||
        r.serialNumber.toLowerCase().includes(q) ||
        r.site.toLowerCase().includes(q)
    );
  }, [liveRobots, search]);

  const legendStats = useMemo(() => {
    let operating = 0, standby = 0, charging = 0, offline = 0;
    liveRobots.forEach(r => {
      if (r.power === "Off") { offline++; return; }
      if (r.power === "-") { offline++; return; }  // 미확인 상태도 오프라인 카운트
      if (r.isCharging) { charging++; return; }
      if (r.tasks.length > 0 && r.waitingTime === 0) { operating++; return; }
      standby++;
    });
    return { total: liveRobots.length, operating, standby, charging, offline };
  }, [liveRobots]);

  const headerRight = canLinkRobots ? (
    <Link href="/robots" className={styles.moreLink}>더보기 ›</Link>
  ) : undefined;

  return (
    <>
      <SectionHeader
        icon="/icon/robot_status_w.png"
        title="로봇 목록"
        rightSlot={headerRight}
      />

      <div className={styles.legendRow}>
        <RobotLegend stats={legendStats} />
      </div>

      <div className={styles.searchWrapper}>
        <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="로봇명, 층, 시리얼 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className={styles.searchClear} onClick={() => setSearch("")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {visibleRobots.length === 0 ? (
        <div className={styles.emptyState}>
          <span>{search ? "검색 결과가 없습니다" : "활성화된 로봇이 없습니다"}</span>
        </div>
      ) : (
        <div className={styles.scrollArea}>
          {visibleRobots.map((robot) => (
            <RobotCard
              key={robot.id}
              robot={robot}
              isSelected={robot.id === selectedRobotId}
              onClick={() => onSelectRobot(robot.id)}
              robots={robots}
              video={videoStatus}
              cameras={cameras}
              robotLocation={robotLocation}
              canControlRobot={canControlRobot}
            />
          ))}
        </div>
      )}
    </>
  );
}
