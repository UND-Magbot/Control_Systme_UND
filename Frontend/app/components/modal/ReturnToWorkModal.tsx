"use client";

import { useState, useEffect } from "react";
import styles from "./Modal.module.css";
import { apiFetch } from "@/app/lib/api";

type RouteInfo = {
  available: boolean;
  msg?: string;
  source?: "active" | "recent";
  source_label?: string;
  retrace_available?: boolean;
  schedule_name?: string;
  way_name?: string;
  origin?: string;
  waypoints?: string[];
};

type Props = {
  isOpen: boolean;
  onSelect: (mode: "direct" | "retrace") => void;
  onCancel: () => void;
};

export default function ReturnToWorkModal({ isOpen, onSelect, onCancel }: Props) {
  const [info, setInfo] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    apiFetch(`/robot/return-to-work/info`)
      .then((res) => res.json())
      .then((data) => setInfo(data))
      .catch(() => setInfo({ available: false, msg: "경로 정보를 불러올 수 없습니다." }))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className={styles.confirmOverlay} onClick={onCancel}>
      <div
        className={styles.confirmBox}
        style={{ height: "auto", width: 440, padding: "24px 20px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className={styles.closeBox} onClick={onCancel}>
          <img src="/icon/close_btn.png" alt="" />
        </button>

        <div style={{ textAlign: "center", fontSize: "var(--font-size-xl)", marginBottom: 16, marginTop: 16 }}>
          작업 복귀
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)" }}>
            경로 정보 조회 중...
          </div>
        )}

        {!loading && info && !info.available && (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)" }}>
            {info.msg}
          </div>
        )}

        {!loading && info?.available && (
          <>
            {/* 경로 정보 */}
            <div style={{
              background: "var(--surface-1)",
              borderRadius: 10,
              padding: "14px 16px",
              margin: "0 10px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: "var(--font-size-xs)",
                  background: info.source === "active" ? "var(--accent-blue)" : "var(--surface-5)",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}>
                  {info.source_label}
                </span>
                {info.schedule_name && (
                  <span style={{ fontSize: "var(--font-size-md)", color: "var(--text-primary)" }}>
                    {info.schedule_name}
                  </span>
                )}
                {info.way_name && (
                  <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
                    ({info.way_name})
                  </span>
                )}
              </div>
              <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)", lineHeight: 1.6 }}>
                <div>
                  경로: {info.waypoints?.join(" → ")}
                </div>
                <div style={{ marginTop: 4, color: "var(--text-primary)" }}>
                  복귀 위치: <strong>{info.origin}</strong>
                </div>
              </div>
            </div>

            {/* 선택 버튼 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 10px" }}>
              <button
                className={styles.btnItemCommon}
                style={{
                  width: "100%",
                  height: 48,
                  background: "var(--accent-blue)",
                  fontSize: "var(--font-size-lg)",
                  borderRadius: 10,
                }}
                onClick={() => onSelect("direct")}
              >
                자율 주행으로 복귀
              </button>
              <button
                className={styles.btnItemCommon}
                style={{
                  width: "100%",
                  height: 48,
                  background: info.retrace_available ? "var(--surface-5)" : "var(--surface-2)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  fontSize: "var(--font-size-lg)",
                  borderRadius: 10,
                  opacity: info.retrace_available ? 1 : 0.4,
                  cursor: info.retrace_available ? "pointer" : "not-allowed",
                }}
                onClick={() => info.retrace_available && onSelect("retrace")}
                disabled={!info.retrace_available}
              >
                경로를 따라 복귀
                {!info.retrace_available && (
                  <span style={{ fontSize: "var(--font-size-xs)", marginLeft: 6, color: "var(--text-muted)" }}>
                    (작업 진행 중에만 가능)
                  </span>
                )}
              </button>
            </div>

            <div style={{
              textAlign: "center",
              fontSize: "var(--font-size-xs)",
              color: "var(--text-muted)",
              marginTop: 12,
              lineHeight: 1.5,
            }}>
              자율 주행: 최적 경로로 직접 이동<br />
              경로 따라: 지나온 경로를 역순으로 이동
            </div>
          </>
        )}
      </div>
    </div>
  );
}
