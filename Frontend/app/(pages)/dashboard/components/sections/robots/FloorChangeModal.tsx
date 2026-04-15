"use client";

import React, { useState, useEffect } from "react";
import styles from "@/app/components/modal/Modal.module.css";
import { apiFetch } from "@/app/lib/api";

type FloorItem = { id: number; FloorName: string };
type MapItem = { id: number; FloorId: number; MapName: string };

type Props = {
  isOpen: boolean;
  robotId: number;
  robotName: string;
  currentFloorId: number | null;
  currentMapId: number | null;
  onClose: () => void;
  onComplete: () => void;
};

export default function FloorChangeModal({ isOpen, robotId, robotName, currentFloorId, currentMapId, onClose, onComplete }: Props) {
  const [floors, setFloors] = useState<FloorItem[]>([]);
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<number | "">(currentFloorId ?? "");
  const [selectedMapId, setSelectedMapId] = useState<number | "">(currentMapId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 층 목록 로드
  useEffect(() => {
    if (!isOpen) return;
    setSelectedFloorId(currentFloorId ?? "");
    setSelectedMapId(currentMapId ?? "");
    setError(null);
    apiFetch(`/map/floors`)
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setFloors(data))
      .catch(() => setFloors([]));
  }, [isOpen]);

  // 층 선택 시 맵 목록 로드
  useEffect(() => {
    if (!selectedFloorId) { setMaps([]); setSelectedMapId(""); return; }
    apiFetch(`/map/maps?floor_id=${selectedFloorId}`)
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        setMaps(data);
        // 현재 활성 맵이 목록에 있으면 유지, 1개면 자동 선택
        const hasCurrentMap = currentMapId && data.some((m: MapItem) => m.id === currentMapId);
        setSelectedMapId(hasCurrentMap ? currentMapId : data.length === 1 ? data[0].id : "");
      })
      .catch(() => setMaps([]));
  }, [selectedFloorId]);

  const handleConfirm = async () => {
    if (!selectedMapId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/map/maps/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map_id: selectedMapId, robot_id: robotId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "맵 활성화 실패");
      }
      onComplete();
      onClose();
    } catch (e: any) {
      setError(e.message || "맵 활성화 실패");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentFloorName = floors.find((f) => f.id === currentFloorId)?.FloorName ?? "-";
  const isSameFloor = selectedFloorId === currentFloorId;

  return (
    <div className={styles.confirmOverlay} onClick={onClose}>
      <div
        className={styles.confirmBox}
        style={{ width: 380, height: "auto", padding: "24px 28px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/icon/floor_change.png" alt="" style={{ width: 18, height: 18, opacity: 0.7 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span style={{ fontWeight: 600, fontSize: "var(--font-size-lg)" }}>현재 층 변경</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}
          >
            <img src="/icon/close_btn.png" alt="닫기" style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {/* 로봇 정보 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", borderRadius: 8,
          background: "var(--surface-5)", marginBottom: 18,
          fontSize: "var(--font-size-sm)",
        }}>
          <span style={{ color: "var(--text-secondary)" }}>로봇</span>
          <span style={{ fontWeight: 600 }}>{robotName}</span>
          <span style={{ marginLeft: "auto", color: "var(--text-tertiary)", fontSize: "var(--font-size-xs)" }}>
            현재: {currentFloorName}
          </span>
        </div>

        {/* 층 선택 */}
        <div style={{ marginBottom: 14 }}>
          <label style={{
            fontSize: "var(--font-size-xs)", color: "var(--text-secondary)",
            display: "block", marginBottom: 6, fontWeight: 500,
          }}>
            변경할 층
          </label>
          <select
            value={selectedFloorId}
            onChange={(e) => { setSelectedFloorId(Number(e.target.value)); setSelectedMapId(""); setError(null); }}
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6,
              border: "1px solid var(--border-input)", background: "var(--surface-input)",
              color: "var(--text-primary)", fontSize: "var(--font-size-sm)",
            }}
          >
            <option value="">층을 선택하세요</option>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.FloorName}{f.id === currentFloorId ? " (현재)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* 맵 선택 */}
        <div style={{ marginBottom: 18 }}>
          <label style={{
            fontSize: "var(--font-size-xs)", color: "var(--text-secondary)",
            display: "block", marginBottom: 6, fontWeight: 500,
          }}>
            적용할 맵
          </label>
          <select
            value={selectedMapId}
            onChange={(e) => { setSelectedMapId(Number(e.target.value)); setError(null); }}
            disabled={!selectedFloorId || maps.length === 0}
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6,
              border: "1px solid var(--border-input)", background: "var(--surface-input)",
              color: !selectedFloorId || maps.length === 0 ? "var(--text-tertiary)" : "var(--text-primary)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <option value="">{maps.length === 0 ? "해당 층에 맵이 없습니다" : "맵을 선택하세요"}</option>
            {maps.map((m) => (
              <option key={m.id} value={m.id}>{m.MapName}{m.id === currentMapId ? " (현재)" : ""}</option>
            ))}
          </select>
        </div>

        {/* 안내 메시지 */}
        {selectedMapId && !error && (
          <div style={{
            fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)",
            padding: "8px 12px", borderRadius: 6,
            background: "rgba(0, 168, 232, 0.08)",
            marginBottom: 14, lineHeight: 1.5,
          }}>
            맵 활성화 시 localization 서비스가 재시작되며,{"\n"}
            초기 위치가 설정된 경우 자동으로 적용됩니다.
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div style={{
            fontSize: "var(--font-size-xs)", color: "var(--color-error-soft)",
            padding: "8px 12px", borderRadius: 6,
            background: "rgba(229, 62, 62, 0.08)",
            marginBottom: 14,
          }}>
            {error}
          </div>
        )}

        {/* 버튼 */}
        <div className={styles.confirmButtons}>
          <button className={`${styles.btnItemCommon} ${styles.btnBgRed}`} onClick={onClose} disabled={loading}>
            <img src="/icon/close_btn.png" alt="" />
            <div>취소</div>
          </button>
          <button
            className={`${styles.btnItemCommon} ${styles.btnBgBlue}`}
            onClick={handleConfirm}
            disabled={!selectedMapId || loading}
            style={{ opacity: !selectedMapId || loading ? 0.5 : 1 }}
          >
            {loading ? (
              <div>활성화 중...</div>
            ) : (
              <>
                <img src="/icon/check.png" alt="" />
                <div>{isSameFloor ? "맵 변경" : "현재 층 변경"}</div>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
