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

const CanvasMap = forwardRef<CanvasMapHandle, CanvasMapProps>(function CanvasMap(
  {
    config,
    view = "2d",
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
  // 3D 뷰 분기
  if (view === "3d") {
    return (
      <Map3DCanvas
        ref={ref}
        config={config}
        robotPos={robotPos}
        robotName={robotName}
        pois={pois}
        navPath={navPath}
        selectedPoiId={selectedPoiId}
        showRobot={showRobot}
        showPois={showPois}
        showPath={showPath}
        showLabels={showLabels}
        onPoiClick={onPoiClick}
        className={className}
        style={style}
      />
    );
  }
  const { debugEnabled, testCoordinates } = useDebugMap();

  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(
    null
  );
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

  // 맵 클릭 → world 좌표 전달 + 상세카드 닫기
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) return;

      // 상세카드 열려있으면 닫기
      if (detailPoi) {
        setDetailPoi(null);
      }

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

  // 맵 위 마우스 이동 → world 좌표 전달
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

  // 로봇 화면 좌표
  const robotScreen = robotPos
    ? worldToPixelScreen(robotPos.x, robotPos.y)
    : null;

  // POI 화면 좌표
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

export default CanvasMap;
