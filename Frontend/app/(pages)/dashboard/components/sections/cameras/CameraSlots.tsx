"use client";

import React, { useState, useEffect } from "react";
import styles from "./CameraSlots.module.css";
import dashStyles from "../../../dashboard.module.css";
import type { Camera, RobotRowData, Video, VideoItem } from "@/app/types";
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
  loading?: boolean;
};

const SLOTS_PER_PAGE = 4;

export default function CameraSlots({
  cameras,
  robotCameras,
  videoItems,
  selectedRobot,
  robots,
  video,
  loading = false,
}: CameraSlotsProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCam, setModalCam] = useState<Camera | null>(null);
  const [modalMode, setModalMode] = useState<"all" | "single">("all");
  const [startIdx, setStartIdx] = useState(0);

  const robotName = selectedRobot?.no ?? "";
  const isOnline = selectedRobot?.network === "Online";
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
      {loading ? (
        // 초기 로드 중: 카메라/로봇 fetch가 끝나기 전이면 로딩 슬롯 2개 표시
        // (끝나기 전 "로봇 연결 끊김" / "카메라를 등록해주세요" 로 깜빡이는 것 방지)
        <>
          {[0, 1].map((i) => (
            <div key={i} className={`${dashStyles.cameraPanel} ${styles.camSlotWrapper}`}>
              <div className={styles.emptySlot}>
                <div className={styles.spinner} />
              </div>
            </div>
          ))}
        </>
      ) : !isOnline ? (
        <div className={dashStyles.cameraPanel}>
          <div className={styles.emptySlot}>
            <span>로봇 연결 끊김</span>
          </div>
        </div>
      ) : robotCameras.length === 0 ? (
        <div className={dashStyles.cameraPanel}>
          <div className={styles.emptySlot}>
            <span>카메라를 등록해주세요</span>
          </div>
        </div>
      ) : (
        <>
          {visibleCams.map((cam) => (
            <div key={cam.id} className={`${dashStyles.cameraPanel} ${styles.camSlotWrapper}`}>
              <CameraSlot
                camera={cam}
                robotName=""
                onExpand={(e) => openExpand(cam, e)}
              />
            </div>
          ))}
        </>
      )}

      {/* 스크롤 버튼 */}
      {isOnline && hasMultiplePages && (
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
        robot={selectedRobot}
        initialCam={modalCam}
        initialMode={modalMode}
      />
    </>
  );
}
