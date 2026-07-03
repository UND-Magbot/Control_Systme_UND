"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CanvasMap from "@/app/components/map/CanvasMap";
import type { MapConfig } from "@/app/components/map/types";
import { apiFetch } from "@/app/lib/api";

/**
 * 위치 재조정(스캔 정합) — rviz 2D Pose Estimate 를 관제 화면 안에서 수행.
 *
 * 흐름:
 *   1. 열리면 스캔 스트림 준비(POST /robot/relocalize/stream/start) + WS 연결
 *      → 로봇 정합 스캔(/LOC_BODY_POINTS)이 저장맵 위에 주황점으로 겹쳐 표시된다.
 *      (스캔이 벽과 어긋나면 = 로봇 측위가 틀어진 것 = 재조정 대상)
 *   2. 운영자가 맵에서 로봇 실제 위치를 클릭(①) → 방향을 향해 다시 클릭(②) 하여 pose 지정.
 *   3. '적용' → POST /robot/initpose {x,y,yaw} 로 주입 → 로봇이 그 시드로 scan-match 수렴.
 *      스캔이 벽과 맞을 때까지 ②~③ 반복. 수렴 성공 시 미확정(자율주행 보류)이 해제된다.
 */

type Props = {
  open: boolean;
  mapConfig: MapConfig | null;
  robotId?: number;
  robotName?: string;
  onClose: () => void;
  /** '적용'이 수렴 성공(위치 확정)으로 끝났을 때 호출(알림 읽음·위치 재조회 등). */
  onConfirmed?: () => void;
};

type PoseStage = "idle" | "aiming" | "set";
type ApplyResult = { ok: boolean; msg: string } | null;

function wsBase(): string {
  if (typeof window === "undefined") return "ws://localhost:8010";
  const h = window.location.hostname;
  return h !== "localhost" ? `ws://${h}:8010` : "ws://localhost:8010";
}

