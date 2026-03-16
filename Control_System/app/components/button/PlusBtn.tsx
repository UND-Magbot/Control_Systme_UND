"use client";

import { useState } from "react";
import styles from './Button.module.css';
import type { RobotRowData, Video, Camera, PlusButtonType } from '@/app/type';
import RemoteModal from "../modal/RemoteMapModal";
import RobotPath from "../modal/RemoteMapModal";

export type RemoteBtnProps = {
  type: PlusButtonType;
  robots: RobotRowData[];
  selectedRobots: RobotRowData | null;
  video: Video[];
  camera: Camera[];
}

export default function PlusActionButton({ 
  type,
  robots,
  selectedRobots,
  video,
  camera 
}: RemoteBtnProps) {

  // 로봇 원격 제어/ 로봇 패스 경로 버튼 모달 상태
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [robotPathModalOpen, setRobotPathModalOpen] = useState(false);
  
  const handleClick = () => {
    switch (type) {
      case "camera":
        // 카메라 모달 열기
        setRemoteModalOpen(true);
        break;

      case "map":
        // 맵 모달 열기
        setRobotPathModalOpen(true);
        break;

      default:
        break;
    }
  };

  return (
    <>
      <button type="button" className={styles.plusBtn} onClick={handleClick}>+</button>

      {remoteModalOpen && (
        <RemoteModal isOpen={remoteModalOpen} onClose={() => setRemoteModalOpen(false)}
                     selectedRobots={selectedRobots}
                     robots={robots}
                     video={video}
                     camera={camera}
                     primaryView={type}
        />
      )}

      {robotPathModalOpen && (
        <RobotPath isOpen={robotPathModalOpen} onClose={() => setRobotPathModalOpen(false)}
                   selectedRobots={selectedRobots}
                   robots={robots}
                   video={video}
                   camera={camera}
                   primaryView={type}
        />
      )}
    </>
  );
}