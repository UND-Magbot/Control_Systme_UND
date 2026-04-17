"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import styles from "./CameraSlots.module.css";
import type { Camera, RobotRowData } from "@/app/types";
import { CAMERA_BASE } from "@/app/config";
import { getBatteryColor, isQuadrupedSingleBatteryMode } from "@/app/constants/robotIcons";

type CameraSlotProps = {
  camera: Camera;
  robotName: string;
  robot?: RobotRowData | null;
  onExpand?: (e: React.MouseEvent) => void;
};

const CAM_TIMEOUT_MS = 10_000;
const CAM_RETRY_MS = 5_000;

export default function CameraSlot({ camera, robotName, robot, onExpand }: CameraSlotProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [thermalUrl, setThermalUrl] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const prevObjectUrlRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mjpegImgRef = useRef<HTMLImageElement | null>(null);
  const unmountedRef = useRef(false);
  const connectRef = useRef<(() => void) | null>(null);
  const errorCountRef = useRef(0);

  const isThermal = (camera.streamType ?? "rtsp") === "ws";

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (retryRef.current) { clearInterval(retryRef.current); retryRef.current = null; }
  }, []);

  const onSuccess = useCallback(() => {
    clearTimers();
    errorCountRef.current = 0;
    setIsLoading(false);
    setHasError(false);
  }, [clearTimers]);

  const onFail = useCallback(() => {
    errorCountRef.current += 1;

    if (errorCountRef.current <= 2) {
      // 즉시 재연결 시도 (에러 UI 없이)
      clearTimers();
      if (!unmountedRef.current && connectRef.current) connectRef.current();
      return;
    }

    // 3회 이상 연속 실패 → 에러 UI + 주기적 재시도
    clearTimers();
    setStreamUrl("");
    setIsLoading(false);
    setHasError(true);
    retryRef.current = setInterval(() => {
      if (!unmountedRef.current && connectRef.current) connectRef.current();
    }, CAM_RETRY_MS);
  }, [clearTimers]);

  const connectThermal = useCallback(() => {
    if (wsRef.current) wsRef.current.close();
    setIsLoading(true);
    setHasError(false);

    const ws = new WebSocket(camera.webrtcUrl);
    wsRef.current = ws;

    timeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      setHasError(true);
      ws.close();
    }, CAM_TIMEOUT_MS);

    ws.onerror = () => onFail();
    ws.onmessage = (e) => {
      if (e.data instanceof Blob) {
        onSuccess();
        const url = URL.createObjectURL(e.data);
        if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
        prevObjectUrlRef.current = url;
        setThermalUrl(url);
      }
    };
  }, [onSuccess, onFail]);

  const connectMjpeg = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setThermalUrl(null);
    setIsLoading(true);
    setHasError(false);

    const raw = camera.webrtcUrl;
    const base = raw.startsWith("ws") || raw.startsWith("http")
      ? raw
      : `${CAMERA_BASE}${raw}`;
    const url = base + (base.includes("?") ? "&" : "?") + "t=" + Date.now();

    // 이전 img src를 해제하여 브라우저 연결을 끊고 새 URL 즉시 세팅
    if (mjpegImgRef.current) {
      try { mjpegImgRef.current.src = ""; } catch {}
    }
    setStreamUrl(url);

    timeoutRef.current = setTimeout(() => {
      setStreamUrl("");
      setIsLoading(false);
      setHasError(true);
      // 5초 간격 자동 재시도
      retryRef.current = setInterval(() => {
        if (!unmountedRef.current && connectRef.current) connectRef.current();
      }, CAM_RETRY_MS);
    }, CAM_TIMEOUT_MS);
  }, [camera]);

  const connect = useCallback(() => {
    clearTimers();
    if (isThermal) connectThermal();
    else connectMjpeg();
  }, [isThermal, connectThermal, connectMjpeg, clearTimers]);

  // connectRef에 최신 connect 주입
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // 초기 연결
  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      clearTimers();
      if (wsRef.current) wsRef.current.close();
      if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
      if (mjpegImgRef.current) {
        try {
          mjpegImgRef.current.src = "";
          mjpegImgRef.current.removeAttribute("src");
        } catch {}
      }
      setStreamUrl("");
      setThermalUrl(null);
    };
  }, [camera.id]);

  const handleRetry = () => {
    connect();
  };

  return (
    <div className={styles.slotContainer}>
      {/* 로딩 */}
      {isLoading && !hasError && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
          <span>연결 중...</span>
        </div>
      )}

      {/* 에러 */}
      {hasError && (
        <div className={styles.errorOverlay}>
          <span>연결 실패</span>
          <button className={styles.retryBtn} onClick={handleRetry}>
            재연결
          </button>
        </div>
      )}

      {/* 스트림 */}
      {isThermal && thermalUrl ? (
        <img
          src={thermalUrl}
          className={styles.cameraImg}
          alt="thermal"
          onLoad={onSuccess}
          onError={onFail}
        />
      ) : !isThermal && streamUrl ? (
        <img
          ref={mjpegImgRef}
          src={streamUrl}
          className={styles.cameraImg}
          alt="mjpeg"
          onLoad={onSuccess}
          onError={onFail}
        />
      ) : !isLoading && !hasError ? (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
          <span>연결 중...</span>
        </div>
      ) : null}

      {/* 확장 아이콘 */}
      {onExpand && (
        <button className={styles.expandBtn} onClick={onExpand} aria-label="확대">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      )}

      {/* 레이블 */}
      {robotName && !isLoading && !hasError && (
        <div className={styles.robotLabel}>
          {robotName}
          {robot && (
            <span className={styles.robotLabelStatus}>
              <span className={`${styles.robotLabelDot} ${robot.network === "Online" ? styles.robotLabelDotOnline : styles.robotLabelDotOffline}`} />
              {robot.network}
              <span className={styles.robotLabelDivider}>|</span>
              {robot.type === "QUADRUPED" ? (
                isQuadrupedSingleBatteryMode(robot) ? (
                  <span style={{ color: getBatteryColor(robot.batteryLeft ?? robot.batteryRight ?? 0, robot.return) }}>
                    {robot.batteryLeft ?? robot.batteryRight ?? "-"}%
                  </span>
                ) : (
                  <>
                    L <span style={{ color: getBatteryColor(robot.batteryLeft ?? 0, robot.return) }}>{robot.batteryLeft ?? "-"}%</span>
                    {" / "}
                    R <span style={{ color: getBatteryColor(robot.batteryRight ?? 0, robot.return) }}>{robot.batteryRight ?? "-"}%</span>
                  </>
                )
              ) : (
                <span style={{ color: getBatteryColor(robot.battery, robot.return) }}>{robot.battery}%</span>
              )}
              <span className={styles.robotLabelDivider}>|</span>
              {robot.power}
            </span>
          )}
        </div>
      )}
      <div className={styles.slotLabel}>{camera.label}</div>
    </div>
  );
}
