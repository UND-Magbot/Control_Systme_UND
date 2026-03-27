"use client";

import React, { useState, useEffect, useRef } from 'react';
import styles from '@/app/components/modal/Modal.module.css';
import listStyles from './RobotList.module.css';
import type { BusinessItem, AreaItem } from './BusinessList';
import { API_BASE } from "@/app/config";

const FLOOR_PRESETS = [
  ...["B5", "B4", "B3", "B2", "B1"],
  ...Array.from({ length: 20 }, (_, i) => `${i + 1}F`),
  "옥상", "PH",
];

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
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 폼 필드
  const [name, setName] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [representName, setRepresentName] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");

  // 영역
  const [areaRows, setAreaRows] = useState<AreaItem[]>([]);
  const [areaLoading, setAreaLoading] = useState(false);
  const [floorDropdownOpen, setFloorDropdownOpen] = useState(false);
  const floorDropdownRef = useRef<HTMLDivElement>(null);

  // ── 초기화 ──
  useEffect(() => {
    if (!isOpen) return;
    if (mode === "create") {
      setIsEditMode(true);
      resetForm();
      setBusiness(null);
      setAreaRows([]);
    } else if (businessId != null) {
      setIsEditMode(initialEditMode);
      fetchBusiness(businessId);
      fetchAreas(businessId);
    }
    setErrors({});
    setFloorDropdownOpen(false);
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

  // 층 드롭다운 외부 클릭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (floorDropdownRef.current && !floorDropdownRef.current.contains(e.target as Node)) setFloorDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
    setErrors({});
  };

  // ── API ──
  const fetchBusiness = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/DB/businesses/${id}`);
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
        addDate: d.Adddate ? new Date(d.Adddate).toLocaleDateString("ko-KR") : "-",
      };
      setBusiness(item);
      populateForm(item);
    } catch { /* ignore */ }
  };

  const fetchAreas = async (id: number) => {
    setAreaLoading(true);
    try {
      const res = await fetch(`${API_BASE}/DB/businesses/${id}/areas`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAreaRows(data.map((a: any) => ({
        id: a.id, businessId: a.BusinessId,
        floorName: a.FloorName ?? "",
        addDate: a.Adddate ? new Date(a.Adddate).toLocaleDateString("ko-KR") : "-",
      })));
    } catch { setAreaRows([]); }
    finally { setAreaLoading(false); }
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
        setErrors((p) => ({ ...p, address: "" }));
      },
    }).open();
  };

  // ── 저장 ──
  const handleSave = async () => {
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = "사업자명을 입력해주세요";
    if (!address.trim()) err.address = "주소를 검색해주세요";
    setErrors(err);
    if (Object.keys(err).length > 0) return;

    const payload = {
      BusinessName: name.trim(),
      ZipCode: zipCode, Address: address, AddressDetail: addressDetail.trim(),
      RepresentName: representName.trim() || null,
      Contact: contact.trim() || null,
      Description: description.trim() || null,
    };

    try {
      const url = mode === "create"
        ? `${API_BASE}/DB/businesses`
        : `${API_BASE}/DB/businesses/${businessId}`;
      const res = await fetch(url, {
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

  // ── 영역 추가/삭제 ──
  const handleAddArea = async (floorName: string) => {
    if (!businessId) return;
    try {
      const res = await fetch(`${API_BASE}/DB/businesses/${businessId}/areas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BusinessId: businessId, FloorName: floorName }),
      });
      if (!res.ok) return;
      await fetchAreas(businessId);
      onSaved();
    } catch { /* ignore */ }
    setFloorDropdownOpen(false);
  };

  const handleDeleteArea = async (areaId: number) => {
    try {
      await fetch(`${API_BASE}/DB/areas/${areaId}`, { method: "DELETE" });
      if (businessId) { await fetchAreas(businessId); onSaved(); }
    } catch { /* ignore */ }
  };

  const registeredFloors = new Set(areaRows.map((a) => a.floorName));

  if (!isOpen) return null;

  // ── 렌더 헬퍼 ──
  const infoRow = (label: string, value: string, full?: boolean) => (
    <div className={`${styles.detailInfoRow} ${full ? styles.detailInfoFull : ""}`}>
      <span className={styles.detailInfoLabel}>{label}</span>
      <span className={styles.detailInfoValue}>{value || "-"}</span>
    </div>
  );

  const editField = (
    label: string, value: string, setter: (v: string) => void,
    opts?: { required?: boolean; placeholder?: string; maxLength?: number; full?: boolean; readOnly?: boolean; multiline?: boolean; errorKey?: string }
  ) => (
    <div className={`${styles.detailInfoRow} ${opts?.full ? styles.detailInfoFull : ""}`}>
      <span className={styles.detailInfoLabel}>{label}{opts?.required ? " *" : ""}</span>
      <span className={styles.detailInfoValue}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: "100%" }}>
          {opts?.multiline ? (
            <textarea
              className={styles.detailInfoInput}
              maxLength={opts?.maxLength}
              value={value}
              placeholder={opts?.placeholder}
              readOnly={opts?.readOnly}
              onChange={(e) => { setter(e.target.value); if (opts?.errorKey) setErrors((p) => ({ ...p, [opts.errorKey!]: "" })); }}
              style={{ minHeight: 60, resize: "vertical", ...(opts?.errorKey && errors[opts.errorKey] ? { borderColor: "var(--color-error)" } : {}) }}
            />
          ) : (
            <input
              className={styles.detailInfoInput}
              type="text"
              maxLength={opts?.maxLength}
              value={value}
              placeholder={opts?.placeholder}
              readOnly={opts?.readOnly}
              onChange={(e) => { setter(e.target.value); if (opts?.errorKey) setErrors((p) => ({ ...p, [opts.errorKey!]: "" })); }}
              style={opts?.errorKey && errors[opts.errorKey] ? { borderColor: "var(--color-error)" } : undefined}
            />
          )}
          {opts?.errorKey && errors[opts.errorKey] && (
            <span style={{ fontSize: 11, color: "var(--color-error-soft)", marginTop: 2 }}>{errors[opts.errorKey]}</span>
          )}
        </div>
      </span>
    </div>
  );

  // 주소 표시 (조회 모드)
  const fullAddressDisplay = [business?.zipCode, business?.address, business?.addressDetail].filter(Boolean).join(" ") || "-";

  return (
    <div className={styles.modalOverlay} onClick={mode === "create" ? onClose : undefined}>
      <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderTop}>
            <h2>
              {mode === "create" ? "사업자 등록"
                : `${business?.businessName ?? "사업자"} ${isEditMode ? "수정" : "상세정보"}`}
            </h2>
            <button className={styles.detailCloseBtn} onClick={onClose} aria-label="닫기">✕</button>
          </div>
          {mode === "view" && (
            <div className={styles.detailModeTabs}>
              <button className={`${styles.detailModeTab} ${!isEditMode ? styles.detailModeTabActive : ""}`} onClick={resetToView}>조회</button>
              <button className={`${styles.detailModeTab} ${isEditMode ? styles.detailModeTabActive : ""}`} onClick={() => setIsEditMode(true)}>수정</button>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className={styles.detailBody} style={{ maxHeight: "calc(80vh - 140px)", overflowY: "auto" }}>

          {/* 기본 정보 */}
          <div className={styles.detailInfoSection}>
            <h3 className={styles.detailSectionTitle}>기본 정보</h3>
            <div className={styles.detailInfoGrid}>
              {isEditMode ? (
                <>
                  {editField("사업자명", name, setName, { required: true, maxLength: 100, placeholder: "사업자명을 입력하세요", full: true, errorKey: "name" })}

                  {/* 주소 (우편번호 + 주소1 + 주소2) */}
                  <div className={`${styles.detailInfoRow} ${styles.detailInfoFull}`}>
                    <span className={styles.detailInfoLabel}>주소 *</span>
                    <span className={styles.detailInfoValue}>
                      <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: 6 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input className={styles.detailInfoInput} type="text" value={zipCode} placeholder="우편번호" readOnly style={{ width: 90, cursor: "pointer" }} onClick={handleAddressSearch} />
                          <button type="button" className={listStyles.placeAddBtn} onClick={handleAddressSearch} style={{ width: 90, flexShrink: 0 }}>주소 검색</button>
                        </div>
                        <input
                          className={styles.detailInfoInput} type="text" value={address} placeholder="주소를 검색하세요" readOnly
                          style={{ cursor: "pointer", ...(errors.address ? { borderColor: "var(--color-error)" } : {}) }}
                          onClick={handleAddressSearch}
                        />
                        <input className={styles.detailInfoInput} type="text" maxLength={100} value={addressDetail} placeholder="상세주소 입력 (선택)" onChange={(e) => setAddressDetail(e.target.value)} />
                        {errors.address && <span style={{ fontSize: 11, color: "var(--color-error-soft)", marginTop: 2, alignSelf: "flex-end" }}>{errors.address}</span>}
                      </div>
                    </span>
                  </div>

                  {editField("대표명", representName, setRepresentName, { maxLength: 50, placeholder: "대표명을 입력하세요" })}
                  {editField("연락처", contact, setContact, { maxLength: 30, placeholder: "연락처를 입력하세요" })}
                  {editField("회사 설명", description, setDescription, { maxLength: 500, placeholder: "회사 설명을 입력하세요", full: true, multiline: true })}
                </>
              ) : (
                <>
                  {infoRow("사업자명", business?.businessName ?? "")}
                  {infoRow("주소", fullAddressDisplay, true)}
                  {infoRow("대표명", business?.representName ?? "")}
                  {infoRow("연락처", business?.contact ?? "")}
                  {infoRow("회사 설명", business?.description ?? "", true)}
                  {infoRow("영역 수", `${business?.areaCount ?? 0}개`)}
                  {infoRow("로봇 수", `${business?.robotCount ?? 0}대`)}
                  {infoRow("등록일", business?.addDate ?? "", true)}
                </>
              )}
            </div>
          </div>

          {/* 영역(층) 관리 — 조회 모드에서만 */}
          {mode === "view" && !isEditMode && (
            <div className={styles.detailInfoSection}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 className={styles.detailSectionTitle} style={{ margin: 0 }}>영역(층) 관리</h3>
                <div ref={floorDropdownRef} style={{ position: "relative" }}>
                  <button className={listStyles.placeAddBtn} onClick={() => setFloorDropdownOpen((p) => !p)}>
                    <img src="/icon/check.png" alt="" />영역 추가
                  </button>
                  {floorDropdownOpen && (
                    <div className={styles.customSelectDropdown} style={{ right: 0, left: "auto", width: 140, maxHeight: 220 }}>
                      {FLOOR_PRESETS.map((floor) => {
                        const disabled = registeredFloors.has(floor);
                        return (
                          <div
                            key={floor}
                            className={`${styles.customSelectItem} ${disabled ? styles.customSelectItemDisabled : ""}`}
                            onClick={() => { if (!disabled) handleAddArea(floor); }}
                          >
                            {floor}{disabled ? " (등록됨)" : ""}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className={listStyles.areaList}>
                {areaRows.length === 0 && !areaLoading && (
                  <div className={listStyles.emptyState} style={{ padding: "24px 0" }}>등록된 영역이 없습니다.</div>
                )}
                {areaRows.map((area) => (
                  <div key={area.id} className={listStyles.areaItem}>
                    <span>{area.floorName}</span>
                    <span className={listStyles.areaDate}>{area.addDate}</span>
                    <button className={listStyles.areaDeleteBtn} onClick={() => handleDeleteArea(area.id)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 엘리베이터 등록 — 조회 모드에서만 */}
          {mode === "view" && !isEditMode && (
            <div className={styles.detailInfoSection}>
              <h3 className={styles.detailSectionTitle}>엘리베이터 등록</h3>
              <div className={listStyles.emptyState} style={{ padding: "24px 0" }}>엘리베이터 등록 기능은 준비 중입니다.</div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {isEditMode && (
          <div className={styles.detailFooter}>
            <div className={styles.btnRightBox}>
              <button type="button" className={`${styles.btnItemCommon} ${styles.btnBgRed}`} onClick={mode === "view" ? resetToView : onClose}>
                <span className={styles.btnIcon}><img src="/icon/close_btn.png" alt="" /></span>
                <span>취소</span>
              </button>
              <button type="button" className={`${styles.btnItemCommon} ${styles.btnBgBlue}`} onClick={handleSave}>
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
