'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Camera } from '@/app/types';
import { CAMERA_BASE } from '@/app/config';

const CAM_TIMEOUT_MS = 10_000;
const CAM_RETRY_MS = 5_000;

type UseCameraStreamOptions = {
  isOpen: boolean;
  camera: Camera[];
  initialCam?: Camera | null;
  initialCamIndex?: number;
};

export function useCameraStream({
  isOpen,
  camera,
  initialCam,
  initialCamIndex,
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
  const prevObjectUrlRef = useRef<string | null>(null);
  const didInitRef = useRef(false);
  const userTouchedRef = useRef(false);
  const unmountedRef = useRef(false);
  const errorCountRef = useRef(0);

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

  // --- 열화상 WS (현재 미사용) ---
  const closeThermalWS = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

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
      clearCamTimeout();
      clearRetryTimer();
      setIsCamLoading(true);
      setCamError(false);
      setSelectedCam(cam.id);
      setActiveCam(cam.id);
      setCameraTabActiveIndex(idx);

      setCameraStream("");
      const nextUrl = cam.webrtcUrl || `${CAMERA_BASE}/Video/${cam.id}`;
      requestAnimationFrame(() => setCameraStream(nextUrl));
      startCamTimeoutInner();
    },
    [clearCamTimeout, clearRetryTimer, closeThermalWS, startCamTimeoutInner],
  );

  // --- 초기화 ---
  const cameraIdsKey = camera.map((c) => c.id).join(',');

  useEffect(() => {
    if (!isOpen) {
      didInitRef.current = false;
      userTouchedRef.current = false;
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

    clearCamTimeout();
    clearRetryTimer();
    setIsCamLoading(true);
    setCamError(false);
    setSelectedCam(baseCam.id);
    setActiveCam(baseCam.id);
    setCameraTabActiveIndex(nextIdx);

    const nextUrl = baseCam.webrtcUrl || `${CAMERA_BASE}/Video/${baseCam.id}`;
    setCameraStream(nextUrl);
    startCamTimeoutInner();
  }, [isOpen, cameraIdsKey, initialCam?.id, initialCamIndex]);

  // --- cleanup ---
  useEffect(() => {
    if (!isOpen) {
      unmountedRef.current = true;
      closeThermalWS();
      clearCamTimeout();
      clearRetryTimer();
      setCameraStream("");
      setThermalUrl(null);
      if (prevObjectUrlRef.current) {
        URL.revokeObjectURL(prevObjectUrlRef.current);
        prevObjectUrlRef.current = null;
      }
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
