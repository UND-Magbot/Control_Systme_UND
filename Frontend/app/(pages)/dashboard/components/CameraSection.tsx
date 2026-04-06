"use client";

import styles from './CameraSection.module.css';
import type { Camera, RobotRowData, Video, VideoItem } from '@/app/type'
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import {RobotSelectBox} from '@/app/components/button';
import dynamic from "next/dynamic";

const RemoteMapModal = dynamic(() => import("@/app/components/modal/RemoteMapModal"), { ssr: false });
import { API_BASE } from "@/app/config";
import SectionHeader from "./SectionHeader";
import selectModernStyles from "@/app/components/button/SelectModern.module.css";

type CombinedProps = {
  cameras: Camera[];
  robots: RobotRowData[];
  video: Video[];
  videoItems: VideoItem[];
}

export default function CameraSection({
  cameras,
  robots,
  video,
  videoItems
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
  const camSelectRef = useRef<HTMLDivElement>(null);
  const [camDropdownStyle, setCamDropdownStyle] = useState<React.CSSProperties>({});

  const [thermalUrl, setThermalUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevObjectUrlRef = useRef<string | null>(null);

  // 로딩/에러 상태
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  // 연결 타임아웃 (10초), 재연결 간격 (5초)
  const CAM_TIMEOUT_MS = 10_000;
  const CAM_RETRY_MS = 5_000;
  const camTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCamTimeout = () => {
    if (camTimeoutRef.current) {
      clearTimeout(camTimeoutRef.current);
      camTimeoutRef.current = null;
    }
  };

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const startCamTimeout = () => {
    clearCamTimeout();
    camTimeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      setHasError(true);
      if (wsRef.current) wsRef.current.close();
      startRetryTimer();
    }, CAM_TIMEOUT_MS);
  };

  const startRetryTimer = () => {
    clearRetryTimer();
    retryTimerRef.current = setInterval(() => {
      retryConnection();
    }, CAM_RETRY_MS);
  };

  //원격모달
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);

  // 선택된 카메라 스트림 URL 상태 기본값: 첫 번째 카메라
  const [cameraStream, setCameraStream] = useState(cameras[0]?.webrtcUrl || "");

  const activeCam = cameras[cameraTabActiveIndex];

  const hasRobots = robots.length > 0;
  const hasCameras = cameras.length > 0;

  // 현재 카메라에 연결된 로봇명 조회 (videoItems의 cameraNo ↔ camera label 매핑)
  const currentCamLabel = selectedCam?.label || cameras[0]?.label || "";
  const mappedRobotName = useMemo(() => {
    const matched = videoItems.find(v => v.cameraNo === currentCamLabel);
    return matched?.robotNo || "";
  }, [currentCamLabel, videoItems]);

  // 카메라 영역 로봇명: 매핑된 로봇 > 선택된 로봇 > 첫 번째 로봇
  const displayRobotName = mappedRobotName || selectedRobot?.no || robots[0]?.no || "";

  // 연결 성공 시 공통 처리
  const onConnectSuccess = () => {
    clearCamTimeout();
    clearRetryTimer();
    setIsLoading(false);
    setHasError(false);
  };

  const connectThermalWS = () => {
    if (wsRef.current) wsRef.current.close();

    setIsLoading(true);
    setHasError(false);
    startCamTimeout();

    const cam = selectedCam ?? cameras[0];
    const wsUrl = cam?.webrtcUrl ?? "";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => console.log("🔥 Thermal WS Connected");
    ws.onerror = (e) => {
      console.error("🔥 Thermal WS Error", e);
      clearCamTimeout();
      setIsLoading(false);
      setHasError(true);
      startRetryTimer();
    };

    ws.onmessage = (e) => {
      if (e.data instanceof Blob) {
        onConnectSuccess();
        const nextUrl = URL.createObjectURL(e.data);

        if (prevObjectUrlRef.current)
          URL.revokeObjectURL(prevObjectUrlRef.current);

        prevObjectUrlRef.current = nextUrl;
        setThermalUrl(nextUrl);
      }
    };
  };

  // 자동 재연결: 현재 선택된 카메라 기준으로 재시도
  const retryConnection = () => {
    const cam = selectedCam ?? cameras[0];
    if (!cam) return;

    if (cam.streamType === "ws") {
      connectThermalWS();
    } else {
      setIsLoading(true);
      setHasError(false);
      startCamTimeout();
      setCameraStream(cam.webrtcUrl + (cam.webrtcUrl.includes("?") ? "&" : "?") + "t=" + Date.now());
    }
  };

  // 카메라-로봇 매핑으로 하단 셀렉트 자동 연동
  const syncRobotByCam = (cam: Camera) => {
    const matched = videoItems.find(v => v.cameraNo === cam.label);
    if (matched) {
      const robotIdx = robots.findIndex(r => r.no === matched.robotNo);
      if (robotIdx >= 0) {
        setRobotActiveIndex(robotIdx);
        setSelectedRobot(robots[robotIdx]);
      }
    }
  };

  // 카메라 선택 핸들러
  const handleCameraTab = (idx: number, cam: Camera) => {
    clearRetryTimer();
    setIsLoading(true);
    setHasError(false);
    setSelectedCam(cam);
    setCameraTabActiveIndex(idx);
    startCamTimeout();
    syncRobotByCam(cam);

    // 🔥 카메라 3번 = Thermal
    if (cam.streamType === "ws") {
      console.log("🔥 Thermal Camera Selected");
      setThermalUrl(null);
      connectThermalWS();
      return;
    }

    // 🔹 일반 MJPEG 카메라
    if (wsRef.current) wsRef.current.close();
    setThermalUrl(null);

    const url = cam.webrtcUrl.startsWith("ws") ? cam.webrtcUrl : `${API_BASE}${cam.webrtcUrl}`;
    setCameraStream(url);
  };

  // 로봇 선택 핸들러
  const handleRobotSelect = (idx: number, robots: RobotRowData) => {
    setRobotActiveIndex(idx);
    setSelectedRobot(robots);
    console.log("선택된 로봇:", robots.id, robots.no);
  };

  // 초기 마운트 시 타임아웃 시작 + 첫 카메라 로봇 연동 + 네트워크 복구 감지
  useEffect(() => {
    if (hasCameras && hasRobots) {
      startCamTimeout();
      syncRobotByCam(cameras[0]);
    } else {
      setIsLoading(false);
    }

    const handleOnline = () => retryConnection();
    window.addEventListener("online", handleOnline);

    return () => {
      clearCamTimeout();
      clearRetryTimer();
      window.removeEventListener("online", handleOnline);
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

  const needsCamScroll = cameras.length > 3;

  useCustomScrollbar({
    enabled: isOpenCam && needsCamScroll,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 50,
    deps: [cameras.length],
  });

  const calcCamPosition = () => {
    if (!camSelectRef.current) return;
    const rect = camSelectRef.current.getBoundingClientRect();
    setCamDropdownStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  };

  useEffect(() => {
    if (!isOpenCam) return;
    window.addEventListener("scroll", calcCamPosition, true);
    window.addEventListener("resize", calcCamPosition);
    return () => {
      window.removeEventListener("scroll", calcCamPosition, true);
      window.removeEventListener("resize", calcCamPosition);
    };
  }, [isOpenCam]);

  const handleCamToggle = () => {
    if (!isOpenCam) calcCamPosition();
    setIsOpenCam(!isOpenCam);
  };

  return (
    <>
      <SectionHeader
          icon="/icon/camera_w.png"
          title="실시간 모니터링"
      />

      <div className={styles["middle-div"]}>
        <div className={styles["view-div"]}>
          {/* 등록된 로봇이 없을 때 */}
          {!hasRobots && (
            <div className={styles.emptyOverlay}>
              <span>등록된 로봇이 없습니다.</span>
              <span className={styles.emptySubText}>로봇을 등록하면 실시간 카메라를 확인할 수 있습니다.</span>
            </div>
          )}

          {/* 로봇은 있지만 카메라 없을 때 */}
          {hasRobots && !hasCameras && (
            <div className={styles.emptyOverlay}>
              <span>등록된 카메라가 없습니다.</span>
              <span className={styles.emptySubText}>카메라를 등록하면 실시간 영상을 확인할 수 있습니다.</span>
            </div>
          )}

          {/* 로딩 오버레이 */}
          {hasRobots && hasCameras && isLoading && !hasError && (
            <div className={styles.loadingOverlay}>
              <div className={styles.spinner} />
              <span>카메라 연결 중...</span>
            </div>
          )}

          {/* 에러 오버레이 */}
          {hasRobots && hasCameras && hasError && (
            <div className={styles.errorOverlay}>
              <span>카메라 연결 실패</span>
              {activeCam && (
                <button className={styles.retryBtn}
                  onClick={() => retryConnection()}>
                  재연결
                </button>
              )}
            </div>
          )}

          <div className={styles.cameraWrapper}>
            {selectedCam?.id === 3 && thermalUrl ? (
            <img src={thermalUrl} className={styles.cameraImg} alt="thermal"
              onLoad={onConnectSuccess}
              onError={() => { clearCamTimeout(); setIsLoading(false); setHasError(true); startRetryTimer(); }} />
          ) : (
            <img src={cameraStream} className={styles.cameraImg} alt="mjpeg"
              onLoad={onConnectSuccess}
              onError={() => { clearCamTimeout(); setIsLoading(false); setHasError(true); startRetryTimer(); }} />
          )}
          </div>

          {/* 로봇명 오버레이: 연결 완료 시에만 표시 */}
          {hasRobots && hasCameras && !isLoading && !hasError && (
            <div className={styles.robotName}>{displayRobotName}</div>
          )}

        </div>
      </div>

      {/* 로봇 선택 / 카메라 선택 / 원격 제어 */}
      <div className={styles["bottom-div"]}>
        <div className={styles["select-group"]}>
          <RobotSelectBox robots={robots} activeIndex={robotActiveIndex} selectedRobot={selectedRobot} onSelect={handleRobotSelect} className={styles.customSelectBox} selectStyles={selectModernStyles} />

          {hasCameras && (
            <div ref={camWrapperRef} className={`${selectModernStyles.seletWrapper} ${styles.customSelectBox}`}>
              <div ref={camSelectRef} className={selectModernStyles.selete}
                onClick={handleCamToggle}>
                <span>{selectedCam?.label ?? cameras[0]?.label ?? "카메라 선택"}</span>
                {isOpenCam ? (
                  <img src="/icon/arrow_up.png" alt="arrow_up" />
                ) : (
                  <img src="/icon/arrow_down.png" alt="arrow_down" />
                )}
              </div>
              {isOpenCam && (
                <div className={selectModernStyles.seletbox} style={camDropdownStyle}>
                  <div ref={scrollRef} className={selectModernStyles.inner} style={{ maxHeight: needsCamScroll ? 112 : "none", overflowY: needsCamScroll ? "scroll" : "visible" }} role="listbox">
                    {cameras.map((cam, idx) => (
                      <div key={cam.id} className={`${selectModernStyles.floorLabel} ${ cameraTabActiveIndex === idx ? selectModernStyles["active"] : "" }`.trim()}
                      onClick={() => handleCameraTab(idx, cam)}>{cam.label}</div>
                    ))}
                  </div>

                  {needsCamScroll && (
                    <div ref={trackRef} className={selectModernStyles.scrollTrack}>
                      <div ref={thumbRef} className={selectModernStyles.scrollThumb} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

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
