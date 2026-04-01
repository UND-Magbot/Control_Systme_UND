"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RobotRowData, Camera, Floor, Video } from '@/app/type';
import styles from './RobotList.module.css';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import { API_BASE } from "@/app/config";
import RemoteMapModal from "@/app/components/modal/RemoteMapModal";

type CombinedProps = {
    selectedRobotId: number | null;
    selectedRobot:  RobotRowData | null;
    cameras: Camera[];
    robots: RobotRowData[];
    video: Video[];
    floors: Floor[];
  }

export default function CameraView({
    selectedRobot,
    robots,
    video,
    cameras
}: CombinedProps) {

    const [cameraTabActiveIndex, setCameraTabActiveIndex] = useState<number>(0);
    const [selectedCam, setSelectedCam] = useState<Camera | null>(null);
    const [isOpenCam, setIsOpenCam] = useState(false);

    const [thermalUrl, setThermalUrl] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const prevObjectUrlRef = useRef<string | null>(null);

    const camWrapperRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);

    // 로딩/에러 상태
    const [camStatus, setCamStatus] = useState<"loading" | "loaded" | "error">("loading");

    // 원격 제어 모달
    const [remoteModalOpen, setRemoteModalOpen] = useState(false);

    const connectThermalWS = () => {
        if (wsRef.current) wsRef.current.close();

        const wsUrl = selectedCam?.webrtcUrl ?? "";
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (e) => {
            if (e.data instanceof Blob) {
            const nextUrl = URL.createObjectURL(e.data);

            if (prevObjectUrlRef.current) {
                URL.revokeObjectURL(prevObjectUrlRef.current);
            }

            prevObjectUrlRef.current = nextUrl;
            setThermalUrl(nextUrl);
            setCamStatus("loaded");
            }
        };

        ws.onerror = () => setCamStatus("error");
        ws.onclose = () => console.log("Thermal WS closed");
    };

    const [cameraStream, setCameraStream] = useState(`${API_BASE}/Video/1`);
    const handleCameraTab = (idx: number, cam: Camera) => {
        setSelectedCam(cam);
        setCameraTabActiveIndex(idx);
        setCamStatus("loading");

        if (cam.streamType === "ws") {
            setThermalUrl(null);
            connectThermalWS();
            setIsOpenCam(false);
            return;
        }

        if (wsRef.current) wsRef.current.close();
        setThermalUrl(null);

        const url = `${API_BASE}/Video/${cam.id}`;
        setCameraStream(url);
        setIsOpenCam(false);
    };

    const handleRetry = () => {
        setCamStatus("loading");
        const cam = selectedCam ?? cameras[cameraTabActiveIndex];
        if (cam?.id === 3) {
            connectThermalWS();
        } else {
            const url = `${API_BASE}/Video/${cam?.id ?? 1}?t=${Date.now()}`;
            setCameraStream(url);
        }
    };

    const defaultRobotName = selectedRobot?.no || "선택 안 됨";

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
        return cameraTabActiveIndex;
    }, [selectedCam, cameras, cameraTabActiveIndex]);

    useEffect(() => {
        return () => {
            if (wsRef.current) wsRef.current.close();
            if (prevObjectUrlRef.current) {
            URL.revokeObjectURL(prevObjectUrlRef.current);
            }
        };
    }, []);

    useCustomScrollbar({
        enabled: isOpenCam,
        scrollRef,
        trackRef,
        thumbRef,
        minThumbHeight: 30,
        deps: [cameras.length],
    });

    const isThermal = (selectedCam?.id ?? cameras[cameraTabActiveIndex]?.id) === 3;

    return (
        <div className={styles.commonBox}>
            <div className={styles.cameraWrapper}>
                {camStatus === "loading" && (
                    <div className={styles.cameraOverlay}>
                        <div className={styles.spinner} />
                        <span>카메라 연결 중...</span>
                    </div>
                )}

                {camStatus === "error" && (
                    <div className={styles.cameraOverlay}>
                        <span>카메라 연결 실패</span>
                        <button onClick={handleRetry}>재시도</button>
                    </div>
                )}

                {isThermal && thermalUrl ? (
                    <img
                        src={thermalUrl}
                        className={styles.cameraImg}
                        onLoad={() => setCamStatus("loaded")}
                        onError={() => setCamStatus("error")}
                    />
                ) : (
                    <img
                        src={cameraStream}
                        className={styles.cameraImg}
                        onLoad={() => setCamStatus("loaded")}
                        onError={() => setCamStatus("error")}
                    />
                )}
            </div>

            {/* 좌상단: 로봇명 */}
            <div className={styles.cornerTopLeft}>
                <span className={styles.cornerLabel}>{defaultRobotName}</span>
            </div>

            {/* 우상단: 전체보기 */}
            <div className={styles.cornerTopRight}>
                <div className={styles.overlayBtn} onClick={() => setRemoteModalOpen(true)}>
                    <img src="/icon/full-screen.png" alt="전체보기" />
                </div>
            </div>

            {/* 우하단: 카메라 셀렉트 */}
            <div ref={camWrapperRef} className={styles.cornerBottomRight}>
                <div className={styles.camSelectButton} onClick={() => setIsOpenCam((v) => !v)}>
                    <span>{selectedCam?.label ?? cameras[cameraTabActiveIndex]?.label ?? "CAM 1"}</span>
                    <img src={isOpenCam ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                </div>
                {isOpenCam && (
                    <div className={styles.camSelectMenu}>
                        <div ref={scrollRef} className={styles.camSelectInner} role="listbox">
                            {cameras.map((cam, idx) => (
                                <div
                                    key={cam.id}
                                    className={styles.camOption}
                                    onClick={() => handleCameraTab(idx, cam)}
                                >
                                    {cam.label}
                                </div>
                            ))}
                        </div>
                        <div ref={trackRef} className={styles.camScrollTrack}>
                            <div ref={thumbRef} className={styles.camScrollThumb} />
                        </div>
                    </div>
                )}
            </div>

            <RemoteMapModal
                isOpen={remoteModalOpen}
                onClose={() => setRemoteModalOpen(false)}
                selectedRobots={selectedRobot}
                robots={robots}
                video={video}
                camera={cameras}
                primaryView="camera"
            />
        </div>
    );
}
