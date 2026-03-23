"use client";

import React, { useState } from 'react';
import type { RobotRowData } from '@/app/type';
import styles from './RobotStatusList.module.css';
import RobotDetailModal from "@/app/components/modal/RobotDetailModal";
import { useRobotStatus } from "@/app/hooks/useRobotStatus";
import {
  getBatteryIcon,
  getNetworkIcon,
  getPowerIcon,
  getBatteryColor,
  isCriticalBattery,
  ROBOT_TYPE_COLOR,
  ROBOT_TYPE_INDEX,
} from "@/app/constants/robotIcons";

type RobotStatusListProps =  {
  robotRows: RobotRowData[];
}

export default function RobotStatusList({robotRows}:RobotStatusListProps) {

  const robots = useRobotStatus(robotRows);

  const [robotActiveIndex, setRobotActiveIndex] = useState<number>(0);

  const [selectedRobotId, setSelectedRobotId] = useState<number | null>(null);
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);

  const [robotDetailModalOpen, setRobotDetailModalOpen] = useState(false);

  const ROBOT_ICONS = [
    "/icon/robot_icon(1).png",
    "/icon/robot_icon(2).png",
    "/icon/robot_icon(3).png",
    "/icon/robot_icon(4).png"
  ];

  const LOCATION_ICONS = [
    "/icon/robot_location(1).png",
    "/icon/robot_location(2).png",
    "/icon/robot_location(3).png",
    "/icon/robot_location(4).png"
  ];

  const robotInfoIcons = {
    info: (index: number) =>
      ROBOT_ICONS[index] ?? ROBOT_ICONS[0],

    battery: getBatteryIcon,
    network: getNetworkIcon,
    power: getPowerIcon,

    mark: (index: number) =>
      LOCATION_ICONS[index] ?? LOCATION_ICONS[0]
  };

  function getRowClassName(r: RobotRowData, idx: number): string {
    const classes: string[] = [];
    if (idx === robotActiveIndex) classes.push(styles.activeRow);
    if (r.power === "Off" || r.network === "Offline") classes.push(styles.offlineRow);
    return classes.join(' ');
  }

  // viewInfo 클릭 시 실행되는 핸들러
  const ViewInfoClick = (idx: number, robot: RobotRowData) => {
    setRobotActiveIndex(idx);
    setSelectedRobotId(robot.id);
    setSelectedRobot(robot);
    setRobotDetailModalOpen(true);
  };

  return (
    <>
      <div className={styles.tableWrapper}>
      <div className={styles.tableScroll}>
      <table className={styles.status}>
          <thead>
              <tr>
                  <th>로봇 명</th>
                  <th>배터리 (복귀)</th>
                  <th>네트워크</th>
                  <th>전원</th>
                  <th>위치</th>
                  <th>정보</th>
              </tr>
          </thead>
          <tbody>
          {robots.filter((r) => r.power === "On").map((r, idx) => (
              <tr
                key={r.no}
                className={getRowClassName(r, idx)}
              >
              <td>
                <span className={styles.robotName} style={{ color: ROBOT_TYPE_COLOR[r.type] }}>
                  {r.no}
                </span>
              </td>
              <td>
                <span
                  className={isCriticalBattery(r) ? styles.criticalBattery : ''}
                  style={{ color: getBatteryColor(r.battery, r.return) }}
                >
                  {r.battery}% ({r.return}%)
                </span>
              </td>
              <td>
                <span className={`${styles.statusBadge} ${styles[`status-${r.network.toLowerCase()}`]}`}>
                  <span className={`${styles.statusDot} ${styles[`dot-${r.network.toLowerCase()}`]}`} />
                  {r.network}
                </span>
              </td>
              <td>
                <span className={`${styles.statusBadge} ${r.power === "On" ? styles["status-online"] : styles["status-offline"]}`}>
                  <span className={`${styles.statusDot} ${r.power === "On" ? styles["dot-online"] : styles["dot-offline"]}`} />
                  {r.power}
                </span>
              </td>
              <td>{r.mark}</td>
              <td>
                <div className={styles["info-box"]} onClick={() => ViewInfoClick(idx, r)}>상세보기</div>
              </td>
            </tr>
          ))}
          </tbody>
      </table>
      </div>
      </div>
      <RobotDetailModal isOpen={robotDetailModalOpen} onClose={() => setRobotDetailModalOpen(false)}  selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robots}/>
    </>
  );
}