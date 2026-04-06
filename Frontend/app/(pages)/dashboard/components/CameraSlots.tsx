"use client";

import React, { useState, useEffect } from "react";
import styles from "./CameraSlots.module.css";
import dashStyles from "../dashboard.module.css";
import type { Camera, RobotRowData, Video, VideoItem } from "@/app/type";
import CameraSlot from "./CameraSlot";
import dynamic from "next/dynamic";

const CameraModal = dynamic(() => import("./CameraModal"), { ssr: false });

type CameraSlotsProps = {
  cameras: Camera[];
  robotCameras: Camera[];
  videoItems: VideoItem[];
  selectedRobot: RobotRowData | null;
  robots: RobotRowData[];
  video: Video[];
};

const SLOTS_PER_PAGE = 3;

export default function CameraSlots({
  cameras,
  robotCameras,
  videoItems,
  selectedRobot,
  robots,
  video,
}: CameraSlotsProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCam, setModalCam] = useState<Camera | null>(null);
  const [modalMode, setModalMode] = useState<"all" | "single">("all");
  const [startIdx, setStartIdx] = useState(0);

  const robotName = selectedRobot?.no ?? "";
  const maxStartIdx = Math.max(0, robotCameras.length - SLOTS_PER_PAGE);
  const hasMultiplePages = robotCameras.length > SLOTS_PER_PAGE;
  const canGoUp = startIdx > 0;
  const canGoDown = startIdx < maxStartIdx;

  useEffect(() => {
    setStartIdx(0);
  }, [selectedRobot?.id]);

  const openExpand = (cam: Camera, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalCam(cam);
    setModalMode("single");
    setModalOpen(true);
  };

  const visibleCams = robotCameras.slice(startIdx, startIdx + SLOTS_PER_PAGE);

  return (
    <>
      {robotCameras.length === 0 && (
        <div className={dashStyles.cameraPanel}>
          <div className={styles.emptySlot}>
            <span>카메라를 등록해주세요</span>
          </div>
        </div>
      )}

      {visibleCams.map((cam) => (
        <div key={cam.id} className={`${dashStyles.cameraPanel} ${styles.camSlotWrapper}`}>
          <CameraSlot
            camera={cam}
            robotName=""
            onExpand={(e) => openExpand(cam, e)}
          />
        </div>
      ))}

      {/* 스크롤 버튼 */}
      {hasMultiplePages && (
        <div className={styles.scrollBar}>
          <button
            className={styles.scrollBtn}
            disabled={!canGoUp}
            onClick={() => setStartIdx((p) => p - 1)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <span className={styles.scrollIndicator}>
            {startIdx + 1}–{Math.min(startIdx + SLOTS_PER_PAGE, robotCameras.length)} / {robotCameras.length}
          </span>
          <button
            className={styles.scrollBtn}
            disabled={!canGoDown}
            onClick={() => setStartIdx((p) => p + 1)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      )}

      <CameraModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        robotCameras={robotCameras}
        robotName={robotName}
        initialCam={modalCam}
        initialMode={modalMode}
      />
    </>
  );
}
