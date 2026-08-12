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

/** 라벨 옆 `?` 도움말. 설명을 상시 노출하면 모달이 길어져 정작 중요한 경고가 묻힌다. */
function HelpTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 14, height: 14, marginLeft: 5, borderRadius: "50%",
        border: "1px solid var(--border-input)", color: "var(--text-tertiary)",
        fontSize: 10, lineHeight: 1, cursor: "help", verticalAlign: "middle",
        fontWeight: 600,
      }}
    >
      ?
    </span>
  );
}

export default function FloorChangeModal({ isOpen, robotId, robotName, currentFloorId, currentMapId, onClose, onComplete }: Props) {
  const [floors, setFloors] = useState<FloorItem[]>([]);
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<number | "">(currentFloorId ?? "");
  const [selectedMapId, setSelectedMapId] = useState<number | "">(currentMapId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  // 층 목록 로드
  useEffect(() => {
    if (!isOpen) return;
    setSelectedFloorId(currentFloorId ?? "");
    setSelectedMapId(currentMapId ?? "");
    setError(null);
    setReason("");
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
    if (!selectedMapId || !reason.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/map/maps/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map_id: selectedMapId, robot_id: robotId, reason: reason.trim() }),
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

  // 확인 버튼이 왜 비활성인지 알려준다. 표시가 없으면 버튼 고장으로 오해한다.
  const blockedReason = !selectedMapId
    ? "적용할 맵을 선택해야 활성화됩니다."
    : !reason.trim()
      ? "사유를 입력해야 활성화됩니다."
      : null;

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
            <span style={{ fontWeight: 600, fontSize: "var(--font-size-lg)" }}>층 변경 (관리자)</span>
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
        <div style={{ marginBottom: 18 }}>
          <label style={{
            fontSize: "var(--font-size-xs)", color: "var(--text-secondary)",
            display: "block", marginBottom: 8, fontWeight: 500,
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
            display: "block", marginBottom: 8, fontWeight: 500,
          }}>
            적용할 맵
            <HelpTip text={"선택한 층에 등록된 맵 중 로봇에 활성화할 맵입니다.\n\n활성 맵을 바꾸면 NOS active 맵을 교체하고 localization 을 재시작합니다.\n자율 주행/전환 중이면 측위가 발산할 수 있어, 로봇이 작업 중이면 서버가 거부합니다."} />
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

        {/* 위험 고지 — 파괴적 작업. 상세는 '적용할 맵' 의 ? 툴팁으로 옮겼고,
            한 줄은 남긴다. 측위 재시작은 되돌릴 수 없어 접어두면 안 된다. */}
        <div style={{
          fontSize: "var(--font-size-xs)", color: "#e8b9bd",
          padding: "8px 12px", borderRadius: 6,
          background: "rgba(148, 22, 33, 0.14)",
          border: "1px solid rgba(255, 75, 75, 0.35)",
          marginBottom: 18, lineHeight: 1.5,
        }}>
          <b style={{ color: "#ffb4b4", fontWeight: 600 }}>주의</b> — 맵을 바꾸면 측위가 재시작됩니다.
        </div>

        {/* 사유 (필수) — 감사 로그 기록 */}
        <div style={{ marginBottom: 18 }}>
          <label style={{
            fontSize: "var(--font-size-xs)", color: "var(--text-secondary)",
            display: "block", marginBottom: 8, fontWeight: 500,
          }}>
            사유 <span style={{ color: "var(--color-error-soft)" }}>*</span>
            <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}> — 감사 로그에 기록됩니다</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="예: 엘리베이터 대기 타임아웃 후 로봇이 3F에 실제 하차함. 수동 정합."
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6,
              border: "1px solid var(--border-input)", background: "var(--surface-input)",
              color: "var(--text-primary)", fontSize: "var(--font-size-sm)",
              resize: "vertical", minHeight: 52, fontFamily: "inherit",
            }}
          />
        </div>

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

        {/* 버튼 — 힌트와 한 묶음으로 감싼다(confirmBox 의 flex gap 이 따로 벌어지지 않도록) */}
        <div>
          {!loading && blockedReason && (
            <div style={{
              fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)",
              textAlign: "center", marginBottom: 10,
            }}>
              {blockedReason}
            </div>
          )}
          <div className={styles.confirmButtons}>
            <button className={`${styles.btnItemCommon} ${styles.btnBgRed}`} onClick={onClose} disabled={loading}>
              <img src="/icon/close_btn.png" alt="" />
              <div>취소</div>
            </button>
            <button
              className={`${styles.btnItemCommon} ${styles.btnBgBlue}`}
              onClick={handleConfirm}
              disabled={!!blockedReason || loading}
              style={{ opacity: blockedReason || loading ? 0.5 : 1 }}
            >
              {loading ? (
                <div>활성화 중...</div>
              ) : (
                <>
                  <img src="/icon/check.png" alt="" />
                  <div>층 변경</div>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
