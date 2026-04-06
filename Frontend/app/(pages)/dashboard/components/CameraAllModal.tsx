"use client";

import React from "react";
import styles from "./CameraAllModal.module.css";
import type { Camera, RobotRowData, Video } from "@/app/type";
import CameraSlot from "./CameraSlot";
import dynamic from "next/dynamic";

const CameraExpandModal = dynamic(() => import("./CameraExpandModal"), { ssr: false });

type CameraAllModalProps = {
  isOpen: boolean;
  onClose: () => void;
  robotCameras: Camera[];
  cameras: Camera[];
  selectedRobot: RobotRowData | null;
  robots: RobotRowData[];
  video: Video[];
};

export default function CameraAllModal({
  isOpen,
  onClose,
  robotCameras,
  cameras,
  selectedRobot,
  robots,
  video,
}: CameraAllModalProps) {
  const [expandCam, setExpandCam] = React.useState<Camera | null>(null);
  const robotName = selectedRobot?.no ?? "";

  if (!isOpen) return null;

  const count = robotCameras.length;
  const cols = count <= 2 ? 2 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>전체 카메라 ({count})</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div
          className={styles.grid}
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {robotCameras.map((cam) => (
            <div
              key={cam.id}
              className={styles.camPanel}
              onClick={() => setExpandCam(cam)}
            >
              <CameraSlot camera={cam} robotName={robotName} />
            </div>
          ))}
        </div>
      </div>

      <CameraExpandModal
        isOpen={!!expandCam}
        onClose={() => setExpandCam(null)}
        camera={expandCam}
        robotName={robotName}
        onViewAll={() => setExpandCam(null)}
      />
    </div>
  );
}
