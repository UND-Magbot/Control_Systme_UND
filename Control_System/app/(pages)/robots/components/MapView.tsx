"use client";
import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { RobotRowData, Camera, Floor, Video } from '@/app/type';

import styles from './RobotList.module.css';

type CombinedProps = {
    selectedRobotId: number | null;
    selectedRobot:  RobotRowData | null;
    cameras: Camera[];
    robots: RobotRowData[];
    video: Video[];
    floors: Floor[];
}

export default function CameraView({
    selectedRobotId,
    selectedRobot,
    cameras,
    robots,
    video,
    floors
}: CombinedProps) {

    const optionItems = [
        { icon: "zoom-in", label: "Zoom In", action: "in" },
        { icon: "zoom-out", label: "Zoom Out", action: "out" },
    ];

    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);

    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);

    const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    const innerRef = useRef<HTMLDivElement | null>(null);

    const handleZoomFromChild = (action: string) => {
      setScale(prev => {
        if (action === "in") return Math.min(prev + 0.2, 3);
        if (action === "out") return Math.max(prev - 0.2, 0.5);
        return 1;
      });
    };

    /* -------------------------------------------------
       FastAPI에서 로봇 좌표 받아오기
    -------------------------------------------------- */
    const [robotPos, setRobotPos] = useState({ x: 0, y: 0, yaw: 0 });

    // useEffect(() => {
    //     const loadRobotPos = () => {
    //         fetch("http://localhost:8000/robot/position")
    //             .then(res => res.json())
    //             .then(data => setRobotPos(data))
    //             .catch(() => {});
    //     };

    //     loadRobotPos();
    //     const timer = setInterval(loadRobotPos, 1000);
    //     return () => clearInterval(timer);
    // }, []);

    /* -------------------------------------------------
       mapSize 측정
    -------------------------------------------------- */
    const [mapSize, setMapSize] = useState({ w: 0, h: 0 });

    useEffect(() => {
        if (!wrapperRef.current) return;

        const update = () => {
            setMapSize({
                w: wrapperRef.current!.clientWidth,
                h: wrapperRef.current!.clientHeight,
            });
        };

        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    /* -------------------------------------------------
       world → pixel
    -------------------------------------------------- */
    const mapResolution = 0.1;
    const mapOriginX = -19.9;
    const mapOriginY = -18.4;
    const mapPixelWidth = 427;
    const mapPixelHeight = 319;

    const worldToPixel = (x: number, y: number) => {
        const px = (x - mapOriginX) / mapResolution;
        const py = (y - mapOriginY) / mapResolution;

        return {
            x: px * (mapSize.w / mapPixelWidth),
            y: mapSize.h - (py * (mapSize.h / mapPixelHeight)),
        };
    };

    const robotScreenPos = useMemo(() => {
        if (mapSize.w === 0 || mapSize.h === 0) return { x: -9999, y: -9999 };
        return worldToPixel(robotPos.x, robotPos.y);
    }, [robotPos, mapSize]);

    /* ---------------- Drag & Zoom ---------------- */
    const clampTranslate = (nx: number, ny: number) => {
        const wrap = wrapperRef.current;
        const img = imgRef.current;
        if (!wrap || !img) return { x: nx, y: ny };

        const wrapW = wrap.clientWidth;
        const wrapH = wrap.clientHeight;

        const baseW = img.clientWidth;
        const baseH = img.clientHeight;

        const scaledW = baseW * scale;
        const scaledH = baseH * scale;

        const maxOffsetX = Math.max(0, (scaledW - wrapW) / 2);
        const maxOffsetY = Math.max(0, (scaledH - wrapH) / 2);

        const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

        return {
            x: clamp(nx, -maxOffsetX, maxOffsetX),
            y: clamp(ny, -maxOffsetY, maxOffsetY),
        };
    };

    const onMouseDown = (e: React.MouseEvent) => {
        if (scale <= 1) return;

        const img = imgRef.current;
        if (!img) return;

        const rect = img.getBoundingClientRect();
        const inside =
            e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom;

        if (!inside) return;

        setIsPanning(true);
        panStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            tx: translate.x,
            ty: translate.y,
        };
    };

    const onMouseMove = (e: React.MouseEvent) => {
        if (!isPanning || !panStartRef.current) return;
        const { x, y, tx, ty } = panStartRef.current;
        const dx = e.clientX - x;
        const dy = e.clientY - y;

        const next = clampTranslate(tx + dx, ty + dy);
        setTranslate(next);
    };

    const endPan = () => {
        setIsPanning(false);
        panStartRef.current = null;
    };

    useEffect(() => {
        setTranslate(prev => clampTranslate(prev.x, prev.y));
    }, [scale]);

    /* -------------------------------------------------
       JSX
    -------------------------------------------------- */
    // const mapCurrentImage = "/map/occ_grid.png";
      const mapCurrentImage = "/map/map_test_6_800x450.png";

    return (
        <div className={styles.commonBox}>
            <div className={styles.floorBox}>1F</div>
            <div
                ref={wrapperRef}
                style={{
                    width: "100%",
                    height: "100%",
                    userSelect: "none",
                    background: "rgb(128, 128, 128)",
                    touchAction: "none",
                    cursor: scale > 1 ? (isPanning ? "grabbing" : "grab") : "default",
                }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={endPan}
                onMouseLeave={endPan}
            >
                <div
                    ref={innerRef}
                    style={{
                    width: "100%",
                    height: "100%",
                    position: "relative",
                    transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                    transformOrigin: "center center",
                    transition: isPanning ? "none" : "transform 120ms ease",
                    }}
                >
                    {/* MAP IMAGE */}
                    <img
                        ref={imgRef}
                        src={mapCurrentImage}
                        draggable={false}
                        style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        pointerEvents: "none",
                        }}
                    />

                    {/* ROBOT MARKER */}
                    <img
                        src="/icon/robot_location(1).png"
                        style={{
                        position: "absolute",
                        left: `${robotScreenPos.x}px`,
                        top: `${robotScreenPos.y}px`,
                        height: "38px",
                        transform: "translate(-50%, -50%)",
                        pointerEvents: "none",
                        zIndex: 50,
                        }}
                    />
                </div>
            </div>

            {/* Zoom Buttons */}
            <div className={styles.zoomPosition}>
                <div className={styles.zoomFlex}>
                    {optionItems.map((item, idx) => (
                        <div key={idx} className={styles.zoomBox} onClick={() => handleZoomFromChild(item.action)}>
                            <img src={`/icon/${item.icon}-w.png`} alt={item.label} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
