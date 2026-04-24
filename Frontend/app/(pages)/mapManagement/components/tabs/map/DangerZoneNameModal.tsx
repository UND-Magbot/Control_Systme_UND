"use client";

import React, { useEffect, useState } from "react";
import styles from "../path/PathAlertsModal.module.css";
import dzStyles from "./DangerZoneNameModal.module.css";

type Props = {
  isOpen: boolean;
  vertexCount: number;
  existingNames: string[];
  onCancel: () => void;
  onConfirm: (name: string, description: string) => void;
};

export default function DangerZoneNameModal({
  isOpen,
  vertexCount,
  existingNames,
  onCancel,
  onConfirm,
}: Props) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setDesc("");
    setError(null);

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

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("위험지역 이름을 입력해주세요.");
      return;
    }
    if (existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      setError("같은 맵에 동일한 이름의 위험지역이 이미 존재합니다.");
      return;
    }
    onConfirm(trimmed, desc.trim());
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={styles.box}
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 420 }}
      >
        <button className={styles.closeBtn} onClick={onCancel} aria-label="close">
          <img src="/icon/close_btn.png" alt="" />
        </button>

        <div className={styles.message} style={{ marginTop: 16, marginBottom: 18 }}>
          위험지역 등록 ({vertexCount}개 꼭짓점)
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 20px 22px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" }}>
              이름 <span style={{ color: "#E53E3E" }}>*</span>
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              maxLength={50}
              placeholder="예: 주차장_위험영역"
              className={dzStyles.input}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" }}>
              설명 (선택)
            </span>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="이 구역에 대한 간단한 설명"
              className={dzStyles.textarea}
            />
          </label>

          {error && (
            <div style={{ color: "var(--color-error, #E53E3E)", fontSize: "var(--font-size-sm)" }}>
              {error}
            </div>
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
            onClick={submit}
          >
            <img src="/icon/check.png" alt="" />
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
