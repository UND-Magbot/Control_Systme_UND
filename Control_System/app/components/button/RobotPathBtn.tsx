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

  className?: string;
}

export default function RobotPathBtn ({ 
  selectedRobots,
  robots,
  video,
  camera,
  initialCam = null,
  initialCamIndex = 0,  
  className
} : RobotPathBtnProps) {

  const [robotPathModalOpen, setRobotPathModalOpen] = useState(false);

  return (
    <>
      <button type='button' 
              className={`${styles["path-div"]} ${className ?? ""}`} 
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