export default function RelocalizeModal({
  open,
  mapConfig,
  robotId,
  robotName,
  onClose,
  onConfirmed,
}: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  // 원시 스캔 점군 + 프레임. body=로봇 기준(pose 로 변환 필요), map=이미 map 프레임.
  const [rawScan, setRawScan] = useState<number[][]>([]);
  const [scanFrame, setScanFrame] = useState<"body" | "map">("body");
  const [liveOdom, setLiveOdom] = useState<{ x: number; y: number; yaw: number } | null>(null);
  const [scanConnected, setScanConnected] = useState(false);
  const [streamMsg, setStreamMsg] = useState<string | null>(null);
  const [noData, setNoData] = useState(false);
  const gotDataRef = useRef(false);

  const [stage, setStage] = useState<PoseStage>("idle");
  const [posePoint, setPosePoint] = useState<{ x: number; y: number } | null>(null);
  const [poseYaw, setPoseYaw] = useState(0);
  const [applying, setApplying] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [result, setResult] = useState<ApplyResult>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const poseYawRef = useRef(0);
  const [poseTo, setPoseTo] = useState<{ x: number; y: number } | null>(null);

  // ── 스캔 스트림: 스트림 준비 + WS 연결(정합 스캔은 프레임마다 교체) ──
  useEffect(() => {
    if (!open) return;
    let closed = false;
    gotDataRef.current = false;
    setNoData(false);
    setStreamMsg(null);

    // 스캔 스트림 준비(로봇 relay_map 기동). 실패 사유를 화면에 표시해 진단을 돕는다.
    apiFetch("/robot/relocalize/stream/start", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.status !== "ok") {
          setStreamMsg(d?.msg ?? "스캔 스트림 준비에 실패했습니다(relay 기동 실패).");
        }
      })
      .catch(() => setStreamMsg("스캔 스트림 준비 요청이 실패했습니다(네트워크/SSH)."));

    // 일정 시간 내 스캔·pose 데이터가 하나도 안 오면 '토픽 미수신'으로 안내.
    const noDataTimer = setTimeout(() => {
      if (!gotDataRef.current) setNoData(true);
    }, 6000);

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(`${wsBase()}/ws/relocalize/view`);
      wsRef.current = ws;
      ws.onopen = () => setScanConnected(true);
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          // 로봇 pose 는 POSITION 폴링(아래 effect). WS 는 스캔만 사용.
          //  - type=body(/LOC_BODY_POINTS): 로봇 프레임 → pose 로 map 변환해 오버레이.
          //  - type=aligned: 이미 map 프레임 → 그대로.
          if (d.type === "body") {
            gotDataRef.current = true;
            setNoData(false);
            setScanFrame("body");
            setRawScan(d.points || []);
          } else if (d.type === "aligned") {
            gotDataRef.current = true;
            setNoData(false);
            setScanFrame("map");
            setRawScan(d.points || []);
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        setScanConnected(false);
        if (!closed) setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(noDataTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      apiFetch("/robot/relocalize/stream/stop", { method: "POST" }).catch(() => {});
      setRawScan([]);
      setLiveOdom(null);
      setScanConnected(false);
      setStreamMsg(null);
      setNoData(false);
      setStage("idle");
      setPosePoint(null);
      setResult(null);
    };
  }, [open]);

  // ── 로봇 위치: POSITION(ASDU) 폴링 — 측위 모드에서도 동작(relay_map/SLAM 토픽과 무관) ──
  useEffect(() => {
    if (!open) return;
    let stop = false;
    const poll = async () => {
      try {
        const path = robotId != null ? `/robot/position?robot_id=${robotId}` : "/robot/position";
        const res = await apiFetch(path);
        if (!res.ok) return;
        const d = await res.json();
        if (!stop && typeof d?.x === "number" && d?.timestamp) {
          setLiveOdom({ x: d.x, y: d.y, yaw: Number(d.yaw ?? 0) });
        }
      } catch {
        /* 폴링 실패는 무시(다음 주기 재시도) */
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [open, robotId]);

  // ── rviz식 pose 드래그: 누른 지점=위치, 끌기=방향(초록 화살표가 드래그만큼 늘어남), 뗌=즉시 주입 ──
  const handlePoseStart = useCallback((w: { x: number; y: number }) => {
    setResult(null);
    dragStartRef.current = { x: w.x, y: w.y };
    poseYawRef.current = 0;
    setPosePoint({ x: w.x, y: w.y });
    setPoseTo({ x: w.x, y: w.y });
    setPoseYaw(0);
    setStage("aiming");
  }, []);

  const handlePoseDrag = useCallback((w: { x: number; y: number }) => {
    const s = dragStartRef.current;
    if (!s) return;
    const yaw = Math.atan2(w.y - s.y, w.x - s.x);
    poseYawRef.current = yaw;
    setPoseYaw(yaw);
    setPoseTo({ x: w.x, y: w.y });
  }, []);

  const resetPose = () => {
    dragStartRef.current = null;
    setPosePoint(null);
    setPoseTo(null);
    setStage("idle");
    setResult(null);
  };

  // 지정한 pose 를 로봇에 주입(시드). 수렴 여부(벗어남 등)는 스캔으로 눈으로 확인하므로
  // 실패성 문구를 띄우지 않는다(주입 전송 성공/실패만 표시). 확정은 '완료'가 담당.
  const applyPose = useCallback(
    async (pt: { x: number; y: number }, yaw: number) => {
      if (completing) return;
      setApplying(true);
      setResult(null);
      try {
        const res = await apiFetch("/robot/initpose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: pt.x, y: pt.y, yaw, robot_id: robotId ?? null }),
          timeoutMs: 20000,
        });
        const data = await res.json().catch(() => null);
        const sent = res.ok && data?.status !== "error" && data?.status !== "disabled";
        setResult({
          ok: sent,
          msg: sent
            ? "위치를 주입했습니다. 주황 스캔이 벽과 정렬됐는지 확인하고, 맞으면 '완료'를 누르세요."
            : (data?.msg ?? "주입 요청이 실패했습니다."),
        });
      } catch {
        setResult({ ok: false, msg: "주입 요청이 실패했습니다. 네트워크를 확인하세요." });
      } finally {
        setApplying(false);
        // 재조정 반복할 수 있도록 pose 초기화(다시 드래그 유도).
        dragStartRef.current = null;
        setStage("idle");
        setPosePoint(null);
        setPoseTo(null);
      }
    },
    [completing, robotId]
  );

  // 놓으면(드래그 종료) 그 위치·방향으로 즉시 주입 — 별도 '적용' 버튼 없이 (예전 '적용' 버튼 동작).
  const handlePoseEnd = useCallback(() => {
    const s = dragStartRef.current;
    if (!s) return;
    setStage("set");
    void applyPose({ x: s.x, y: s.y }, poseYawRef.current);
  }, [applyPose]);

  // '완료' = 운영자가 스캔 정렬을 눈으로 확인하고 확정. 현재 로봇 위치로 미확정 해제 후 닫는다.
  // (자동 수렴검사와 무관 — 운영자의 시각 확인이 곧 확정.)
  const handleComplete = async () => {
    if (applying || completing) return;
    setCompleting(true);
    setResult(null);
    try {
      const path =
        robotId != null
          ? `/robot/initpose/confirm-current?robot_id=${robotId}`
          : `/robot/initpose/confirm-current`;
      const res = await apiFetch(path, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.confirmed) {
        onConfirmed?.();
        onClose();
      } else {
        setResult({
          ok: false,
          msg: data?.msg ?? "완료 처리에 실패했습니다. 로봇 현재 위치 수신을 확인하세요.",
        });
        setCompleting(false);
      }
    } catch {
      setResult({ ok: false, msg: "완료 요청이 실패했습니다. 네트워크를 확인하세요." });
      setCompleting(false);
    }
  };

  // 오버레이용 스캔(월드/map 프레임). body 스캔이면 로봇 pose 로 회전·평행이동해 map 에 얹는다
  // (rviz 가 /tf 로 하는 변환과 동일: mapX = rx + bx·cosθ − by·sinθ, mapY = ry + bx·sinθ + by·cosθ).
  // 측위가 틀어져 있으면 pose 도 틀어져 스캔이 벽과 어긋나 보이며, 그 어긋남이 곧 재조정 대상이다.
  const scanPoints = useMemo<number[][]>(() => {
    if (rawScan.length === 0) return [];
    if (scanFrame === "map") return rawScan;
    if (!liveOdom) return []; // body 스캔인데 pose 미수신 → 변환 불가
    const c = Math.cos(liveOdom.yaw);
    const s = Math.sin(liveOdom.yaw);
    const { x: rx, y: ry } = liveOdom;
    const out: number[][] = new Array(rawScan.length);
    for (let i = 0; i < rawScan.length; i++) {
      const bx = rawScan[i][0];
      const by = rawScan[i][1];
      out[i] = [rx + bx * c - by * s, ry + bx * s + by * c];
    }
    return out;
  }, [rawScan, scanFrame, liveOdom]);

  if (!open) return null;

  const stageText = applying
    ? "위치 주입 중..."
    : stage === "aiming"
      ? "방향으로 끌고 있습니다 — 놓으면 그 위치·방향으로 즉시 주입됩니다."
      : "로봇 실제 위치를 누른 채 바라보는 방향으로 끌어서 놓으면 그 위치로 주입됩니다. 주황 스캔이 벽과 맞으면 '완료', 어긋나면 다시 드래그하세요.";

  return (
    <div style={overlayStyle} onClick={applying ? undefined : onClose}>
      <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={titleStyle}>위치 재조정 (스캔 정합)</div>
            <div style={subtitleStyle}>
              {robotName ? `${robotName} · ` : ""}
              맵의 벽과 로봇 스캔(주황점)을 맞춰 실제 위치를 지정합니다.
            </div>
          </div>
          <button style={closeBtnStyle} onClick={onClose} disabled={applying} aria-label="닫기">
            ✕
          </button>
        </div>

        <div style={mapWrapStyle}>
          {mapConfig ? (
            <CanvasMap
              config={mapConfig}
              robotPos={liveOdom}
              robotName={robotName}
              showRobot={!!liveOdom}
              robotMarkerSize={16}
              scanPoints={scanPoints}
              poseArrow={posePoint ? { x: posePoint.x, y: posePoint.y, yaw: poseYaw, toX: poseTo?.x, toY: poseTo?.y } : null}
              poseDrawMode
              onPoseDragStart={handlePoseStart}
              onPoseDrag={handlePoseDrag}
              onPoseDragEnd={handlePoseEnd}
              style={{ cursor: "crosshair" }}
            />
          ) : (
            <div style={loadingStyle}>
              지도를 불러오는 중입니다...
              <br />
              (표시되지 않으면 맵 관리 상단에서 맵이 선택돼 있는지 확인하세요)
            </div>
          )}

          {/* 스캔 상태 뱃지 */}
          <div style={badgeStyle}>
            <span
              style={{
                ...dotStyle,
                background: scanConnected && scanPoints.length > 0 ? "#22c55e" : "#f59e0b",
              }}
            />
            {scanConnected
              ? scanPoints.length > 0
                ? `스캔 수신 중 · ${scanPoints.length}점`
                : "스캔 수신 대기 중..."
              : "스캔 연결 중..."}
          </div>
        </div>

        {(streamMsg || noData) && (
          <div style={warnStyle} role="alert">
            <b>정합 스캔 오버레이를 사용할 수 없습니다(주황점 없음).</b>
            {streamMsg ? ` (${streamMsg})` : ""}
            <br />
            로봇 위치와 드래그 지정·주입은 정상 동작합니다. 스캔 정합 표시는 측위 모드에서 라이다 스캔
            토픽이 브리지될 때만 가능합니다(<code>/SLAM_*</code>은 매핑 전용이라 측위 중엔 나오지 않음).
          </div>
        )}

        <div style={guideStyle}>{stageText}</div>

        {result && (
          <div
            style={{
              ...resultStyle,
              color: result.ok ? "#bbf7d0" : "#ffd9d9",
              background: result.ok ? "rgba(22,101,52,0.25)" : "rgba(191,14,20,0.18)",
              borderColor: result.ok ? "rgba(34,197,94,0.5)" : "var(--color-error-border)",
            }}
            role="alert"
          >
            {result.msg}
          </div>
        )}

        <div style={actionsStyle}>
          <button
            style={ghostBtnStyle}
            onClick={resetPose}
            disabled={applying || completing || !posePoint}
          >
            다시 찍기
          </button>
          <button
            style={{ ...completeBtnStyle, opacity: applying || completing ? 0.6 : 1 }}
            onClick={handleComplete}
            disabled={applying || completing}
          >
            {completing ? "완료 중..." : "완료 (위치 확정)"}
          </button>
          <button style={ghostBtnStyle} onClick={onClose} disabled={applying || completing}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 인라인 스타일(관제 다크 토큰 사용) ── */
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10000,
  backdropFilter: "blur(3px)",
};
const boxStyle: React.CSSProperties = {
  width: "min(1080px, 96vw)",
  maxHeight: "94vh",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  background: "var(--surface-3, #1a1d2e)",
  border: "1px solid var(--border-subtle, #2c3350)",
  borderTop: "3px solid var(--color-warning, #ffc635)",
  borderRadius: 14,
  padding: 18,
  boxShadow: "0 20px 56px rgba(0,0,0,0.5)",
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: 12,
};
const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "var(--text-primary, #fff)",
};
const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-tertiary, #9aa4c4)",
  marginTop: 4,
};
const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-tertiary, #9aa4c4)",
  fontSize: 18,
  cursor: "pointer",
  padding: 4,
  lineHeight: 1,
};
const mapWrapStyle: React.CSSProperties = {
  // flex:1 은 auto-height 부모 안에서 0 으로 붕괴할 수 있어 확정 높이(vh)로 고정.
  // CanvasMap .wrapper 가 height:100% 라 부모의 확정 높이가 있어야 캔버스가 그려진다.
  position: "relative",
  flexShrink: 0,
  width: "100%",
  height: "62vh",
  minHeight: 420,
  background: "#1a1d2e",
  border: "1px solid var(--border-subtle, #2c3350)",
  borderRadius: 10,
  overflow: "hidden",
};
const loadingStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#888",
};
const badgeStyle: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "5px 10px",
  fontSize: 12,
  color: "#dfe4f5",
  background: "rgba(0,0,0,0.6)",
  borderRadius: 8,
  pointerEvents: "none",
};
const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  display: "inline-block",
};
const guideStyle: React.CSSProperties = {
  marginTop: 12,
  fontSize: 13.5,
  color: "var(--text-secondary, #c7cde0)",
  lineHeight: 1.5,
};
const warnStyle: React.CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  fontSize: 12.5,
  lineHeight: 1.6,
  color: "#ffe4b8",
  background: "rgba(245, 158, 11, 0.14)",
  border: "1px solid rgba(245, 158, 11, 0.5)",
  borderRadius: 8,
};
const resultStyle: React.CSSProperties = {
  marginTop: 10,
  padding: "9px 12px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid",
};
const actionsStyle: React.CSSProperties = {
  marginTop: 14,
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};
const completeBtnStyle: React.CSSProperties = {
  height: 42,
  padding: "0 24px",
  border: "none",
  borderRadius: 9,
  fontSize: 14,
  fontWeight: 700,
  color: "#fff",
  background: "var(--color-success, #16a34a)",
  cursor: "pointer",
};
const ghostBtnStyle: React.CSSProperties = {
  height: 42,
  padding: "0 18px",
  borderRadius: 9,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-tertiary, #9aa4c4)",
  background: "transparent",
  border: "1px solid var(--border-default, #3a4166)",
  cursor: "pointer",
};
