'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { Camera } from '@/app/types';
import { CanvasMap } from '@/app/components/map';
import WebRTCPlayer from '@/app/components/camera/WebRTCPlayer';
import { getOccGridConfig } from '@/app/components/map/mapConfigs';
import type { RobotPosition, MapConfig } from '@/app/components/map/types';
import { apiFetch } from '@/app/lib/api';
import styles from './ViewportArea.module.css';

type ViewportAreaProps = {
  // camera stream
  isCamLoading: boolean;
  camError: boolean;
  cameraStream: string;
  retryKey: number;
  cameraTabActiveIndex: number;
  camera: Camera[];
  onRetryCamera: () => void;
  onCameraTab: (idx: number, cam: Camera) => void;
  onCamImgLoad: () => void;
  onCamImgError: () => void;
  // map
  robotPos: RobotPosition;
  robotConnected: boolean;
  mapConfig?: MapConfig | null;
  // disconnect overlay
  isDisconnected: boolean;
};

export default function ViewportArea({
  isCamLoading,
  camError,
  cameraStream,
  retryKey,
  cameraTabActiveIndex,
  camera,
  onRetryCamera,
  onCameraTab,
  onCamImgLoad,
  onCamImgError,
  robotPos,
  robotConnected,
  mapConfig,
  isDisconnected,
}: ViewportAreaProps) {
  // 로봇 현재 층 맵이 로드되면 그것을, 아직 없으면 고정 맵으로 폴백
  const resolvedMapConfig = mapConfig ?? getOccGridConfig();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const cameraImgRef = useRef<HTMLImageElement | null>(null);

  // unmount 시 img DOM 노드의 src를 직접 비워 MJPEG 연결을 즉시 해제
  // (모달 닫힘/페이지 이탈 시 좀비 연결이 브라우저에 남는 것을 방지)
  useEffect(() => {
    return () => {
      if (cameraImgRef.current) {
        try {
          cameraImgRef.current.src = "";
          cameraImgRef.current.removeAttribute("src");
        } catch {}
      }
    };
  }, []);

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  // 맵 상태: 'icon' | 'pip' | 'expanded'
  type MapViewState = 'icon' | 'pip' | 'expanded';
  const [mapState, setMapState] = useState<MapViewState>('pip');

  const isOverlayReady = !isCamLoading || camError;

  // --- zoom/pan ---
  const clampTranslate = useCallback(
    (nx: number, ny: number) => {
      const wrap = wrapperRef.current;
      const img = cameraImgRef.current;
      if (!wrap || !img) return { x: nx, y: ny };
      const maxOffsetX = Math.max(0, (img.clientWidth * scale - wrap.clientWidth) / 2);
      const maxOffsetY = Math.max(0, (img.clientHeight * scale - wrap.clientHeight) / 2);
      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
      return { x: clamp(nx, -maxOffsetX, maxOffsetX), y: clamp(ny, -maxOffsetY, maxOffsetY) };
    },
    [scale],
  );

  // wheel zoom (passive: false로 등록해야 preventDefault 가능)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setScale((prev) => {
        const next = prev + (e.deltaY < 0 ? 0.2 : -0.2);
        return Math.min(Math.max(next, 1), 4);
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale <= 1) return;
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
    },
    [scale, translate],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning || !panStartRef.current) return;
      const { x, y, tx, ty } = panStartRef.current;
      setTranslate(clampTranslate(tx + (e.clientX - x), ty + (e.clientY - y)));
    },
    [isPanning, clampTranslate],
  );

  const endPan = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const handleResetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // --- 카메라 PTZ 줌 (열화상만, 단발 클릭) ---
  const activeCam: Camera | undefined = camera[cameraTabActiveIndex];
  const isPtzCapable = activeCam?.streamType === 'http';
  // RTSP 카메라는 MediaMTX WebRTC(WebRTCPlayer)로 저지연 송출
  const isWebrtcCam = !!activeCam && (activeCam.streamType ?? 'rtsp') === 'rtsp';

  // --- 카메라 토글 시 WebRTCPlayer 짧은 unmount → mount ---
  // 이전 PC가 완전히 close되고 mediamtx에서 ICE 자원이 정리되기 전에 새 PC가
  // 같은 단일 UDP(:8189)에 끼어들면 두 번째 ICE가 connectivity check를 놓치는
  // race가 있어, 토글 직후 ~300ms 인스턴스를 비워둔 뒤 새로 mount한다.
  const [playerOff, setPlayerOff] = useState(false);
  const [playerNonce, setPlayerNonce] = useState(0);
  const prevCamIdRef = useRef<number | undefined>(activeCam?.id);
  useEffect(() => {
    const prev = prevCamIdRef.current;
    const next = activeCam?.id;
    if (prev !== undefined && next !== undefined && prev !== next) {
      setPlayerOff(true);
      const t = setTimeout(() => {
        setPlayerOff(false);
        setPlayerNonce((n) => n + 1);
      }, 300);
      prevCamIdRef.current = next;
      return () => clearTimeout(t);
    }
    prevCamIdRef.current = next;
  }, [activeCam?.id]);

  const handlePtzZoom = useCallback(
    async (action: 'zoom_in' | 'zoom_out') => {
      if (!activeCam) {
        console.warn('[PTZ] activeCam 없음');
        return;
      }
      console.debug(`[PTZ] ${action} → /Video/${activeCam.id}/ptz`, activeCam);
      try {
        const res = await apiFetch(`/Video/${activeCam.id}/ptz?action=${action}`, { method: 'POST' });
        if (!res.ok) {
          console.warn(`[PTZ] ${action} HTTP ${res.status}`, await res.text().catch(() => ''));
        } else {
          console.debug(`[PTZ] ${action} ok`);
        }
      } catch (e) {
        console.warn(`[PTZ] ${action} 네트워크 오류`, e);
      }
    },
    [activeCam],
  );

  // --- camera img style ---
  // 모든 카메라를 16:9 컨테이너에 fill로 늘려 꽉 채움 (잘림·검은 여백 없음, 비율 왜곡 허용).
  const camImgStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'fill',
    position: 'absolute',
    top: 0,
    left: 0,
    transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
    cursor: scale > 1 ? (isPanning ? 'grabbing' : 'grab') : undefined,
  };

  return (
    <div className={styles.viewport}>
      {/* ── 카메라 탭 (전방 우선 정렬) ── */}
      {isOverlayReady && camera.length > 1 && (
        <div className={styles.camTabs}>
          {[...camera].sort((a, b) => {
            // 전방(front)을 앞으로, 열화상(ws)을 뒤로
            const order = (c: typeof a) => {
              const l = c.label.toLowerCase();
              if (l.includes('전방') || l.includes('front')) return 0;
              if (l.includes('후방') || l.includes('rear')) return 1;
              return 2;
            };
            return order(a) - order(b);
          }).map((cam) => {
            const origIdx = camera.findIndex((c) => c.id === cam.id);
            return (
              <button
                key={cam.id}
                type="button"
                className={`${styles.camTab} ${cameraTabActiveIndex === origIdx ? styles.camTabActive : ''}`}
                onClick={() => onCameraTab(origIdx, cam)}
              >
                {cam.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── 메인 카메라 뷰 ── */}
      <div
        ref={wrapperRef}
        className={styles.mainView}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
      >
        {/* 카메라 로딩 (MJPEG 경로 전용 — WebRTC는 WebRTCPlayer가 자체 표시) */}
        {!isWebrtcCam && isCamLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner} />
            <span>카메라 연결 중...</span>
          </div>
        )}

        {/* 카메라 에러 (MJPEG 경로 전용) */}
        {!isWebrtcCam && camError && (
          <div className={styles.errorOverlay}>
            <span className={styles.errorTitle}>카메라 연결 실패</span>
            <span className={styles.errorDesc}>카메라 스트림에 연결할 수 없습니다</span>
            <button type="button" className={styles.retryBtn} onClick={onRetryCamera}>
              다시 시도
            </button>
          </div>
        )}

        {/* 카메라 메인 — RTSP는 WebRTC 저지연, 그 외(열화상·외부 MJPEG)는 <img> */}
        {/* 카메라 토글 시 playerOff=true로 잠시 unmount → 300ms 후 새 nonce로 mount.
            이전 PC가 close + DELETE 완료된 뒤 새 PC가 시작되어 ICE 충돌을 피한다. */}
        {isWebrtcCam && activeCam && !playerOff ? (
          <WebRTCPlayer key={playerNonce} whepUrl={activeCam.webrtcUrl} videoStyle={camImgStyle} />
        ) : cameraStream ? (
          <img
            ref={cameraImgRef}
            key={retryKey}
            src={cameraStream}
            draggable={false}
            onLoad={onCamImgLoad}
            onError={onCamImgError}
            style={camImgStyle}
            alt="camera"
          />
        ) : null}
      </div>

      {/* ── 줌 리셋 ── */}
      {isOverlayReady && (
        <button
          type="button"
          className={styles.zoomResetBtn}
          onClick={handleResetZoom}
          title="되돌리기"
        >
          <span>↻</span>
        </button>
      )}

      {/* ── 카메라 PTZ 줌 (열화상만) ── */}
      {isOverlayReady && isPtzCapable && (
        <div className={styles.ptzZoomGroup}>
          <button
            type="button"
            className={styles.ptzZoomBtn}
            onClick={() => handlePtzZoom('zoom_in')}
            title="카메라 줌 인"
          >
            <span>+</span>
          </button>
          <button
            type="button"
            className={styles.ptzZoomBtn}
            onClick={() => handlePtzZoom('zoom_out')}
            title="카메라 줌 아웃"
          >
            <span>−</span>
          </button>
        </div>
      )}

      {/* 녹화 버튼은 StatusBar로 이동 */}

      {/* ── 맵: icon / pip / expanded ── */}
      {mapState === 'icon' && (
        <button
          type="button"
          className={styles.mapIconBtn}
          onClick={() => setMapState('pip')}
          title="맵 열기"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/>
            <path d="M8 2v16"/>
            <path d="M16 6v16"/>
          </svg>
        </button>
      )}

      {mapState === 'pip' && (
        <div className={styles.pip}>
          {/* 상단 우측: 최소화 + 확대 */}
          <div className={styles.pipActions}>
            <button
              type="button"
              className={styles.pipActionBtn}
              onClick={(e) => { e.stopPropagation(); setMapState('icon'); }}
              title="최소화"
            >
              —
            </button>
            <button
              type="button"
              className={styles.pipActionBtn}
              onClick={(e) => { e.stopPropagation(); setMapState('expanded'); }}
              title="확대"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>
              </svg>
            </button>
          </div>

          {/* 맵 영역 */}
          <div className={styles.pipMapArea} onClick={() => setMapState('expanded')}>
            <CanvasMap
              key={resolvedMapConfig.imageSrc}
              config={resolvedMapConfig}
              robotPos={robotPos}
              showRobot={robotConnected}
              robotMarkerSize={14}
              interactive={false}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            />
          </div>
        </div>
      )}

      {mapState === 'expanded' && (
        <div className={styles.pipExpanded}>
          <CanvasMap
            key={resolvedMapConfig.imageSrc}
            config={resolvedMapConfig}
            robotPos={robotPos}
            showRobot={robotConnected}
            robotMarkerSize={20}
            interactive
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          />
          {/* 축소 (우상단) */}
          <button
            type="button"
            className={styles.mapCollapseBtn}
            onClick={() => setMapState('pip')}
            title="축소"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 연결 끊김 오버레이 ── */}
      {isDisconnected && (
        <div className={styles.disconnectOverlay}>
          <div className={styles.disconnectContent}>
            <span className={styles.disconnectTitle}>로봇 연결이 끊어졌습니다</span>
            <span className={styles.disconnectDesc}>재연결 시도 중...</span>
          </div>
        </div>
      )}
    </div>
  );
}
