"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import styles from "./CameraSlots.module.css";
import type { Camera, RobotRowData } from "@/app/types";
import { CAMERA_BASE } from "@/app/config";
import WebRTCPlayer from "@/app/components/camera/WebRTCPlayer";
import { createThermalFrameSink, type ThermalFrameSink } from "@/app/components/camera/thermalFrameSink";
import { getBatteryColor, isSingleBatteryMode } from "@/app/constants/robotIcons";
import { isDualBatteryType } from "@/app/constants/robotCapabilities";

type CameraSlotProps = {
  camera: Camera;
  robotName: string;
  robot?: RobotRowData | null;
  onExpand?: (e: React.MouseEvent) => void;
  /** 작게 보이는 슬롯용 — 백엔드 프록시에서 저해상도·저품질로 받아 부하를 줄임 */
  lowRes?: boolean;
};

// 첫 프레임 대기 한도 — 백엔드 RTSP 프록시는 WAKE 후 캡처 open + 재연결까지
// 수 초가 걸릴 수 있어 넉넉히 둔다(짧게 잡으면 정상인데도 "연결 실패"로 오인).
const CAM_TIMEOUT_MS = 20_000;
const CAM_RETRY_MS = 5_000;
// 열화상(WS) 스트림 watchdog — 새 프레임이 끊겨도(half-open/서버 정지) 자동 복구.
const THERMAL_STALL_MS = 6_000;      // 이 시간 동안 새 프레임 없으면 재연결
const THERMAL_WATCHDOG_MS = 2_000;   // watchdog 점검 주기

export default function CameraSlot({ camera, robotName, robot, onExpand, lowRes = false }: CameraSlotProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [thermalUrl, setThermalUrl] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mjpegImgRef = useRef<HTMLImageElement | null>(null);
  const unmountedRef = useRef(false);
  const connectRef = useRef<(() => void) | null>(null);
  const errorCountRef = useRef(0);
  const wsWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameAtRef = useRef(0);
  const everFrameRef = useRef(false);   // 한 번이라도 프레임을 받았는가(재연결 시 스피너 억제용)

  // 열화상 프레임 싱크 — 최신 프레임만 ~15fps 상한으로 렌더(backlog/빨리감기 방지)
  const sinkRef = useRef<ThermalFrameSink | null>(null);
  const getSink = useCallback(() => {
    if (!sinkRef.current) sinkRef.current = createThermalFrameSink(setThermalUrl);
    return sinkRef.current;
  }, []);

  const isThermal = (camera.streamType ?? "rtsp") === "ws";
  // RTSP 카메라는 MediaMTX WebRTC(WebRTCPlayer)로 저지연 송출
  const isWebrtc = (camera.streamType ?? "rtsp") === "rtsp";

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
    // 진행 중인 watchdog 정지 (재연결/에러대기 중 중복 발화 방지)
    if (wsWatchdogRef.current) { clearInterval(wsWatchdogRef.current); wsWatchdogRef.current = null; }
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
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    if (wsWatchdogRef.current) { clearInterval(wsWatchdogRef.current); wsWatchdogRef.current = null; }
    // 마지막 프레임이 있으면(재연결) 로딩 오버레이 없이 직전 프레임 유지, 최초 연결이면 로딩 표시
    if (!everFrameRef.current) setIsLoading(true);
    setHasError(false);

    const ws = new WebSocket(camera.webrtcUrl);
    wsRef.current = ws;
    lastFrameAtRef.current = Date.now();

    timeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      setHasError(true);
      try { ws.close(); } catch {}
    }, CAM_TIMEOUT_MS);

    ws.onerror = () => onFail();
    // 소켓이 (반)종료돼도 onerror가 안 뜰 수 있어 onclose에서도 재연결 처리
    ws.onclose = () => {
      if (wsRef.current === ws && !unmountedRef.current) onFail();
    };
    ws.onmessage = (e) => {
      if (e.data instanceof Blob) {
        lastFrameAtRef.current = Date.now();
        everFrameRef.current = true;
        onSuccess();
        getSink().push(e.data);   // 최신 프레임만 합쳐 ~15fps로 렌더
      }
    };

    // 프레임 watchdog — 새 프레임이 THERMAL_STALL_MS 동안 없으면(멈춤/half-open) 재연결한다.
    // 마지막 프레임은 유지하므로 검은 화면 대신 직전 화면이 남는다.
    wsWatchdogRef.current = setInterval(() => {
      if (unmountedRef.current) return;
      if (Date.now() - lastFrameAtRef.current > THERMAL_STALL_MS) onFail();
    }, THERMAL_WATCHDOG_MS);
  }, [onSuccess, onFail, getSink]);

  const connectMjpeg = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    sinkRef.current?.reset();   // 열화상 → MJPEG 전환 시 대기 프레임·objectURL 정리
    setIsLoading(true);
    setHasError(false);

    const raw = camera.webrtcUrl;
    const base = raw.startsWith("ws") || raw.startsWith("http")
      ? raw
      : `${CAMERA_BASE}${raw}`;
    // 작은 슬롯(lowRes)은 백엔드 RTSP 프록시에서 저해상도·저품질로 받아
    // 인코딩 부하를 줄인다. rtsp(백엔드 프록시) 경로에만 적용.
    const quality =
      lowRes && (camera.streamType ?? "rtsp") === "rtsp" ? "&w=640&q=55" : "";
    const url = base + (base.includes("?") ? "&" : "?") + "t=" + Date.now() + quality;

    // 이전 img src를 해제하여 브라우저 연결을 끊고 새 URL 즉시 세팅
    if (mjpegImgRef.current) {
      try { mjpegImgRef.current.src = ""; } catch {}
    }
    setStreamUrl(url);

    timeoutRef.current = setTimeout(() => {
      errorCountRef.current += 1;
      clearTimers();
      // 첫 프레임 지연 — 2회까지는 조용히 재시도(스피너 유지), 그 이상만 에러 UI.
      // (백엔드 프록시가 투명 재연결하므로 결국 프레임이 도착한다)
      if (errorCountRef.current <= 2) {
        if (!unmountedRef.current && connectRef.current) connectRef.current();
        return;
      }
      setStreamUrl("");
      setIsLoading(false);
      setHasError(true);
      retryRef.current = setInterval(() => {
        if (!unmountedRef.current && connectRef.current) connectRef.current();
      }, CAM_RETRY_MS);
    }, CAM_TIMEOUT_MS);
  }, [camera, clearTimers, lowRes]);

  const connect = useCallback(() => {
    clearTimers();
    if (isWebrtc) {
      // RTSP 카메라는 WebRTCPlayer가 연결·재시도를 자체 처리 — MJPEG 타이머 불필요
      setIsLoading(false);
      setHasError(false);
      return;
    }
    if (isThermal) connectThermal();
    else connectMjpeg();
  }, [isWebrtc, isThermal, connectThermal, connectMjpeg, clearTimers]);

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
      if (wsWatchdogRef.current) { clearInterval(wsWatchdogRef.current); wsWatchdogRef.current = null; }
      if (wsRef.current) wsRef.current.close();
      sinkRef.current?.reset();   // 대기 프레임·objectURL 정리 + thermalUrl(null)
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
      {isWebrtc ? (
        <WebRTCPlayer whepUrl={camera.webrtcUrl} videoClassName={styles.cameraImg} />
      ) : isThermal && thermalUrl ? (
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
              {isDualBatteryType(robot.type) ? (
                isSingleBatteryMode(robot) ? (
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
