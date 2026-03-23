"use client";

import React, { useState } from 'react';
import styles from './Button.module.css';
import type { RobotRowData, Video, Camera } from '@/app/type';
import RemoteMapModal from "../modal/RemoteMapModal";

type RobotPathBtnProps = {
  robots: RobotRowData[];
  selectedRobots: RobotRowData | null;
  video: Video[];
  camera: Camera[];
  initialCam?: Camera | null;
  initialCamIndex?: number;
  variant?: "default" | "modern";
  className?: string;
}

export default function RobotPathBtn ({
  selectedRobots,
  robots,
  video,
  camera,
  initialCam = null,
  initialCamIndex = 0,
  variant = "default",
  className
} : RobotPathBtnProps) {

  const [robotPathModalOpen, setRobotPathModalOpen] = useState(false);

  return (
    <>
      <button type='button'
              className={`${variant === "modern" ? styles["path-div-modern"] : styles["path-div"]} ${className ?? ""}`}
              onClick={() => setRobotPathModalOpen(true)}
      >
        <div className={styles["path-icon"]}>
          <img src="/icon/path_w.png" alt="robot path" />
        </div>
        <div>로봇 경로</div>
      </button>
      
      <RemoteMapModal isOpen={robotPathModalOpen} 
                      onClose={() => setRobotPathModalOpen(false)} 
                      selectedRobots={selectedRobots} 
                      robots={robots} 
                      video={video} 
                      camera={camera} 
                      initialCam={initialCam}
                      initialCamIndex={initialCamIndex}
                      primaryView="map"
      />
    </>
  );
}