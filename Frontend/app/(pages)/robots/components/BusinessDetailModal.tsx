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
        if (isEditMode && mode === "view" && !initialEditMode) resetToView();
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
        <div className={styles.detailHeader} style={isEditMode ? { paddingBottom: 0 } : undefined}>
          <div className={styles.detailHeaderTop}>
            <h2>
              {mode === "create" ? "사업장 등록"
                : `${business?.businessName ?? "사업장"} ${isEditMode ? "수정" : "상세정보"}`}
            </h2>
            <button className={styles.detailCloseBtn} onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={styles.detailBody} style={isEditMode ? { paddingTop: 0 } : undefined}>
          {isEditMode ? (
            <>
              <div className={styles.itemBoxContainer}>
                {/* 사업장명 */}
                <div className={styles.insertItemBox}>
                  <div className={styles.insertItemLabel}>사업장명 <span className={styles.requiredMark}>*</span></div>
                  <div className={styles.insertInputWrap}>
                    <input type="text" maxLength={20} value={name}
                      onChange={e => { setName(e.target.value); if (fieldErrors.name) setFieldErrors(p => ({...p, name: false})); }}
                      placeholder="20글자 이내로 작성해 주세요."
                      className={fieldErrors.name ? styles.inputError : ""} />
                    {fieldErrors.name && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
                  </div>
                </div>
                {/* 대표명 */}
                <div className={styles.insertItemBox}>
                  <div className={styles.insertItemLabel}>대표명 <span className={styles.requiredMark}>*</span></div>
                  <div className={styles.insertInputWrap}>
                    <input type="text" maxLength={20} value={representName}
                      onChange={e => { setRepresentName(e.target.value); if (fieldErrors.representName) setFieldErrors(p => ({...p, representName: false})); }}
                      placeholder="20글자 이내로 작성해 주세요."
                      className={fieldErrors.representName ? styles.inputError : ""} />
                    {fieldErrors.representName && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
                  </div>
                </div>
                {/* 연락처 */}
                <div className={styles.insertItemBox}>
                  <div className={styles.insertItemLabel}>연락처</div>
                  <div className={styles.insertInputWrap}>
                    <input type="text" maxLength={13} value={contact}
                      onChange={e => handleContactChange(e.target.value)}
                      placeholder="예: 010-1234-5678"
                      className={fieldErrors.contact ? styles.inputError : ""} />
                    {contactError && <div className={styles.errorMessage}>{contactError}</div>}
                  </div>
                </div>
                {/* 등록일 (수정 모드에서만 표시) */}
                {mode === "view" && (
                  <div className={styles.insertItemBox}>
                    <div className={styles.insertItemLabel}>등록일</div>
                    <div className={styles.insertInputWrap}>
                      <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", lineHeight: "36px" }}>{business?.createdAt ?? "-"}</span>
                    </div>
                  </div>
                )}
                {/* 주소 (full width) */}
                <div className={styles.insertItemBox} style={{ gridColumn: "1 / -1" }}>
                  <div className={styles.insertItemLabel}>주소 <span className={styles.requiredMark}>*</span></div>
                  <div className={styles.insertInputWrap}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="text" value={zipCode} placeholder="우편번호" readOnly
                          onClick={handleAddressSearch}
                          style={{ flex: "0 0 100px", cursor: "pointer", height: 36, borderRadius: 6, padding: "5px 10px", border: "1px solid var(--border-default)", background: "var(--surface-input)", color: "var(--text-primary)", fontSize: "var(--font-size-sm)" }} />
                        <button type="button" className={listStyles.placeAddBtn} onClick={handleAddressSearch} style={{ flexShrink: 0 }}>
                          주소 검색
                        </button>
                      </div>
                      <input type="text" value={address} placeholder="주소를 검색하세요" readOnly
                        onClick={handleAddressSearch}
                        className={fieldErrors.address ? styles.inputError : ""}
                        style={{ cursor: "pointer", width: "100%", height: 36, borderRadius: 6, padding: "5px 10px", border: `1px solid ${fieldErrors.address ? "var(--color-error-soft)" : "var(--border-default)"}`, background: "var(--surface-input)", color: "var(--text-primary)", fontSize: "var(--font-size-sm)" }} />
                      <input type="text" maxLength={100} value={addressDetail}
                        placeholder="상세주소 입력 (선택, 100자 이내)"
                        onChange={e => setAddressDetail(e.target.value)}
                        style={{ width: "100%", height: 36, borderRadius: 6, padding: "5px 10px", border: "1px solid var(--border-default)", background: "var(--surface-input)", color: "var(--text-primary)", fontSize: "var(--font-size-sm)" }} />
                    </div>
                    {fieldErrors.address && <div className={styles.errorMessage}>주소를 검색해주세요</div>}
                  </div>
                </div>
                {/* 회사 설명 (full width) */}
                <div className={styles.insertItemBox} style={{ gridColumn: "1 / -1" }}>
                  <div className={styles.insertItemLabel}>회사 설명</div>
                  <div className={styles.insertInputWrap}>
                    <textarea maxLength={200} value={description}
                      placeholder="200자 이내로 작성해 주세요."
                      onChange={e => setDescription(e.target.value)}
                      style={{ width: "100%", minHeight: 60, resize: "vertical", borderRadius: 6, padding: "10px 10px", border: "1px solid var(--border-default)", background: "var(--surface-input)", color: "var(--text-primary)", fontSize: "var(--font-size-sm)", fontFamily: "inherit" }} />
                  </div>
                </div>
              </div>
              {/* 버튼 - 등록 모달 스타일 */}
              <div className={styles.insertBtnTotal}>
                <button type="button" className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`}
                  onClick={mode === "create" || initialEditMode ? onClose : resetToView}>
                  <img src="/icon/close_btn.png" alt="cancel"/>
                  <span>취소</span>
                </button>
                <button type="button" className={`${styles.insertConfrimBtn} ${styles.btnBgBlue}`}
                  onClick={handleSave}>
                  <img src="/icon/check.png" alt="save" style={{ verticalAlign: "middle", flexShrink: 0 }} />
                  <span style={{ lineHeight: 1 }}>{mode === "create" ? "등록" : "저장"}</span>
                </button>
              </div>
            </>
          ) : (
            <div className={styles.detailInfoSection}>
              <h3 className={styles.detailSectionTitle}>기본 정보</h3>
              <div className={styles.detailInfoGrid}>
                {infoField("사업장명", null, business?.businessName ?? "-", true)}
                {infoField("대표명", null, business?.representName ?? "-", true)}
                {infoField("연락처", null, business?.contact || "-", true)}
                {infoField("등록일", null, business?.createdAt ?? "-", true)}
                <div className={`${styles.detailInfoRow} ${styles.detailInfoFull}`}>
                  <span className={styles.detailInfoLabel}>주소</span>
                  <span className={styles.detailInfoValue}>{fullAddressDisplay}</span>
                </div>
                {infoField("영역 수", null, `${business?.areaCount ?? 0}개`, true)}
                {infoField("로봇 수", null, `${business?.robotCount ?? 0}대`, true)}
                <div className={`${styles.detailInfoRow} ${styles.detailInfoFull}`}>
                  <span className={styles.detailInfoLabel}>회사 설명</span>
                  <span className={styles.detailInfoValue}>{business?.description || "-"}</span>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
