"use client";

import React, { useState } from 'react';
import styles from './Button.module.css';
import type { RobotRowData, Video, Camera } from '@/app/type';
import RemoteMapModal from "../modal/RemoteMapModal";

type RemoteBtnProps = {
  robots: RobotRowData[];
  selectedRobots: RobotRowData | null;
  video: Video[]
  cameras: Camera[]
  className?: string;

  selectedCam?: Camera | null;
  selectedCamIndex?: number;
}

export default function RemoteBtn({
  selectedRobots,
  robots,
  video,
  cameras,
  className,

  selectedCam,
  selectedCamIndex,
} : RemoteBtnProps) {

  const [remoteModalOpen, setRemoteModalOpen] = useState(false);

  return (
    <>
      <button type='button' className={`${styles["remote-div"]} ${className ?? ""}`} onClick={() => setRemoteModalOpen(true)}>
          <div className={styles["remote-icon"]}>
              <img src="/icon/robot_control_w.png" alt="robot path" />
          </div>
          <div>원격 제어</div>
      </button>
      <RemoteMapModal isOpen={remoteModalOpen} onClose={() => setRemoteModalOpen(false)} selectedRobots={selectedRobots} robots={robots} video={video} camera={cameras} primaryView="camera"/>
    </>
  )
} 