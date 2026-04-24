"use client";

import React, { useEffect } from "react";
import { AlertTriangle, Ban } from "lucide-react";
import styles from "../path/PathAlertsModal.module.css";
import dzStyles from "./DangerZoneNameModal.module.css";
import type { ZoneConflicts } from "../../../utils/conflicts";

export type InProgressSchedule = {
  schedule_id: number;
  WorkName: string;
  WayName: string;
};

type CommonProps = {
  isOpen: boolean;
  onCancel: () => void;
};

type CascadeProps = CommonProps & {
  mode: "cascade";
  conflicts: ZoneConflicts;
  onConfirm: () => void;
};

type BlockProps = CommonProps & {
  mode: "block";
  inProgressSchedules: InProgressSchedule[];
};

type Props = CascadeProps | BlockProps;

export default function DangerZoneConflictModal(props: Props) {
  const { isOpen, onCancel } = props;

  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  if (props.mode === "block") {
    return (
      <div className={styles.overlay} onClick={onCancel}>
        <div
          className={styles.box}
          onClick={(e) => e.stopPropagation()}
          style={{ minWidth: 440, textAlign: "center" }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
            <Ban size={40} color="#E53E3E" strokeWidth={2} />
          </div>

          <div className={styles.message} style={{ marginTop: 14, marginBottom: 10, fontWeight: 600 }}>
            위험지역을 저장할 수 없습니다
          </div>

          <div
            style={{
              padding: "0 24px 14px",
              fontSize: "var(--font-size-sm)",
              color: "var(--text-secondary)",
              lineHeight: 1.55,
              whiteSpace: "pre-line",
              textAlign: "left",
            }}
          >
            현재 진행 중인 작업이 이 경로를 사용하고 있습니다.{"\n"}
            작업 완료 후 다시 시도해주세요.
          </div>

          <div
            style={{
              margin: "0 24px 18px",
              padding: "10px 12px",
              borderRadius: 6,
              background: "rgba(229, 62, 62, 0.08)",
              border: "1px solid rgba(229, 62, 62, 0.25)",
              textAlign: "left",
              maxHeight: 160,
              overflowY: "auto",
            }}
          >
            {props.inProgressSchedules.map((s) => (
              <div
                key={s.schedule_id}
                style={{ fontSize: "var(--font-size-sm)", padding: "3px 0", color: "var(--text-primary)" }}
              >
                · <strong>{s.WorkName}</strong>{" "}
                <span style={{ color: "var(--text-secondary)" }}>(경로: {s.WayName})</span>
              </div>
            ))}
          </div>

          <div className={`${styles.footer} ${dzStyles.footer}`}>
            <button
              className={`${styles.btnItemCommon} ${styles.btnBgBlue} ${dzStyles.saveBtn}`}
              onClick={onCancel}
              autoFocus
            >
              확인
            </button>
          </div>
        </div>
      </div>
    );
  }

  // cascade 모드
  const { conflicts, onConfirm } = props;
  const { poisInside, routesCrossing, waysAffected } = conflicts;

  const reasonLabel = (reason: "poi_included" | "segment_crossed", names?: string[]) =>
    reason === "poi_included"
      ? `POI ${(names ?? []).join(", ")} 포함`
      : "구간 교차";

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={styles.box}
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 480 }}
      >
        <button className={styles.closeBtn} onClick={onCancel} aria-label="close">
          <img src="/icon/close_btn.png" alt="" />
        </button>

        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <AlertTriangle size={36} color="#F59E0B" strokeWidth={2} />
        </div>

        <div className={styles.message} style={{ marginTop: 10, marginBottom: 14, fontWeight: 600 }}>
          위험지역 저장 시 다음 항목이 모두 삭제됩니다
        </div>

        <div
          style={{
            padding: "0 24px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {poisInside.length > 0 && (
            <ConflictSection title={`POI (${poisInside.length}개)`} color="#F87171">
              {poisInside.map((p) => (
                <li key={`poi_${p.kind}_${p.id}`}>
                  <strong>{p.name}</strong>
                  {p.category && (
                    <span style={{ color: "var(--text-secondary)" }}> ({p.category})</span>
                  )}
                  {p.kind === "pending" && (
                    <span style={{ color: "var(--text-muted, #888)", fontStyle: "italic" }}> · 미저장</span>
                  )}
                </li>
              ))}
            </ConflictSection>
          )}

          {routesCrossing.length > 0 && (
            <ConflictSection title={`구간 (${routesCrossing.length}개)`} color="#F87171">
              {routesCrossing.map((r) => (
                <li key={`route_${r.kind}_${r.id}`}>
                  <strong>{r.startName}</strong>
                  {" → "}
                  <strong>{r.endName}</strong>
                  <span style={{ color: "var(--text-secondary)" }}> ({r.direction})</span>
                  {r.kind === "pending" && (
                    <span style={{ color: "var(--text-muted, #888)", fontStyle: "italic" }}> · 미저장</span>
                  )}
                </li>
              ))}
            </ConflictSection>
          )}

          {waysAffected.length > 0 && (
            <ConflictSection title={`경로 (${waysAffected.length}개)`} color="#F87171">
              {waysAffected.map((w) => (
                <li key={`way_${w.id}`}>
                  <strong>{w.wayName}</strong>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {" "}
                    (사유: {reasonLabel(w.reason, w.affectedPoiNames)})
                  </span>
                </li>
              ))}
            </ConflictSection>
          )}
        </div>

        <div className={`${styles.footer} ${dzStyles.footer}`}>
          <button
            className={`${styles.btnItemCommon} ${dzStyles.cancelBtn}`}
            onClick={onCancel}
          >
            취소
          </button>
          <button
            className={`${styles.btnItemCommon} ${styles.btnBgBlue} ${dzStyles.saveBtn}`}
            onClick={onConfirm}
          >
            모두 삭제하고 저장
          </button>
        </div>
      </div>
    </div>
  );
}

function ConflictSection({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color,
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
          }}
        />
        {title}
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: "var(--font-size-sm)",
          color: "var(--text-primary)",
        }}
      >
        {children}
      </ul>
    </div>
  );
}
