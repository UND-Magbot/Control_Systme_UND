"use client";

import React, { useState, useEffect } from 'react';
import styles from '@/app/components/modal/Modal.module.css';
import listStyles from './RobotList.module.css';
import type { BusinessItem } from './BusinessList';
import { apiFetch } from "@/app/lib/api";

type BusinessDetailModalProps = {
  isOpen: boolean;
  mode: "create" | "view";
  businessId: number | null;
  initialEditMode?: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export default function BusinessDetailModal({
  isOpen, mode, businessId, initialEditMode = false, onClose, onSaved,
}: BusinessDetailModalProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [business, setBusiness] = useState<BusinessItem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [contactError, setContactError] = useState("");

  // 폼 필드
  const [name, setName] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [representName, setRepresentName] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");

  // ── 초기화 ──
  useEffect(() => {
    if (!isOpen) return;
    if (mode === "create") {
      setIsEditMode(true);
      resetForm();
      setBusiness(null);
    } else if (businessId != null) {
      setIsEditMode(initialEditMode);
      fetchBusiness(businessId);
    }
    setFieldErrors({});
    setContactError("");
  }, [isOpen, mode, businessId]);

  // ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditMode && mode === "view") resetToView();
        else onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handler);
      document.body.style.overflow = "hidden";
    }
    return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = "unset"; };
  }, [isOpen, isEditMode, mode]);

  const resetForm = () => {
    setName(""); setZipCode(""); setAddress(""); setAddressDetail("");
    setRepresentName(""); setContact(""); setDescription("");
  };

  const populateForm = (b: BusinessItem) => {
    setName(b.businessName);
    setZipCode(b.zipCode);
    setAddress(b.address);
    setAddressDetail(b.addressDetail);
    setRepresentName(b.representName);
    setContact(b.contact);
    setDescription(b.description);
  };

  const resetToView = () => {
    if (business) populateForm(business);
    setIsEditMode(false);
    setFieldErrors({});
    setContactError("");
  };

  // ── API ──
  const fetchBusiness = async (id: number) => {
    try {
      const res = await apiFetch(`/DB/businesses/${id}`);
      if (!res.ok) return;
      const d = await res.json();
      const item: BusinessItem = {
        id: d.id,
        businessName: d.BusinessName ?? "",
        zipCode: d.ZipCode ?? "",
        address: d.Address ?? "",
        addressDetail: d.AddressDetail ?? "",
        representName: d.RepresentName ?? "",
        contact: d.Contact ?? "",
        description: d.Description ?? "",
        areaCount: d.AreaCount ?? 0,
        robotCount: d.RobotCount ?? 0,
        createdAt: d.CreatedAt ? new Date(d.CreatedAt).toLocaleDateString("ko-KR") : "-",
      };
      setBusiness(item);
      populateForm(item);
    } catch { /* ignore */ }
  };

  // ── 주소 검색 ──
  const handleAddressSearch = () => {
    const daum = (window as any).daum;
    if (!daum?.Postcode) {
      const script = document.createElement("script");
      script.src = "//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
      script.onload = () => openPostcode();
      document.head.appendChild(script);
    } else {
      openPostcode();
    }
  };

  const openPostcode = () => {
    new (window as any).daum.Postcode({
      oncomplete: (data: any) => {
        setZipCode(data.zonecode ?? "");
        setAddress(data.roadAddress || data.jibunAddress || data.address);
        setAddressDetail("");
        setFieldErrors((p) => ({ ...p, address: false }));
      },
    }).open();
  };

  // ── 연락처 자동 하이픈 ──
  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  };

  const handleContactChange = (v: string) => {
    setContact(formatPhone(v));
    setContactError("");
  };

  // ── 저장 ──
  const handleSave = async () => {
    const errs: Record<string, boolean> = {};
    if (!name.trim()) errs.name = true;
    if (!representName.trim()) errs.representName = true;
    if (!address.trim()) errs.address = true;
    const phoneDigits = contact.replace(/\D/g, "");
    if (phoneDigits && !/^(01[016789]\d{7,8}|0[2-6][1-5]?\d{6,8})$/.test(phoneDigits)) {
      setContactError("올바른 연락처를 입력해주세요");
      errs.contact = true;
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const payload = {
      BusinessName: name.trim(),
      ZipCode: zipCode, Address: address, AddressDetail: addressDetail.trim(),
      RepresentName: representName.trim() || null,
      Contact: contact.trim() || null,
      Description: description.trim() || null,
    };

    try {
      const url = mode === "create"
        ? `/DB/businesses`
        : `/DB/businesses/${businessId}`;
      const res = await apiFetch(url, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail ?? "저장 실패");
      }
      onSaved();
      if (mode === "create") { onClose(); }
      else { if (businessId) await fetchBusiness(businessId); setIsEditMode(false); }
    } catch (e: any) {
      console.error(e?.message ?? e);
    }
  };

  if (!isOpen) return null;

  // 주소 표시 (조회 모드)
  const fullAddressDisplay = [business?.zipCode, business?.address, business?.addressDetail].filter(Boolean).join(" ") || "-";

  const requiredFieldKeys = ["name", "representName", "address"];

  const infoField = (label: string, field: string | null, value: string, readonly?: boolean) => {
    const isRequired = field != null && requiredFieldKeys.includes(field);
    const hasError = field != null && fieldErrors[field];

    return (
      <div className={styles.detailInfoRow}>
        <span className={styles.detailInfoLabel}>
          {label}
          {isEditMode && isRequired && !readonly && <span className={styles.requiredMark}> *</span>}
        </span>
        <span className={styles.detailInfoValue}>
          {isEditMode && field && !readonly ? (
            <div>
              <input
                className={`${styles.detailInfoInput} ${hasError ? styles.inputError : ""}`}
                type="text"
                maxLength={20}
                value={getFieldValue(field)}
                placeholder="입력"
                onChange={(e) => {
                  setFieldByKey(field, e.target.value);
                  if (fieldErrors[field]) setFieldErrors((p) => ({ ...p, [field]: false }));
                }}
              />
              {hasError && <span className={styles.errorMessage}>필수 입력 항목입니다</span>}
            </div>
          ) : value}
        </span>
      </div>
    );
  };

  function getFieldValue(key: string): string {
    switch (key) {
      case "name": return name;
      case "representName": return representName;
      case "contact": return contact;
      case "description": return description;
      default: return "";
    }
  }

  function setFieldByKey(key: string, value: string) {
    switch (key) {
      case "name": setName(value); break;
      case "representName": setRepresentName(value); break;
      case "contact": handleContactChange(value); break;
      case "description": setDescription(value); break;
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderTop}>
            <h2>
              {mode === "create" ? "사업장 등록"
                : `${business?.businessName ?? "사업장"} ${isEditMode ? "수정" : "상세정보"}`}
            </h2>
            <button className={styles.detailCloseBtn} onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={styles.detailBody}>
          <div className={styles.detailInfoSection}>
            <h3 className={styles.detailSectionTitle}>기본 정보</h3>
            <div className={styles.detailInfoGrid}>
              {infoField("사업장명", "name", business?.businessName ?? "-")}
              {infoField("대표명", "representName", business?.representName ?? "-")}

              {/* 연락처 */}
              <div className={styles.detailInfoRow}>
                <span className={styles.detailInfoLabel}>연락처</span>
                <span className={styles.detailInfoValue}>
                  {isEditMode ? (
                    <div>
                      <input
                        className={`${styles.detailInfoInput} ${fieldErrors.contact ? styles.inputError : ""}`}
                        type="text"
                        maxLength={13}
                        value={contact}
                        placeholder="010-1234-5678"
                        onChange={(e) => handleContactChange(e.target.value)}
                      />
                      {contactError && <span className={styles.errorMessage}>{contactError}</span>}
                    </div>
                  ) : (business?.contact || "-")}
                </span>
              </div>

              {/* 등록일 (읽기 전용) */}
              {infoField("등록일", null, business?.createdAt ?? "-", true)}

              {/* 주소 */}
              <div className={`${styles.detailInfoRow} ${styles.detailInfoFull}`}>
                <span className={styles.detailInfoLabel}>
                  주소
                  {isEditMode && <span className={styles.requiredMark}> *</span>}
                </span>
                <span className={styles.detailInfoValue}>
                  {isEditMode ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          className={`${styles.detailInfoInput}`}
                          type="text" value={zipCode} placeholder="우편번호" readOnly
                          onClick={handleAddressSearch}
                          style={{ flex: "0 0 100px", cursor: "pointer" }}
                        />
                        <button type="button" className={listStyles.placeAddBtn} onClick={handleAddressSearch} style={{ flexShrink: 0 }}>
                          주소 검색
                        </button>
                      </div>
                      <input
                        className={`${styles.detailInfoInput} ${fieldErrors.address ? styles.inputError : ""}`}
                        type="text" value={address} placeholder="주소를 검색하세요" readOnly
                        onClick={handleAddressSearch} style={{ cursor: "pointer" }}
                      />
                      <input
                        className={styles.detailInfoInput}
                        type="text" maxLength={100} value={addressDetail}
                        placeholder="상세주소 입력 (선택)"
                        onChange={(e) => setAddressDetail(e.target.value)}
                      />
                      {fieldErrors.address && <span className={styles.errorMessage}>주소를 검색해주세요</span>}
                    </div>
                  ) : fullAddressDisplay}
                </span>
              </div>

              {/* 영역 수 / 로봇 수 (조회 모드에서만) */}
              {!isEditMode && infoField("영역 수", null, `${business?.areaCount ?? 0}개`, true)}
              {!isEditMode && infoField("로봇 수", null, `${business?.robotCount ?? 0}대`, true)}

              {/* 회사 설명 */}
              <div className={`${styles.detailInfoRow} ${styles.detailInfoFull}`}>
                <span className={styles.detailInfoLabel}>회사 설명</span>
                <span className={styles.detailInfoValue}>
                  {isEditMode ? (
                    <textarea
                      className={styles.detailInfoInput}
                      maxLength={200}
                      value={description}
                      placeholder="회사 설명을 입력하세요"
                      onChange={(e) => setDescription(e.target.value)}
                      style={{ minHeight: 60, resize: "vertical" }}
                    />
                  ) : (business?.description || "-")}
                </span>
              </div>
            </div>

            {/* 액션 버튼 (기본정보 섹션 내부) */}
            {isEditMode && (
              <div className={styles.detailActionBar}>
                <button type="button" className={`${styles.btnItemCommon} ${styles.btnBgRed}`}
                  onClick={mode === "view" ? resetToView : onClose}>
                  <span>취소</span>
                </button>
                <button type="button" className={`${styles.btnItemCommon} ${styles.btnBgBlue}`}
                  onClick={handleSave}>
                  <span>{mode === "create" ? "등록" : "저장"}</span>
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
