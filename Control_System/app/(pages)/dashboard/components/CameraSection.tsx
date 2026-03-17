"use client";

import styles from './CameraSection.module.css';
import type { Camera, RobotRowData, Video } from '@/app/type'
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import {RobotSelectBox, PlusBtn} from '@/app/components/button';
import RemoteMapModal from "@/app/components/modal/RemoteMapModal";

type CombinedProps = {
  cameras: Camera[];
  robots: RobotRowData[];
  video: Video[];
}

export default function CameraSection({
  cameras,
  robots,
  video
}:CombinedProps) {

  const [cameraTabActiveIndex, setCameraTabActiveIndex] = useState<number>(0);
  const [robotActiveIndex, setRobotActiveIndex] = useState<number>(0);
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);

  const [isOpenCam, setIsOpenCam] = useState(false);
  const camWrapperRef = useRef<HTMLDivElement>(null);
  const [selectedCam, setSelectedCam] = useState<Camera | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const [thermalUrl, setThermalUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevObjectUrlRef = useRef<string | null>(null);

  //원격모달
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);

  // 선택된 카메라 스트림 URL 상태 기본값: 첫 번째 카메라
  const [cameraStream, setCameraStream] = useState("http://192.168.0.21:3002/Video/1");

  const activeCam = cameras[cameraTabActiveIndex];

  // 선택된 로봇 이름 표시 기본값 "Robot 1"
  const defaultRobotName = selectedRobot?.no || "Robot 1";

  const connectThermalWS = () => {
    if (wsRef.current) wsRef.current.close();

    const ws = new WebSocket("ws://10.21.41.29:8765");
    wsRef.current = ws;

    ws.onopen = () => console.log("🔥 Thermal WS Connected");
    ws.onerror = (e) => console.error("🔥 Thermal WS Error", e);

    ws.onmessage = (e) => {
      if (e.data instanceof Blob) {
        const nextUrl = URL.createObjectURL(e.data);

        if (prevObjectUrlRef.current)
          URL.revokeObjectURL(prevObjectUrlRef.current);

        prevObjectUrlRef.current = nextUrl;
        setThermalUrl(nextUrl);
      }
    };
  };

  // 카메라 선택 핸들러
  const handleCameraTab = (idx: number, cam: Camera) => {
    setSelectedCam(cam);
    setCameraTabActiveIndex(idx);

    // 🔥 카메라 3번 = Thermal
    if (cam.id === 3) {
      console.log("🔥 Thermal Camera Selected");
      setThermalUrl(null);
      connectThermalWS();
      return;
    }

    // 🔹 일반 MJPEG 카메라
    if (wsRef.current) wsRef.current.close();
    setThermalUrl(null);

    setCameraStream(cam.webrtcUrl);
  };

  // 로봇 선택 핸들러
  const handleRobotSelect = (idx: number, robots: RobotRowData) => {
    setRobotActiveIndex(idx);
    setSelectedRobot(robots);
    console.log("선택된 로봇:", robots.id, robots.no);
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (prevObjectUrlRef.current)
        URL.revokeObjectURL(prevObjectUrlRef.current);
    };
  }, []);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (camWrapperRef.current && !camWrapperRef.current.contains(e.target as Node)) {
        setIsOpenCam(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const selectedCamIndex = useMemo(() => {
    if (selectedCam) {
      const idx = cameras.findIndex((c) => c.id === selectedCam.id);
      return idx >= 0 ? idx : 0;
    }
    return cameraTabActiveIndex; // selectedCam이 null이면 현재 탭 index를 사용
  }, [selectedCam, cameras, cameraTabActiveIndex]);

  useCustomScrollbar({
    enabled: isOpenCam,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 50,
    deps: [cameras.length],
  });

  return (
    <>
      <div className={styles["top-div"]}>
          <div className={styles["title-div"]}>
            <div>
                <img src="/icon/camera_w.png" alt="camera" />
            </div>
            <h2>로봇 실시간 카메라</h2>
          </div>
          <PlusBtn type="camera" selectedRobots={selectedRobot} robots={robots} video={video} camera={cameras}/>
      </div>

      <div className={styles["middle-div"]}>
        <div className={styles["view-div"]}>
          <div className={styles.robotName}>{defaultRobotName}</div>
          <div className={styles.cameraWrapper}>
            {selectedCam?.id === 3 && thermalUrl ? (
            <img src={thermalUrl} className={styles.cameraImg} alt="thermal" />
          ) : (
            <img src={cameraStream} className={styles.cameraImg} alt="mjpeg" />
          )}
          </div>

          {/* 카메라 선택 탭 */}
          {/* <CameraSelector cameras={cameras} activeIndex={cameraTabActiveIndex} onSelect={handleCameraTab} /> */}

          <div ref={camWrapperRef} className={`${styles.camSeletWrapper}`}>
            <div className={styles.camSelete}
              onClick={() => setIsOpenCam(!isOpenCam)}>
              <span>{selectedCam?.label ?? "CAM 1"}</span>
              {isOpenCam ? (
                <img src="/icon/arrow_up.png" alt="arrow_up" />
              ) : (
                <img src="/icon/arrow_down.png" alt="arrow_down" />
              )}
            </div> 
            {isOpenCam && (
              <div className={styles.camSeletbox}>
                <div ref={scrollRef} className={styles.inner} role="listbox">
                  {cameras.map((cam, idx) => (
                    <div key={cam.id} className={`${styles.camLabel} ${ cameraTabActiveIndex === idx ? styles["active"] : "" }`.trim()}
                    onClick={() => handleCameraTab(idx, cam)}>{cam.label}</div>
                  ))}
                </div>
                
                <div ref={trackRef} className={styles.scrollTrack}>
                  <div ref={thumbRef} className={styles.scrollThumb} />
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 로봇 선택 및 원격 제어 버튼 */}
      <div className={styles["bottom-div"]}>
        <RobotSelectBox robots={robots} activeIndex={robotActiveIndex} onSelect={handleRobotSelect} className={styles.customSelectBox} />

        <button type='button'
                className={styles["remote-div"]} 
                onClick={() => {setRemoteModalOpen(true)}}>
            <div className={styles["remote-icon"]}>
                <img src="/icon/robot_control_w.png" alt="robot path" />
            </div>
            <div>원격 제어</div>
        </button>
      </div>
      <RemoteMapModal isOpen={remoteModalOpen}
                      onClose={() => setRemoteModalOpen(false)} 
                      selectedRobots={selectedRobot} 
                      robots={robots} 
                      video={video} 
                      camera={cameras} 
                      initialCam={selectedCam ?? null}
                      initialCamIndex={selectedCamIndex}
                      primaryView="camera"
        />
    </>
  );
}
