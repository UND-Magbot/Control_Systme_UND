'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Camera } from '@/app/types';
import { CAMERA_BASE } from '@/app/config';
import { createThermalFrameSink, type ThermalFrameSink } from '@/app/components/camera/thermalFrameSink';

const CAM_TIMEOUT_MS = 10_000;
// 재연결 레이트 리미터 — 고정 주기(구 5초 setInterval)는 로봇 두절·전시장 망 불량에서
// 무한 재시도로 이어져 과부하가 된다. 백엔드 _CameraStream(camera.py:29-33)과 같은
// 지수 백오프 규약을 쓰고, 연속 실패가 상한을 넘으면 자동 재시도를 끊는다(브레이커).
// 이후 재시도는 사용자의 '다시 시도' 버튼 또는 카메라 탭 전환으로만 일어난다.
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_FACTOR = 1.8;
const BREAKER_THRESHOLD = 5;
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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 다음 재시도까지의 대기(ms)와 연속 실패 횟수 — 성공/수동 재시도 시 초기화한다.
  const backoffRef = useRef(BACKOFF_MIN_MS);
  const retryCountRef = useRef(0);
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
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // 백오프·브레이커 초기화 — 연결 성공 또는 사용자의 명시적 재시도에서만 호출한다.
  const resetBackoff = useCallback(() => {
    backoffRef.current = BACKOFF_MIN_MS;
    retryCountRef.current = 0;
  }, []);

  // 연결 성공 시 공통 처리
  const onConnectSuccess = useCallback(() => {
    clearCamTimeout();
    clearRetryTimer();
    errorCountRef.current = 0;
    resetBackoff();
    setIsCamLoading(false);
    setCamError(false);
  }, [clearCamTimeout, clearRetryTimer, resetBackoff]);

  // 재시도 스케줄러 (열화상 WS / MJPEG 공용) — 지수 백오프 + 브레이커.
  // 보류 사유(로봇 통신 끊김·백그라운드 탭)는 실패가 아니므로 백오프·실패횟수를 올리지 않고
  // 같은 간격으로 다시 확인한다. 실제 시도를 한 경우에만 간격을 늘리고 횟수를 센다.
  const scheduleRetryRef = useRef<(action: () => void) => void>(() => {});
  const scheduleRetry = useCallback((action: () => void) => {
    clearRetryTimer();
    // 브레이커 개방 — 자동 재시도를 끊는다. 이후엔 '다시 시도' 버튼/탭 전환으로만 재개.
    if (retryCountRef.current >= BREAKER_THRESHOLD) return;

    const delay = backoffRef.current;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (unmountedRef.current) return;
      if (!enabledRef.current || document.hidden) {
        scheduleRetryRef.current(action);
        return;
      }
      backoffRef.current = Math.min(delay * BACKOFF_FACTOR, BACKOFF_MAX_MS);
      retryCountRef.current += 1;
      action();
    }, delay);
  }, [clearRetryTimer]);

  useEffect(() => { scheduleRetryRef.current = scheduleRetry; }, [scheduleRetry]);

  const startRetryTimer = useCallback(() => {
    scheduleRetry(() => {
      const cam = camera.find((c) => c.id === (selectedCam ?? activeCam)) ?? camera[0];
      if (!cam) return;

      setIsCamLoading(true);
      setCamError(false);

      const url = cam.webrtcUrl || `${CAMERA_BASE}/Video/${cam.id}`;
      const nextUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
      setCameraStream("");
      requestAnimationFrame(() => setCameraStream(nextUrl));
    });
  }, [scheduleRetry, camera, selectedCam, activeCam]);

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

  // 열화상 실패/멈춤 → 재연결(≤2회 조용히) 또는 에러 UI + 백오프 재시도
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
    setIsCamLoading(false);
    setCamError(true);
    scheduleRetry(() => connectThermalRef.current(cam, true));
  }, [clearCamTimeout, clearRetryTimer, scheduleRetry]);

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

  // 사용자의 명시적 재시도 — 브레이커가 열린 뒤 유일한 복구 수단이므로
  // 백오프·실패횟수를 초기화하고, 열화상은 WS 재연결로 분기한다(MJPEG 경로로는 복구 불가).
  const handleRetryCamera = useCallback(() => {
    clearRetryTimer();
    resetBackoff();
    errorCountRef.current = 0;
    const cam = camera.find((c) => c.id === (selectedCam ?? activeCam)) ?? camera[0];
    if (cam && cam.streamType === "ws") {
      connectThermal(cam);
      return;
    }
    retryConnection();
  }, [clearRetryTimer, resetBackoff, camera, selectedCam, activeCam, connectThermal, retryConnection]);

  // --- 카메라 탭 전환 ---
  const handleCameraTab = useCallback(
    (idx: number, cam: Camera) => {
      userTouchedRef.current = true;
      closeThermalWS();
      clearCamTimeout();
      clearRetryTimer();
      errorCountRef.current = 0;
      resetBackoff();
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
    [clearCamTimeout, clearRetryTimer, closeThermalWS, startCamTimeoutInner, connectThermal, resetBackoff],
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
    resetBackoff();
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
