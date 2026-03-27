"use client";

import React, { useState, useEffect } from "react";
import styles from "./CameraSlots.module.css";
import dashStyles from "../dashboard.module.css";
import type { Camera, RobotRowData, Video, VideoItem } from "@/app/type";
import CameraSlot from "./CameraSlot";
import CameraModal from "./CameraModal";

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
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(robotCameras.length / SLOTS_PER_PAGE));
  const robotName = selectedRobot?.no ?? "";
  const hasMultiplePages = totalPages > 1;
  const canGoUp = page > 0;
  const canGoDown = page < totalPages - 1;

  useEffect(() => {
    setPage(0);
  }, [selectedRobot?.id]);

  const openExpand = (cam: Camera, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalCam(cam);
    setModalMode("single");
    setModalOpen(true);
  };

  const openAll = () => {
    setModalCam(null);
    setModalMode("all");
    setModalOpen(true);
  };

  const visibleCams = robotCameras.slice(
    page * SLOTS_PER_PAGE,
    page * SLOTS_PER_PAGE + SLOTS_PER_PAGE
  );

  return (
    <>
      {robotCameras.length === 0 && (
        <div className={dashStyles.cameraPanel}>
          <div className={styles.emptySlot}>
            <span>카메라를 등록해주세요</span>
          </div>
        </div>
      )}

      {visibleCams.map((cam, idx) => (
        <div key={cam.id} className={`${dashStyles.cameraPanel} ${styles.camSlotWrapper}`}>
          <CameraSlot
            camera={cam}
            robotName=""
            onExpand={(e) => openExpand(cam, e)}
          />

          {/* 첫 번째 카메라 상단에 위로 화살표 */}
          {idx === 0 && hasMultiplePages && canGoUp && (
            <button
              className={`${styles.pageArrow} ${styles.pageArrowUp}`}
              onClick={(e) => { e.stopPropagation(); setPage((p) => p - 1); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          )}

          {/* 마지막 카메라 하단 border에 걸치는 아래 화살표 */}
          {idx === visibleCams.length - 1 && hasMultiplePages && canGoDown && (
            <button
              className={`${styles.pageArrow} ${styles.pageArrowDown}`}
              onClick={(e) => { e.stopPropagation(); setPage((p) => p + 1); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      ))}

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
