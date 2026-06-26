'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Camera } from '@/app/types';
import { CAMERA_BASE } from '@/app/config';
import { createThermalFrameSink, type ThermalFrameSink } from '@/app/components/camera/thermalFrameSink';

const CAM_TIMEOUT_MS = 10_000;
const CAM_RETRY_MS = 5_000;
// 열화상(WS) 스트림 watchdog — 멈춤/half-open 자동 복구 (대시보드 CameraSlot과 동일)
const THERMAL_STALL_MS = 6_000;
const THERMAL_WATCHDOG_MS = 2_000;

type UseCameraStreamOptions = {
  isOpen: boolean;
  camera: Camera[];
  initialCam?: Camera | null;
  initialCamIndex?: number;
  /** false면 연결·재연결을 멈춘다(로봇 통신 끊김 시 무한 재연결 방지). 기본 true */
  enabled?: boolean;
};

export function useCameraStream({
  isOpen,
  camera,
  initialCam,
  initialCamIndex,
  enabled = true,
}: UseCameraStreamOptions) {
  const [isCamLoading, setIsCamLoading] = useState(true);
  const [camError, setCamError] = useState(false);
  const [activeCam, setActiveCam] = useState<number>(1);
  const [cameraTabActiveIndex, setCameraTabActiveIndex] = useState(0);
  const [selectedCam, setSelectedCam] = useState<number | null>(null);
  const [cameraStream, setCameraStream] = useState('');
  const [thermalUrl, setThermalUrl] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const camTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const didInitRef = useRef(false);
  const userTouchedRef = useRef(false);
  const unmountedRef = useRef(false);
  const errorCountRef = useRef(0);
  const wsWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameAtRef = useRef(0);
  const connectThermalRef = useRef<(cam: Camera, silent?: boolean) => void>(() => {});
  // enabled를 ref로 추적 — 콜백 재생성 없이 인터벌/실패 핸들러에서 최신 값을 본다.
  const enabledRef = useRef(enabled);

  // 열화상 프레임 싱크 — 최신 프레임만 ~15fps 상한으로 렌더(backlog/빨리감기 방지)
  const sinkRef = useRef<ThermalFrameSink | null>(null);
  const getSink = useCallback(() => {
    if (!sinkRef.current) sinkRef.current = createThermalFrameSink(setThermalUrl);
    return sinkRef.current;
  }, []);

  // --- 타이머 헬퍼 ---
  const clearCamTimeout = useCallback(() => {
    if (camTimeoutRef.current) {
      clearTimeout(camTimeoutRef.current);
      camTimeoutRef.current = null;
    }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // 연결 성공 시 공통 처리
  const onConnectSuccess = useCallback(() => {
    clearCamTimeout();
    clearRetryTimer();
    errorCountRef.current = 0;
    setIsCamLoading(false);
    setCamError(false);
  }, [clearCamTimeout, clearRetryTimer]);

  const startRetryTimer = useCallback(() => {
    clearRetryTimer();
    retryTimerRef.current = setInterval(() => {
      if (unmountedRef.current) return;
      if (!enabledRef.current) return; // 로봇 통신 끊김 — 재시도 보류
      if (document.hidden) return; // 백그라운드 탭에서는 재시도 보류 (M-2)
      setIsCamLoading(true);
      setCamError(false);

      const cam = camera.find((c) => c.id === (selectedCam ?? activeCam)) ?? camera[0];
      if (!cam) return;

      const url = cam.webrtcUrl || `${CAMERA_BASE}/Video/${cam.id}`;
      const nextUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
      setCameraStream("");
      requestAnimationFrame(() => setCameraStream(nextUrl));
    }, CAM_RETRY_MS);
  }, [clearRetryTimer, camera, selectedCam, activeCam]);

  const startCamTimeoutInner = useCallback(() => {
    clearCamTimeout();
    camTimeoutRef.current = setTimeout(() => {
      setCameraStream("");
      setIsCamLoading(false);
      setCamError(true);
      if (wsRef.current) wsRef.current.close();
      startRetryTimer();
    }, CAM_TIMEOUT_MS);
  }, [clearCamTimeout, startRetryTimer]);

  // --- 열화상 WS ---
  const closeThermalWS = useCallback(() => {
    if (wsWatchdogRef.current) { clearInterval(wsWatchdogRef.current); wsWatchdogRef.current = null; }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
  }, []);

  // 열화상 실패/멈춤 → 재연결(≤2회 조용히) 또는 에러 UI + 주기 재시도
  const onThermalFail = useCallback((cam: Camera) => {
    if (wsWatchdogRef.current) { clearInterval(wsWatchdogRef.current); wsWatchdogRef.current = null; }
    clearCamTimeout();
    // 로봇 통신 끊김 — 재연결하지 않고 정지.
    if (!enabledRef.current) { clearRetryTimer(); return; }
    errorCountRef.current += 1;
    if (errorCountRef.current <= 2) {
      if (!unmountedRef.current) connectThermalRef.current(cam, true);
      return;
    }
    clearRetryTimer();
    setIsCamLoading(false);
    setCamError(true);
    retryTimerRef.current = setInterval(() => {
      if (unmountedRef.current || !enabledRef.current) return;
      connectThermalRef.current(cam, true);
    }, CAM_RETRY_MS);
  }, [clearCamTimeout, clearRetryTimer]);

  // 열화상 WebSocket 연결 (silent=true면 마지막 프레임 유지한 채 조용히 재연결)
  const connectThermal = useCallback((cam: Camera, silent = false) => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    if (wsWatchdogRef.current) { clearInterval(wsWatchdogRef.current); wsWatchdogRef.current = null; }
    clearCamTimeout();
    clearRetryTimer();
    setCameraStream("");
    if (!silent) {
      getSink().reset();   // 마지막 프레임 폐기 + thermalUrl(null)
      setIsCamLoading(true);
    }
    setCamError(false);

    const ws = new WebSocket(cam.webrtcUrl);
    wsRef.current = ws;
    lastFrameAtRef.current = Date.now();

    camTimeoutRef.current = setTimeout(() => onThermalFail(cam), CAM_TIMEOUT_MS);

    ws.onerror = () => onThermalFail(cam);
    // onerror가 안 뜨는 (반)종료도 onclose에서 재연결
    ws.onclose = () => { if (wsRef.current === ws && !unmountedRef.current) onThermalFail(cam); };
    ws.onmessage = (e) => {
      if (e.data instanceof Blob) {
        lastFrameAtRef.current = Date.now();
        onConnectSuccess();
        getSink().push(e.data);   // 최신 프레임만 합쳐 ~15fps로 렌더
      }
    };

    // 새 프레임이 THERMAL_STALL_MS 동안 없으면(멈춤/half-open) 마지막 프레임 유지한 채 재연결
    wsWatchdogRef.current = setInterval(() => {
      if (unmountedRef.current) return;
      if (Date.now() - lastFrameAtRef.current > THERMAL_STALL_MS) onThermalFail(cam);
    }, THERMAL_WATCHDOG_MS);
  }, [clearCamTimeout, clearRetryTimer, onConnectSuccess, onThermalFail, getSink]);

  useEffect(() => { connectThermalRef.current = connectThermal; }, [connectThermal]);

  // --- 재연결 ---
  const retryConnection = useCallback(() => {
    const cam = camera.find((c) => c.id === (selectedCam ?? activeCam)) ?? camera[0];
    if (!cam) return;

    setIsCamLoading(true);
    setCamError(false);
    startCamTimeoutInner();

    const url = cam.webrtcUrl || `${CAMERA_BASE}/Video/${cam.id}`;
    const nextUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    setCameraStream("");
    requestAnimationFrame(() => setCameraStream(nextUrl));
  }, [camera, selectedCam, activeCam, startCamTimeoutInner]);

  // --- img 이벤트 ---
  const handleCamImgLoad = useCallback(() => {
    onConnectSuccess();
  }, [onConnectSuccess]);

  const handleCamImgError = useCallback(() => {
    clearCamTimeout();
    // 로봇 통신 끊김 — 재연결하지 않고 정지.
    if (!enabledRef.current) { clearRetryTimer(); return; }
    errorCountRef.current += 1;

    if (errorCountRef.current <= 2) {
      // 즉시 재연결 시도 (에러 UI 없이)
      const cam = camera.find((c) => c.id === (selectedCam ?? activeCam)) ?? camera[0];
      if (cam) {
        const url = cam.webrtcUrl || `${CAMERA_BASE}/Video/${cam.id}`;
        const nextUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
        setCameraStream(nextUrl);
        startCamTimeoutInner();
      }
      return;
    }

    // 3회 이상 연속 실패 → 에러 UI + 주기적 재시도
    clearRetryTimer();
    setCameraStream("");
    setIsCamLoading(false);
    setCamError(true);
    startRetryTimer();
  }, [clearCamTimeout, clearRetryTimer, startRetryTimer, camera, selectedCam, activeCam, startCamTimeoutInner]);

  const handleRetryCamera = useCallback(() => {
    clearRetryTimer();
    retryConnection();
  }, [clearRetryTimer, retryConnection]);

  // --- 카메라 탭 전환 ---
  const handleCameraTab = useCallback(
    (idx: number, cam: Camera) => {
      userTouchedRef.current = true;
      closeThermalWS();
      clearCamTimeout();
      clearRetryTimer();
      errorCountRef.current = 0;
      setIsCamLoading(true);
      setCamError(false);
      setSelectedCam(cam.id);
      setActiveCam(cam.id);
      setCameraTabActiveIndex(idx);

      if ((cam.streamType ?? "rtsp") === "rtsp") {
        // RTSP 카메라는 ViewportArea가 WebRTC(WebRTCPlayer)로 직접 송출 →
        // MJPEG 스트림/타이머를 돌리지 않는다.
        setIsCamLoading(false);
        setCamError(false);
        setCameraStream("");
        return;
      }

      if (cam.streamType === "ws") {
        // 열화상 — WebSocket 송출 (watchdog/재연결 견고화 포함)
        connectThermal(cam);
        return;
      }

      setCameraStream("");
      const nextUrl = cam.webrtcUrl || `${CAMERA_BASE}/Video/${cam.id}`;
      requestAnimationFrame(() => setCameraStream(nextUrl));
      startCamTimeoutInner();
    },
    [clearCamTimeout, clearRetryTimer, closeThermalWS, startCamTimeoutInner, connectThermal],
  );

  // --- 초기화 ---
  const cameraIdsKey = camera.map((c) => c.id).join(',');

  useEffect(() => {
    enabledRef.current = enabled;
    if (!isOpen) {
      didInitRef.current = false;
      userTouchedRef.current = false;
      return;
    }
    if (!enabled) {
      // 로봇 통신 끊김 — WS/타이머/스트림을 정리하고 재연결을 보류한다.
      // didInit을 풀어 재연결 시 다시 초기화되도록 한다.
      closeThermalWS();
      clearCamTimeout();
      clearRetryTimer();
      setCameraStream("");
      didInitRef.current = false;
      return;
    }
    if (camera.length === 0) return;
    if (didInitRef.current && userTouchedRef.current) return;

    didInitRef.current = true;

    const frontCam = camera.find((c) => {
      const l = c.label.toLowerCase();
      return l.includes('전방') || l.includes('front');
    });
    const baseCam = initialCam ?? frontCam ?? camera[0];
    if (!baseCam) return;

    const nextIdx =
      typeof initialCamIndex === 'number'
        ? initialCamIndex
        : Math.max(0, camera.findIndex((c) => c.id === baseCam.id));

    closeThermalWS();
    clearCamTimeout();
    clearRetryTimer();
    errorCountRef.current = 0;
    setIsCamLoading(true);
    setCamError(false);
    setSelectedCam(baseCam.id);
    setActiveCam(baseCam.id);
    setCameraTabActiveIndex(nextIdx);

    if ((baseCam.streamType ?? "rtsp") === "rtsp") {
      // RTSP 카메라는 ViewportArea가 WebRTC(WebRTCPlayer)로 직접 송출 →
      // MJPEG 스트림/타이머를 돌리지 않는다.
      setIsCamLoading(false);
      setCamError(false);
      setCameraStream("");
      return;
    }

    if (baseCam.streamType === "ws") {
      // 열화상 — WebSocket 송출 (watchdog/재연결 견고화 포함)
      connectThermal(baseCam);
      return;
    }

    const nextUrl = baseCam.webrtcUrl || `${CAMERA_BASE}/Video/${baseCam.id}`;
    setCameraStream(nextUrl);
    startCamTimeoutInner();
  }, [isOpen, enabled, cameraIdsKey, initialCam?.id, initialCamIndex]);

  // --- cleanup ---
  useEffect(() => {
    if (!isOpen) {
      unmountedRef.current = true;
      closeThermalWS();
      clearCamTimeout();
      clearRetryTimer();
      setCameraStream("");
      sinkRef.current?.reset();   // 대기 프레임·objectURL 정리 + thermalUrl(null)
    } else {
      unmountedRef.current = false;
    }
  }, [isOpen, closeThermalWS, clearCamTimeout, clearRetryTimer]);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const selectedCamLabel =
    camera.find((c) => c.id === (selectedCam ?? activeCam))?.label ?? 'Cam 1';

  return {
    isCamLoading,
    camError,
    activeCam,
    cameraTabActiveIndex,
    selectedCam,
    cameraStream,
    thermalUrl,
    retryKey,
    selectedCamLabel,
    handleCamImgLoad,
    handleCamImgError,
    handleRetryCamera,
    handleCameraTab,
  };
}
