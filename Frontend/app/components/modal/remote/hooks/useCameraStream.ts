'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Camera } from '@/app/types';
import { CAMERA_BASE } from '@/app/config';

/** 대시보드와 동일한 타임아웃/재시도 값 */
const CAM_TIMEOUT_MS = 10_000;
const CAM_RETRY_MS = 5_000;
// 서버가 MAX_STREAM_DURATION(30s)마다 스트림을 닫으므로, 스트림 종료 시
// 짧은 지연 후 자동 재연결하여 사용자 눈엔 끊김이 보이지 않도록 한다.
const AUTO_RECONNECT_DELAY_MS = 300;

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
  const autoReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevObjectUrlRef = useRef<string | null>(null);
  const didInitRef = useRef(false);
  const userTouchedRef = useRef(false);
  const unmountedRef = useRef(false);
  // retryConnection 함수를 담아둘 ref — scheduleAutoReconnect에서 참조
  const retryConnectionRef = useRef<((seamless?: boolean) => void) | null>(null);

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
    if (autoReconnectRef.current) {
      clearTimeout(autoReconnectRef.current);
      autoReconnectRef.current = null;
    }
  }, []);

  // 스트림 종료/에러 시 자동 재연결 스케줄 (seamless 모드)
  const scheduleAutoReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    if (autoReconnectRef.current) clearTimeout(autoReconnectRef.current);
    autoReconnectRef.current = setTimeout(() => {
      autoReconnectRef.current = null;
      if (!unmountedRef.current && retryConnectionRef.current) {
        retryConnectionRef.current(true);
      }
    }, AUTO_RECONNECT_DELAY_MS);
  }, []);

  // 연결 성공 시 공통 처리
  const onConnectSuccess = useCallback(() => {
    clearCamTimeout();
    clearRetryTimer();
    setIsCamLoading(false);
    setCamError(false);
  }, [clearCamTimeout, clearRetryTimer]);

  /**
   * 재연결.
   * @param seamless true면 기존 프레임을 유지한 채 URL만 교체 (자동 주기 재연결).
   *                 false면 URL을 비우고 "연결 중..." 스피너 표시 (수동 재시도).
   */
  const retryConnection = useCallback((seamless: boolean = false) => {
    const cam = camera.find((c) => c.id === (selectedCam ?? activeCam)) ?? camera[0];
    if (!cam) return;

    // 열화상 WS 미사용
    // if (cam.streamType === 'ws') {
    //   connectThermalWSInner(cam);
    // } else {
    if (!seamless) {
      setIsCamLoading(true);
      setCamError(false);
    }
    startCamTimeoutInner();
    const url = cam.webrtcUrl || `${CAMERA_BASE}/Video/${cam.id}`;
    const nextUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();

    if (seamless) {
      // 마지막 프레임을 유지한 채 src만 교체 → 끊김 없음
      setCameraStream(nextUrl);
    } else {
      // 수동 재시도: 이전 연결을 명시적으로 떼어낸 뒤 새 URL
      setCameraStream("");
      requestAnimationFrame(() => setCameraStream(nextUrl));
    }
    // }
  }, [camera, selectedCam, activeCam]);

  // retryConnectionRef에 최신 retryConnection 주입
  useEffect(() => {
    retryConnectionRef.current = retryConnection;
  }, [retryConnection]);

  const startRetryTimer = useCallback(() => {
    clearRetryTimer();
    retryTimerRef.current = setInterval(() => {
      retryConnection(false);
    }, CAM_RETRY_MS);
  }, [clearRetryTimer, retryConnection]);

  const startCamTimeoutInner = useCallback(() => {
    clearCamTimeout();
    camTimeoutRef.current = setTimeout(() => {
      // 타임아웃 시 URL을 비워 MJPEG 연결을 확실히 해제 (좀비 연결 방지)
      setCameraStream("");
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
    // 서버가 30초마다 스트림을 닫으므로 대부분의 onError는 정상 종료다.
    // 에러 배너 대신 seamless 재연결로 사용자 눈에 끊김이 보이지 않게 한다.
    setCamError(false);
    scheduleAutoReconnect();
  }, [clearCamTimeout, scheduleAutoReconnect]);

  const handleRetryCamera = useCallback(() => {
    clearRetryTimer();
    retryConnection(false);
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

      // 이전 MJPEG 연결 강제 해제: 빈 문자열 → 새 URL 순서로 세팅
      setCameraStream("");
      const nextUrl = cam.webrtcUrl || `${CAMERA_BASE}/Video/${cam.id}`;
      requestAnimationFrame(() => setCameraStream(nextUrl));
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
      // 모달 닫힘 시 URL을 비워 img를 DOM에서 제거 → MJPEG 연결 즉시 해제
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

  // 언마운트 보장 cleanup (컴포넌트 자체가 사라질 때)
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      if (autoReconnectRef.current) {
        clearTimeout(autoReconnectRef.current);
        autoReconnectRef.current = null;
      }
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
