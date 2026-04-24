"use client";

import React, { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import styles from "../path/PathAlertsModal.module.css";
import dzStyles from "./DangerZoneNameModal.module.css";

type Props = {
  isOpen: boolean;
  /** 새 꼭짓점으로 인해 영역에 포함된 POI 이름들 */
  poiNames: string[];
  /** 확인 클릭 시 호출됨 — 여기서 undoLastVertex 를 수행 */
  onConfirm: () => void;
};

export default function DangerZonePoiBlockModal({ isOpen, poiNames, onConfirm }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onConfirm]);

  if (!isOpen) return null;

  const primary = poiNames[0] ?? "";
  const extra = poiNames.length > 1 ? ` 외 ${poiNames.length - 1}개` : "";

  return (
    <div className={styles.overlay} onClick={onConfirm}>
      <div
        className={styles.box}
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 380, textAlign: "center" }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <AlertTriangle size={40} color="#E53E3E" strokeWidth={2} />
        </div>

        <div className={styles.message} style={{ marginTop: 14, marginBottom: 12, fontWeight: 600 }}>
          이 꼭짓점은 기존 POI를 영역에 포함시킵니다
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "0 24px 18px",
            fontSize: "var(--font-size-sm)",
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            whiteSpace: "pre-line",
          }}
        >
          {`POI '${primary}'${extra}\n다른 위치를 선택해주세요.`}
        </div>

        <div className={`${styles.footer} ${dzStyles.footer}`}>
          <button
            className={`${styles.btnItemCommon} ${styles.btnBgBlue} ${dzStyles.saveBtn}`}
            onClick={onConfirm}
            autoFocus
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
