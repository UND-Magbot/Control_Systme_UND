'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Camera } from '@/app/types';
import { API_BASE } from '@/app/config';

/** 대시보드와 동일한 타임아웃/재시도 값 */
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

  // --- 타이머 헬퍼 (대시보드 동일) ---
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
    setIsCamLoading(false);
    setCamError(false);
  }, [clearCamTimeout, clearRetryTimer]);

  // --- 재연결 (대시보드 동일 패턴: 캐시버스트 + 5초 간격) ---
  const retryConnection = useCallback(() => {
    const cam = camera.find((c) => c.id === (selectedCam ?? activeCam)) ?? camera[0];
    if (!cam) return;

    // 열화상 WS 미사용
    // if (cam.streamType === 'ws') {
    //   connectThermalWSInner(cam);
    // } else {
    setIsCamLoading(true);
    setCamError(false);
    startCamTimeoutInner();
    const url = cam.webrtcUrl || `${API_BASE}/Video/${cam.id}`;
    setCameraStream(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
    // }
  }, [camera, selectedCam, activeCam]);

  const startRetryTimer = useCallback(() => {
    clearRetryTimer();
    retryTimerRef.current = setInterval(() => {
      retryConnection();
    }, CAM_RETRY_MS);
  }, [clearRetryTimer, retryConnection]);

  const startCamTimeoutInner = useCallback(() => {
    clearCamTimeout();
    camTimeoutRef.current = setTimeout(() => {
      setIsCamLoading(false);
      setCamError(true);
      if (wsRef.current) wsRef.current.close();
      startRetryTimer();
    }, CAM_TIMEOUT_MS);
  }, [clearCamTimeout, startRetryTimer]);

  // --- 열화상 WS (현재 미사용 — 필요 시 주석 해제) ---
  const closeThermalWS = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // --- img 이벤트 ---
  const handleCamImgLoad = useCallback(() => {
    onConnectSuccess();
  }, [onConnectSuccess]);

  const handleCamImgError = useCallback(() => {
    clearCamTimeout();
    setIsCamLoading(false);
    setCamError(true);
    startRetryTimer();
  }, [clearCamTimeout, startRetryTimer]);

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

      // 열화상 WS 미사용
      // if (cam.streamType === 'ws') {
      //   setThermalUrl(null);
      //   connectThermalWSInner(cam);
      //   return;
      // }

      const nextUrl = cam.webrtcUrl || `${API_BASE}/Video/${cam.id}`;
      setCameraStream(nextUrl);
      startCamTimeoutInner();
    },
    [clearCamTimeout, clearRetryTimer, closeThermalWS, startCamTimeoutInner],
  );

  // --- 초기화 (카메라 목록 변경 시에도 재초기화) ---
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

    // 전방 카메라 우선 선택
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

    // 열화상 WS 미사용
    const nextUrl = baseCam.webrtcUrl || `${API_BASE}/Video/${baseCam.id}`;
    setCameraStream(nextUrl);
    startCamTimeoutInner();
  }, [isOpen, cameraIdsKey, initialCam?.id, initialCamIndex]);

  // --- cleanup ---
  useEffect(() => {
    if (!isOpen) {
      closeThermalWS();
      clearCamTimeout();
      clearRetryTimer();
      if (prevObjectUrlRef.current) {
        URL.revokeObjectURL(prevObjectUrlRef.current);
        prevObjectUrlRef.current = null;
      }
    }
  }, [isOpen, closeThermalWS, clearCamTimeout, clearRetryTimer]);

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
