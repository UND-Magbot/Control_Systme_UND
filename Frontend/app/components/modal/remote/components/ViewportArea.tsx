'use client';

import React, { useRef, useState, useCallback } from 'react';
import type { Camera } from '@/app/type';
import { CanvasMap } from '@/app/components/map';
import { OCC_GRID_CONFIG } from '@/app/components/map/mapConfigs';
import type { RobotPosition } from '@/app/components/map/types';
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
  isDisconnected,
}: ViewportAreaProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const cameraImgRef = useRef<HTMLImageElement | null>(null);

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

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      setScale((prev) => {
        const next = prev + (e.deltaY < 0 ? 0.2 : -0.2);
        return Math.min(Math.max(next, 1), 4);
      });
    },
    [],
  );

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

  // --- camera img style ---
  const camImgStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
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
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
      >
        {/* 카메라 로딩 */}
        {isCamLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner} />
            <span>카메라 연결 중...</span>
          </div>
        )}

        {/* 카메라 에러 */}
        {camError && (
          <div className={styles.errorOverlay}>
            <span className={styles.errorTitle}>카메라 연결 실패</span>
            <span className={styles.errorDesc}>카메라 스트림에 연결할 수 없습니다</span>
            <button type="button" className={styles.retryBtn} onClick={onRetryCamera}>
              다시 시도
            </button>
          </div>
        )}

        {/* 카메라 이미지 (항상 메인) */}
        {cameraStream && (
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
        )}
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
              config={OCC_GRID_CONFIG}
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
            config={OCC_GRID_CONFIG}
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
