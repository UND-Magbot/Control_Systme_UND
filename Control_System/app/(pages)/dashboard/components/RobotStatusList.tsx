"use client";

import React, { useState } from 'react';
import type { RobotRowData } from '@/app/type';
import styles from './RobotStatusList.module.css';
import RobotDetailModal from "@/app/components/modal/RobotDetailModal";

type RobotStatusListProps =  {
  robotRows: RobotRowData[];
}

export default function RobotStatusList({robotRows}:RobotStatusListProps) {

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

  const BATTERY_ICONS = [
    { limit: 100, icon: "/icon/battery_full.png" },
    { limit: 75, icon: "/icon/battery_high.png" },
    { limit: 50, icon: "/icon/battery_half.png" },
    { limit: 25, icon: "/icon/battery_low.png" },
    { limit: 0, icon: "/icon/battery_empty.png" }
  ];

  const NETWORK_ICON_MAP: Record<string, string> = {
    Error: "/icon/status(2).png",
    Offline: "/icon/status(3).png",
    Online: "/icon/status(1).png"
  };

  const robotInfoIcons = {
    info: (index: number) =>
      ROBOT_ICONS[index] ?? ROBOT_ICONS[0],

    battery: (battery: number, isCharging?: boolean) => {
      if (isCharging) return "/icon/battery_charging.png";

      const state = BATTERY_ICONS.find(item => battery >= item.limit);
      return state ? state.icon : "/icon/battery_empty.png";
    },

    network: (status: string) =>
      NETWORK_ICON_MAP[status] || NETWORK_ICON_MAP["Online"],

    power: (power: string) =>
      power === "On" ? "/icon/power_on.png" : "/icon/power_off.png",

    mark: (index: number) =>
      LOCATION_ICONS[index] ?? LOCATION_ICONS[0]
  };


  // viewInfo 클릭 시 실행되는 핸들러
  const ViewInfoClick = (idx: number, robot: RobotRowData) => {
    setRobotActiveIndex(idx);       // row 하이라이트 줄 때 사용 가능
    setSelectedRobotId(robot.id);   // 카메라 / 맵에서 쓸 핵심 값
    setSelectedRobot(robot);        // 필요하면 전체 정보도 내려줌
    setRobotDetailModalOpen(true)
    console.log("선택된 로봇 (Location 클릭):", robot.id, robot.no);
  };

  return (
    <>
      <table className={styles.status}>
          <thead>
              <tr>
                  <th>Robot No</th>
                  <th>Robot Info</th>
                  <th>Battery (Return)</th>
                  <th>Network</th>
                  <th>Power</th>
                  <th>Mark</th>
              </tr>
          </thead>
          <tbody>
          {robotRows.slice(0, 4).map((r, idx) => (
              <tr key={r.no}>
              <td>
                  <div>
                  {r.no}
                  </div>
              </td>
              <td>
                  <div className={`${styles.robot_status_icon_div}`}>
                    <img src={robotInfoIcons.info(idx)} alt={`robot_icon`} />
                    <div className={styles["info-box"]} onClick={() => ViewInfoClick(idx, r)}>View Info</div>
                  </div>
              </td>
              <td>
                  <div className={styles["robot_status_icon_div"]}>
                  <img src={robotInfoIcons.battery(r.battery, r.isCharging)} alt="battery" />
                  {r.battery}% ({r.return}%)
                  </div>
              </td>
              <td>
                  <div className={styles["robot_status_icon_div"]}>
                  <img src={robotInfoIcons.network(r.network)} alt="network" />
                  {r.network}
                  </div>
              </td>
              <td>
                  <div className={styles["robot_status_icon_div"]}>
                  <img src={robotInfoIcons.power(r.power)} alt="power" />
                  {r.power}
                  </div>
              </td>
              <td>
                  <div className={styles["robot_status_icon_div"]}>
                  <img src={robotInfoIcons.mark(idx)} alt="mark" />
                  {r.mark}
                  </div>
              </td>
            </tr>
          ))}
          </tbody>
      </table>
      <RobotDetailModal isOpen={robotDetailModalOpen} onClose={() => setRobotDetailModalOpen(false)}  selectedRobotId={selectedRobotId} selectedRobot={selectedRobot} robots={robotRows}/>
    </>
  );
}