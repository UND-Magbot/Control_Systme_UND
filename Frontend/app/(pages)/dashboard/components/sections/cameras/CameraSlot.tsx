"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import styles from "./CameraSlots.module.css";
import type { Camera, RobotRowData } from "@/app/types";
import { CAMERA_BASE } from "@/app/config";
import { getBatteryColor } from "@/app/constants/robotIcons";

type CameraSlotProps = {
  camera: Camera;
  robotName: string;
  robot?: RobotRowData | null;
  onExpand?: (e: React.MouseEvent) => void;
};

const CAM_TIMEOUT_MS = 10_000;
const CAM_RETRY_MS = 5_000;
// 서버가 MAX_STREAM_DURATION(30s)마다 스트림을 닫으므로, 스트림 종료/에러 시
// 짧은 지연 후 자동 재연결하여 사용자에게 끊김이 보이지 않게 한다.
const AUTO_RECONNECT_DELAY_MS = 300;

export default function CameraSlot({ camera, robotName, robot, onExpand }: CameraSlotProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [thermalUrl, setThermalUrl] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const prevObjectUrlRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mjpegImgRef = useRef<HTMLImageElement | null>(null);
  const unmountedRef = useRef(false);
  // connect 함수를 담아둘 ref — 순환 의존 없이 onFail에서 참조하기 위함
  const connectRef = useRef<((seamless?: boolean) => void) | null>(null);

  const isThermal = (camera.streamType ?? "rtsp") === "ws";

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (retryRef.current) { clearInterval(retryRef.current); retryRef.current = null; }
    if (autoReconnectRef.current) { clearTimeout(autoReconnectRef.current); autoReconnectRef.current = null; }
  }, []);

  // 스트림 종료/에러 시 자동 재연결 스케줄 (connectRef 경유)
  // seamless=true로 호출해 사용자 눈에 끊김이 보이지 않도록 한다.
  const scheduleAutoReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    if (autoReconnectRef.current) clearTimeout(autoReconnectRef.current);
    autoReconnectRef.current = setTimeout(() => {
      autoReconnectRef.current = null;
      if (!unmountedRef.current && connectRef.current) connectRef.current(true);
    }, AUTO_RECONNECT_DELAY_MS);
  }, []);

  const onSuccess = useCallback(() => {
    clearTimers();
    setIsLoading(false);
    setHasError(false);
  }, [clearTimers]);

  const onFail = useCallback(() => {
    clearTimers();
    setIsLoading(false);
    // 서버가 주기적으로 스트림을 닫으므로 대부분의 onError는 정상 종료다.
    // 에러 배너 대신 즉시 재연결하여 사용자 입장에서 끊김이 보이지 않게 한다.
    setHasError(false);
    scheduleAutoReconnect();
  }, [clearTimers, scheduleAutoReconnect]);

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

  /**
   * @param seamless true면 기존 프레임을 유지한 채 URL만 교체 (자동 주기 재연결용).
   *                 false면 URL을 비우고 "연결 중..." 스피너를 띄운다 (초기/수동 재시도용).
   */
  const connectMjpeg = useCallback((seamless: boolean = false) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setThermalUrl(null);

    if (!seamless) {
      setIsLoading(true);
      setHasError(false);
    }

    const raw = camera.webrtcUrl;
    const base = raw.startsWith("ws") || raw.startsWith("http")
      ? raw
      : `${CAMERA_BASE}${raw}`;
    const url = base + (base.includes("?") ? "&" : "?") + "t=" + Date.now();

    if (seamless) {
      // 마지막 프레임을 유지한 채 src만 교체 → 사용자 눈엔 끊김 없음
      // (서버의 Connection: close 덕분에 이전 소켓은 자동 tear down)
      setStreamUrl(url);
    } else {
      // 초기/수동 재시도: 이전 연결을 명시적으로 떼어낸 뒤 새 URL
      setStreamUrl("");
      requestAnimationFrame(() => setStreamUrl(url));
    }

    timeoutRef.current = setTimeout(() => {
      // 타임아웃: URL을 비우고 로딩 상태 초기화 후 재연결 예약
      setStreamUrl("");
      setIsLoading(false);
      setHasError(true);
      scheduleAutoReconnect();
    }, CAM_TIMEOUT_MS);
  }, [camera, scheduleAutoReconnect]);

  const connect = useCallback((seamless: boolean = false) => {
    if (isThermal) connectThermal();
    else connectMjpeg(seamless);
  }, [isThermal, connectThermal, connectMjpeg]);

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
      // unmount 시 img DOM 노드의 src를 직접 비워 MJPEG 연결을 즉시 해제
      // (setState는 unmount 중 무시될 수 있으므로 DOM을 직접 조작)
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
                <>
                  L <span style={{ color: getBatteryColor(robot.batteryLeft ?? 0, robot.return) }}>{robot.batteryLeft ?? "-"}%</span>
                  {" / "}
                  R <span style={{ color: getBatteryColor(robot.batteryRight ?? 0, robot.return) }}>{robot.batteryRight ?? "-"}%</span>
                </>
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
