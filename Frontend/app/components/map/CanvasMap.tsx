"use client";

import { useCallback, useState, forwardRef, useImperativeHandle } from "react";
import dynamic from "next/dynamic";
import type { CanvasMapProps, POIItem } from "./types";
import { useMapCanvas } from "@/app/hooks/useMapCanvas";
import type { ZoomAction } from "@/app/utils/zoom";
import RobotMarker from "./RobotMarker";
import POIOverlay from "./POIOverlay";
import POIDetailCard from "./POIDetailCard";
import DebugTestMarker from "./DebugTestMarker";
import { useDebugMap } from "./DebugMapContext";
import styles from "./CanvasMap.module.css";

// 3D 맵 Lazy Load — Three.js 번들은 3D 전환 시 클라이언트에서만 로드
const Map3DCanvas = dynamic(() => import("@/app/components/map3d/Map3DCanvas"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", background: "#1a1d2e", display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
      3D 맵 로딩중...
    </div>
  ),
});

export type CanvasMapHandle = {
  handleZoom: (action: ZoomAction) => void;
  worldToPixelScreen: (wx: number, wy: number) => { x: number; y: number };
  pixelToWorldScreen: (px: number, py: number) => { x: number; y: number };
};

/* ============================================================
 * Inner2D — 2D 전용 훅·렌더 (Map2D/Map3D를 별도 컴포넌트로 분리해
 * 뷰 전환 시 자연스럽게 언마운트/마운트 → 캔버스 재초기화)
 * ============================================================ */
const Inner2D = forwardRef<CanvasMapHandle, CanvasMapProps>(function Inner2D(
  {
    config,
    robotPos,
    robotName,
    robots: multiRobots,
    pois,
    navPath,
    selectedPoiId,
    showRobot = false,
    robotMarkerSize,
    showPois = false,
    showPath = false,
    showLabels = true,
    onPoiClick,
    onPoiNavigate,
    onMapClick,
    onMapMouseMove,
    interactive = true,
    className,
    style,
    children,
  },
  ref
) {
  const { debugEnabled, testCoordinates } = useDebugMap();
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
  const [detailPoi, setDetailPoi] = useState<POIItem | null>(null);

  const {
    canvasRef,
    wrapperRef,
    scale,
    translate,
    isPanning,
    onMouseDown,
    onMouseMove,
    endPan,
    handleZoom,
    worldToPixelScreen,
    pixelToWorldScreen,
  } = useMapCanvas(config, showPath ? navPath : null, interactive);

  useImperativeHandle(ref, () => ({
    handleZoom,
    worldToPixelScreen,
    pixelToWorldScreen,
  }));

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) return;
      if (detailPoi) setDetailPoi(null);
      if (!onMapClick) return;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const cx = wrapper.clientWidth / 2;
      const cy = wrapper.clientHeight / 2;
      const rawX = (e.clientX - rect.left - cx - translate.x) / scale + cx;
      const rawY = (e.clientY - rect.top - cy - translate.y) / scale + cy;
      const world = pixelToWorldScreen(rawX, rawY);
      onMapClick(world);
    },
    [onMapClick, isPanning, scale, translate, pixelToWorldScreen, wrapperRef, detailPoi]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      onMouseMove(e);
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const cx = wrapper.clientWidth / 2;
      const cy = wrapper.clientHeight / 2;
      const rawX = (e.clientX - rect.left - cx - translate.x) / scale + cx;
      const rawY = (e.clientY - rect.top - cy - translate.y) / scale + cy;
      const world = pixelToWorldScreen(rawX, rawY);
      if (debugEnabled) setHoverCoord(world);
      if (onMapMouseMove) onMapMouseMove(world);
    },
    [onMouseMove, onMapMouseMove, debugEnabled, scale, translate, pixelToWorldScreen, wrapperRef]
  );

  const robotScreen = robotPos ? worldToPixelScreen(robotPos.x, robotPos.y) : null;

  const poiScreenItems = pois?.map((poi) => {
    const sp = worldToPixelScreen(poi.x, poi.y);
    return { poi, screenX: sp.x, screenY: sp.y };
  });

  const cursorStyle = interactive
    ? isPanning
      ? "grabbing"
      : scale > 1
        ? "grab"
        : "default"
    : "default";

  return (
    <div
      ref={wrapperRef}
      className={`${styles.wrapper} ${className || ""}`}
      style={{
        ...style,
        cursor: style?.cursor || cursorStyle,
      }}
      onMouseDown={onMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endPan}
      onMouseLeave={endPan}
      onClick={handleClick}
    >
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: isPanning ? "none" : "transform 120ms ease",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", pointerEvents: "none" }}
        />

        {/* 다중 로봇 */}
        {multiRobots && multiRobots.map((r) => {
          const sp = worldToPixelScreen(r.position.x, r.position.y);
          return (
            <RobotMarker key={r.id} screenX={sp.x} screenY={sp.y} yaw={r.position.yaw} name={r.name} size={robotMarkerSize} scale={scale} />
          );
        })}

        {/* 단일 로봇 (하위 호환) */}
        {!multiRobots && showRobot && robotScreen && (
          <RobotMarker screenX={robotScreen.x} screenY={robotScreen.y} yaw={robotPos?.yaw} name={robotName} size={robotMarkerSize} scale={scale} />
        )}

        {showPois && poiScreenItems && (
          <POIOverlay
            items={poiScreenItems}
            showLabels={showLabels}
            selectedId={selectedPoiId}
            onItemClick={(poi) => {
              setDetailPoi((prev) => (prev?.id === poi.id ? null : poi));
              onPoiClick?.(poi);
            }}
            scale={scale}
          />
        )}

        {/* Debug test markers */}
        {debugEnabled &&
          testCoordinates.map((coord, i) => {
            const sp = worldToPixelScreen(coord.x, coord.y);
            return (
              <DebugTestMarker
                key={i}
                screenX={sp.x}
                screenY={sp.y}
                label={coord.label || `(${coord.x}, ${coord.y})`}
              />
            );
          })}

        {children}
      </div>

      {/* POI 상세 카드 (zoom 바깥 — 항상 고정 크기) */}
      {detailPoi && (() => {
        const sp = worldToPixelScreen(detailPoi.x, detailPoi.y);
        const wrapper = wrapperRef.current;
        const cx = wrapper ? wrapper.clientWidth / 2 : 0;
        const cy = wrapper ? wrapper.clientHeight / 2 : 0;
        const screenX = (sp.x - cx) * scale + cx + translate.x;
        const screenY = (sp.y - cy) * scale + cy + translate.y;
        return (
          <POIDetailCard
            poi={detailPoi}
            screenX={screenX}
            screenY={screenY}
            onClose={() => setDetailPoi(null)}
            onNavigate={onPoiNavigate}
          />
        );
      })()}

      {/* Debug coordinate readout */}
      {debugEnabled && hoverCoord && (
        <div
          style={{
            position: "absolute",
            bottom: 4,
            left: 4,
            background: "rgba(0,0,0,0.75)",
            color: "#0f0",
            padding: "2px 8px",
            fontSize: 11,
            zIndex: 100,
            pointerEvents: "none",
            borderRadius: 3,
            fontFamily: "monospace",
          }}
        >
          x: {hoverCoord.x.toFixed(2)}, y: {hoverCoord.y.toFixed(2)}
        </div>
      )}
    </div>
  );
});

