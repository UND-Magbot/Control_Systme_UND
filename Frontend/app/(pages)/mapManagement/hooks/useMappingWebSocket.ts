"use client";

import { useEffect, useRef, useState } from "react";
import type { MappingState } from "../types/map";

/**
 * 맵핑 진행 중에만 WebSocket에 연결해 실시간 PointCloud/Odom을 받고,
 * `<canvas>`에 더블 버퍼링으로 렌더링한다.
 *
 * - mappingState === "mappingModal" 일 때만 연결 유지
 * - 끊기면 3초 후 자동 재연결
 * - 모달이 닫히거나 컴포넌트 언마운트 시 명시적으로 close
 *
 * 반환: `<canvas>`에 붙일 ref.
 */
export function useMappingWebSocket(mappingState: MappingState) {
  const [mappingCloudPoints, setMappingCloudPoints] = useState<number[][]>([]);
  const [mappingOdom, setMappingOdom] = useState<
    { x: number; y: number; yaw: number } | null
  >(null);
  const hasReceivedData = useRef(false);
  const mappingCanvasRef = useRef<HTMLCanvasElement>(null);
  const mappingWsRef = useRef<WebSocket | null>(null);

  // WebSocket 연결/해제
  useEffect(() => {
    if (mappingState !== "mappingModal") {
      if (mappingWsRef.current) {
        mappingWsRef.current.close();
        mappingWsRef.current = null;
      }
      setMappingOdom(null);
      return;
    }

    const wsUrl =
      typeof window !== "undefined" && window.location.hostname !== "localhost"
        ? `ws://${window.location.hostname}:8000/ws/mapping/view`
        : "ws://localhost:8000/ws/mapping/view";

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      mappingWsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === "cloud") {
            hasReceivedData.current = true;
            setMappingCloudPoints(data.points || []);
          } else if (data.type === "aligned") {
            hasReceivedData.current = true;
            setMappingCloudPoints((prev) => [...prev, ...(data.points || [])]);
          } else if (data.type === "odom") {
            setMappingOdom({ x: data.x, y: data.y, yaw: data.yaw });
          }
        } catch (err) {
          console.error("WS 메시지 파싱 오류:", err);
        }
      };

      ws.onclose = () => {
        if (mappingState === "mappingModal") {
          setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      if (mappingWsRef.current) {
        mappingWsRef.current.close();
        mappingWsRef.current = null;
      }
    };
  }, [mappingState]);

  // Canvas 렌더링 (더블 버퍼링)
  useEffect(() => {
    const canvas = mappingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = canvas.parentElement;
    if (!container) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;

    const offscreen = document.createElement("canvas");
    offscreen.width = cw;
    offscreen.height = ch;
    const off = offscreen.getContext("2d")!;

    // 배경
    off.fillStyle = "#111";
    off.fillRect(0, 0, cw, ch);

    if (mappingCloudPoints.length === 0) {
      if (!hasReceivedData.current) {
        off.fillStyle = "#555";
        off.font = "15px Pretendard, sans-serif";
        off.textAlign = "center";
        off.fillText("맵 데이터 수신 대기 중...", cw / 2, ch / 2);
        canvas.width = cw;
        canvas.height = ch;
        ctx.drawImage(offscreen, 0, 0);
      }
      return;
    }

    // 포인트 클라우드 범위 계산
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const pt of mappingCloudPoints) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const margin = 40;
    const scaleX = (cw - margin * 2) / rangeX;
    const scaleY = (ch - margin * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const ox = (cw - rangeX * scale) / 2;
    const oy = (ch - rangeY * scale) / 2;

    // ROS 좌표 → Canvas 픽셀
    const toCanvas = (rx: number, ry: number) => ({
      x: ox + (rx - minX) * scale,
      y: oy + (maxY - ry) * scale,
    });

    // 포인트 클라우드 그리기
    off.fillStyle = "rgba(0, 200, 255, 0.7)";
    for (const pt of mappingCloudPoints) {
      const p = toCanvas(pt[0], pt[1]);
      off.fillRect(p.x, p.y, 2, 2);
    }

    // 로봇 위치 그리기 (빨간 삼각형)
    if (mappingOdom) {
      const rp = toCanvas(mappingOdom.x, mappingOdom.y);
      const sz = 8;
      off.save();
      off.translate(rp.x, rp.y);
      off.rotate(-mappingOdom.yaw);
      off.beginPath();
      off.moveTo(sz * 1.5, 0);
      off.lineTo(-sz, -sz);
      off.lineTo(-sz, sz);
      off.closePath();
      off.fillStyle = "rgba(255, 60, 60, 0.9)";
      off.fill();
      off.strokeStyle = "#fff";
      off.lineWidth = 1;
      off.stroke();
      off.restore();
    }

    // 완성된 프레임을 한 번에 복사
    canvas.width = cw;
    canvas.height = ch;
    ctx.drawImage(offscreen, 0, 0);
  }, [mappingCloudPoints, mappingOdom]);

  return { mappingCanvasRef };
}
