"use client";

import React, { useState, useEffect } from 'react';
import styles from '@/app/components/modal/Modal.module.css';
import type { BusinessItem } from './BusinessList';

type BusinessCrudModalProps = {
  isOpen: boolean;
  mode: "create" | "edit";
  initial: BusinessItem | null;
  onClose: () => void;
  onSubmit: (name: string, address: string) => void;
};

export default function BusinessCrudModal({
  isOpen,
  mode,
  initial,
  onClose,
  onSubmit,
}: BusinessCrudModalProps) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      if (mode === "edit" && initial) {
        setName(initial.businessName);
        setAddress(initial.address);
        setIsEditMode(false);
      } else {
        setName("");
        setAddress("");
        setIsEditMode(true);
      }
      setErrors({});
    }
  }, [isOpen, mode, initial]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditMode && mode === "edit") {
          setName(initial?.businessName ?? "");
          setAddress(initial?.address ?? "");
          setIsEditMode(false);
          setErrors({});
        } else {
          onClose();
        }
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, isEditMode, mode, initial, onClose]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "사업자명을 입력해주세요";
    else if (name.trim().length > 100) newErrors.name = "100자 이내로 입력해주세요";
    if (address.length > 200) newErrors.address = "200자 이내로 입력해주세요";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    onSubmit(name.trim(), address.trim());
  };

  const handleCancel = () => {
    if (mode === "edit") {
      setName(initial?.businessName ?? "");
      setAddress(initial?.address ?? "");
      setIsEditMode(false);
      setErrors({});
    } else {
      onClose();
    }
  };

  const infoField = (
    label: string,
    value: string,
    field: "name" | "address" | null,
    options?: { required?: boolean; maxLength?: number; placeholder?: string; fullWidth?: boolean }
  ) => (
    <div className={`${styles.detailInfoRow} ${options?.fullWidth ? styles.detailInfoFull : ""}`}>
      <span className={styles.detailInfoLabel}>
        {label}{options?.required && isEditMode ? " *" : ""}
      </span>
      <span className={styles.detailInfoValue}>
        {isEditMode && field ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: "100%" }}>
            <input
              className={styles.detailInfoInput}
              type="text"
              maxLength={options?.maxLength}
              value={field === "name" ? name : address}
              placeholder={options?.placeholder ?? "입력"}
              onChange={(e) => {
                if (field === "name") setName(e.target.value);
                else setAddress(e.target.value);
                setErrors((prev) => ({ ...prev, [field]: "" }));
              }}
              style={errors[field] ? { borderColor: "var(--color-error)" } : undefined}
            />
            {errors[field] && (
              <span style={{ fontSize: "11px", color: "var(--color-error-soft)", marginTop: 2 }}>
                {errors[field]}
              </span>
            )}
          </div>
        ) : (
          value || "-"
        )}
      </span>
    </div>
  );

  return (
    <div className={styles.modalOverlay} onClick={isEditMode && mode === "create" ? onClose : undefined}>
      <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderTop}>
            <h2>{mode === "create" ? "사업자 등록" : (initial?.businessName ?? "사업자")}</h2>
            <button className={styles.detailCloseBtn} onClick={onClose} aria-label="닫기">✕</button>
          </div>

          {mode === "edit" && (
            <div className={styles.detailModeTabs}>
              <button
                className={`${styles.detailModeTab} ${!isEditMode ? styles.detailModeTabActive : ""}`}
                onClick={() => { setIsEditMode(false); setName(initial?.businessName ?? ""); setAddress(initial?.address ?? ""); setErrors({}); }}
              >
                조회
              </button>
              <button
                className={`${styles.detailModeTab} ${isEditMode ? styles.detailModeTabActive : ""}`}
                onClick={() => setIsEditMode(true)}
              >
                수정
              </button>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className={styles.detailBody}>
          <div className={styles.detailInfoSection}>
            <h3 className={styles.detailSectionTitle}>기본 정보</h3>
            <div className={styles.detailInfoGrid}>
              {infoField("사업자명", name || initial?.businessName || "", "name", {
                required: true, maxLength: 100, placeholder: "사업자명을 입력하세요", fullWidth: true,
              })}
              {infoField("주소", address || initial?.address || "", "address", {
                maxLength: 200, placeholder: "주소를 입력하세요", fullWidth: true,
              })}

              {mode === "edit" && !isEditMode && initial && (
                <>
                  <div className={styles.detailInfoRow}>
                    <span className={styles.detailInfoLabel}>영역 수</span>
                    <span className={styles.detailInfoValue}>{initial.areaCount}개</span>
                  </div>
                  <div className={styles.detailInfoRow}>
                    <span className={styles.detailInfoLabel}>로봇 수</span>
                    <span className={styles.detailInfoValue}>{initial.robotCount}대</span>
                  </div>
                  <div className={`${styles.detailInfoRow} ${styles.detailInfoFull}`}>
                    <span className={styles.detailInfoLabel}>등록일</span>
                    <span className={styles.detailInfoValue}>{initial.addDate}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer (수정/등록 모드에서만) ── */}
        {isEditMode && (
          <div className={styles.detailFooter}>
            <div className={styles.btnRightBox}>
              <button
                type="button"
                className={`${styles.btnItemCommon} ${styles.btnBgRed}`}
                onClick={handleCancel}
              >
                <span className={styles.btnIcon}><img src="/icon/close_btn.png" alt="" /></span>
                <span>취소</span>
              </button>
              <button
                type="button"
                className={`${styles.btnItemCommon} ${styles.btnBgBlue}`}
                onClick={handleSubmit}
              >
                <span className={styles.btnIcon}><img src="/icon/check.png" alt="" /></span>
                <span>{mode === "create" ? "등록" : "저장"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