/* ============================================================
 * Inner3D — 3D 전용 훅·렌더
 * ============================================================ */
const Inner3D = forwardRef<CanvasMapHandle, CanvasMapProps>(function Inner3D(
  {
    config,
    robotPos,
    robotName,
    robots: multiRobots,
    pois,
    navPath,
    selectedPoiId,
    showRobot = false,
    showPois = false,
    showPath = false,
    showLabels = true,
    onPoiClick,
    onPoiNavigate,
    className,
    style,
  },
  ref
) {
  const [detailPoi3D, setDetailPoi3D] = useState<POIItem | null>(null);

  const firstMultiRobot = multiRobots && multiRobots.length > 0 ? multiRobots[0] : null;
  const effectiveRobotPos = robotPos ?? firstMultiRobot?.position ?? null;
  const effectiveRobotName = robotName ?? firstMultiRobot?.name;
  const effectiveShowRobot = showRobot || !!firstMultiRobot;

  const handle3DPoiClick = (poi: POIItem) => {
    setDetailPoi3D((prev) => (prev?.id === poi.id ? null : poi));
    onPoiClick?.(poi);
  };

  return (
    <div className={`${styles.wrapper} ${className || ""}`} style={style}>
      <Map3DCanvas
        ref={ref}
        config={config}
        robotPos={effectiveRobotPos}
        robotName={effectiveRobotName}
        pois={pois}
        navPath={navPath}
        selectedPoiId={selectedPoiId}
        showRobot={effectiveShowRobot}
        showPois={showPois}
        showPath={showPath}
        showLabels={showLabels}
        onPoiClick={handle3DPoiClick}
      />
      {detailPoi3D && (
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 20 }}>
          <POIDetailCard
            poi={detailPoi3D}
            anchored
            onClose={() => setDetailPoi3D(null)}
            onNavigate={onPoiNavigate}
          />
        </div>
      )}
    </div>
  );
});

/* ============================================================
 * CanvasMap — 뷰 모드에 따라 Inner2D / Inner3D 중 하나만 마운트
 * ============================================================ */
const CanvasMap = forwardRef<CanvasMapHandle, CanvasMapProps>(function CanvasMap(
  props,
  ref
) {
  if (props.view === "3d") {
    return <Inner3D {...props} ref={ref} />;
  }
  return <Inner2D {...props} ref={ref} />;
});

export default CanvasMap;
