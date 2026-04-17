'use client';

import styles from './Modal.module.css';
import React, { useEffect, useState, useRef } from 'react';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import ConfirmOnlyModal from '@/app/components/modal/ConfirmOnlyModal';
import { apiFetch } from "@/app/lib/api";
import { useBatterySlider } from '@/app/hooks/useBatterySlider';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { useAlertModal } from '@/app/hooks/useAlertModal';

export default function RobotInsertModal({
    isOpen,
    onClose
}: { isOpen: boolean; onClose: () => void; }){

    const apiAlert = useAlertModal();

    // 성공 알림창
    const [saveSuccessOpen, setSaveSuccessOpen] = useState(false);

    // 로딩 상태
    const [isSubmitting, setIsSubmitting] = useState(false);

    useModalBehavior({ isOpen, onClose, disabled: isSubmitting });

    // 필드 에러 상태
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    // 409 중복 SN 에러 메시지
    const [snDuplicateMsg, setSnDuplicateMsg] = useState("");

    const MODEL_OPTIONS = ["Lynx M20", "Lynx M20 Pro"];

    const [robotName, setRobotName] = useState("");
    const [robotModel, setRobotModel] = useState("");
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const [robotSN, setRobotSN] = useState("");
    const [businessId, setBusinessId] = useState<number | null>(null);
    const [businessList, setBusinessList] = useState<{ id: number; name: string }[]>([]);
    const [bizDropdownOpen, setBizDropdownOpen] = useState(false);
    const bizDropdownRef = useRef<HTMLDivElement>(null);

    const [robotType, setRobotType] = useState("기본 4족");
    const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
    const typeDropdownRef = useRef<HTMLDivElement>(null);
    const ROBOT_TYPES = ["기본 4족", "순찰 4족", "보안 4족"];

    // S/W 버전
    const [swVersion, setSwVersion] = useState("");

    const battery = useBatterySlider({ min: 15, max: 30, defaultValue: 30 });

    // 드롭다운 외부 클릭 닫기
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (bizDropdownRef.current && !bizDropdownRef.current.contains(e.target as Node)) {
                setBizDropdownOpen(false);
            }
            if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
                setTypeDropdownOpen(false);
            }
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
                setModelDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleCancel = () => {
        if (isSubmitting) return;
        onClose();
    };

    const handleSave = async () => {
        if (isSubmitting) return;

        // 필수 필드 유효성 검증
        const newErrors: Record<string, boolean> = {};
        if (!robotName.trim()) newErrors.robotName = true;
        if (!robotModel.trim()) newErrors.robotModel = true;
        if (!robotSN.trim()) newErrors.robotSN = true;
        if (businessId == null) newErrors.businessId = true;
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        setIsSubmitting(true);
        setSnDuplicateMsg("");

        const payload = {
            robot_id: robotSN,
            robot_name: robotName,
            robot_model: robotModel,
            robot_type: robotType || "기본 4족",
            limit_battery: battery.value,
            business_id: businessId,
            sw_version: swVersion.trim() || undefined,
        };
        try {
            const res = await apiFetch(`/DB/RobotInsert`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            if (res.status === 409) {
                const data = await res.json();
                const msg = data.detail || "이미 등록된 시리얼 넘버입니다.";
                setSnDuplicateMsg(msg);
                setErrors((prev) => ({ ...prev, robotSN: true }));
                return;
            }
            if (!res.ok) {
                throw new Error("로봇 등록 실패");
            }

            setSaveSuccessOpen(true);
        } catch (err) {
            console.error(err);
            apiAlert.show("로봇 등록 중 오류가 발생했습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // 모달 오픈 시 전체 폼 초기화
    useEffect(() => {
        if (!isOpen) return;

        setRobotName("");
        setRobotModel("");
        setRobotSN("");
        setRobotType("기본 4족");
        setSwVersion("");
        setBusinessId(null);
        setBizDropdownOpen(false);
        setTypeDropdownOpen(false);
        setModelDropdownOpen(false);
        setErrors({});
        setSnDuplicateMsg("");
        setIsSubmitting(false);
        battery.reset();

        // 사업장 목록 조회
        apiFetch(`/DB/businesses?size=10000`)
            .then(res => {
                if (!res.ok) throw new Error("사업장 목록 조회 실패");
                return res.json();
            })
            .then(data => {
                console.log("사업장 목록:", data);
                const items = (data.items ?? []).map((b: any) => ({ id: b.id, name: b.BusinessName }));
                setBusinessList(items);
            })
            .catch((err) => {
                console.error("사업장 목록 오류:", err);
                setBusinessList([]);
            });
    }, [isOpen]);

    if (!isOpen) return null;

    const selectedBizName = businessList.find(b => b.id === businessId)?.name ?? "";

    return (
        <>
            <div className={styles.modalOverlay} onClick={isSubmitting ? undefined : onClose}>
                <div className={styles.insertModalContent} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.detailHeaderTop}>
                      <h2 style={{ fontWeight: 600, fontSize: "var(--font-size-xl)", color: "var(--text-primary)", margin: 0 }}>로봇 등록</h2>
                      <button className={styles.detailCloseBtn} onClick={handleCancel} disabled={isSubmitting} aria-label="닫기">✕</button>
                    </div>
                    <div className={styles.itemBoxContainer}>
                        {/* Row 1: 로봇명 / 로봇 타입 */}
                        <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>로봇명 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                                <input
                                    type="text"
                                    maxLength={20}
                                    value={robotName}
                                    onChange={(e) => { setRobotName(e.target.value); setErrors((p) => ({ ...p, robotName: false })); }}
                                    placeholder='20글자 이내로 작성해 주세요.'
                                    className={errors.robotName ? styles.inputError : ""}
                                    aria-label="로봇명"
                                    aria-invalid={errors.robotName || false}
                                />
                                {errors.robotName && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
                            </div>
                        </div>
                        <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>로봇 타입</div>
                            <div className={styles.insertInputWrap}>
                                <div
                                    ref={typeDropdownRef}
                                    className={styles.customSelectWrap}
                                >
                                    <button
                                        type="button"
                                        className={styles.customSelectTrigger}
                                        onClick={() => { setTypeDropdownOpen(prev => !prev); setBizDropdownOpen(false); setModelDropdownOpen(false); }}
                                        aria-label="로봇 타입"
                                    >
                                        <span style={{ color: robotType ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                                            {robotType}
                                        </span>
                                        <img className={styles.customSelectArrow} src={typeDropdownOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </button>
                                    {typeDropdownOpen && (
                                        <div className={styles.customSelectDropdown}>
                                            {ROBOT_TYPES.map((type) => (
                                                <div
                                                    key={type}
                                                    className={`${styles.customSelectItem} ${robotType === type ? styles.customSelectItemActive : ""}`}
                                                    onClick={() => {
                                                        setRobotType(type);
                                                        setTypeDropdownOpen(false);
                                                    }}
                                                >
                                                    {type}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        {/* Row 2: 모델 / 운영사 */}
                        <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>모델 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                                <div ref={modelDropdownRef} className={styles.customSelectWrap}>
                                    <button
                                        type="button"
                                        className={`${styles.customSelectTrigger} ${errors.robotModel ? styles.inputError : ""}`}
                                        onClick={() => { setModelDropdownOpen(prev => !prev); setBizDropdownOpen(false); setTypeDropdownOpen(false); }}
                                        aria-label="모델"
                                    >
                                        <span style={{ color: robotModel ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                                            {robotModel || "모델을 선택하세요"}
                                        </span>
                                        <img className={styles.customSelectArrow} src={modelDropdownOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </button>
                                    {modelDropdownOpen && (
                                        <div className={styles.customSelectDropdown}>
                                            {MODEL_OPTIONS.map((m) => (
                                                <div
                                                    key={m}
                                                    className={`${styles.customSelectItem} ${robotModel === m ? styles.customSelectItemActive : ""}`}
                                                    onClick={() => {
                                                        setRobotModel(m);
                                                        setModelDropdownOpen(false);
                                                        setErrors(p => ({ ...p, robotModel: false }));
                                                    }}
                                                >
                                                    {m}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {errors.robotModel && <div className={styles.errorMessage}>필수 선택 항목입니다.</div>}
                            </div>
                        </div>
                        <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>운영사 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                                <div
                                    ref={bizDropdownRef}
                                    className={styles.customSelectWrap}
                                >
                                    <button
                                        type="button"
                                        className={`${styles.customSelectTrigger} ${errors.businessId ? styles.inputError : ""}`}
                                        onClick={() => { setBizDropdownOpen(prev => !prev); setTypeDropdownOpen(false); setModelDropdownOpen(false); }}
                                        aria-label="운영사"
                                    >
                                        <span style={{ color: selectedBizName ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                                            {selectedBizName || "운영사를 선택하세요"}
                                        </span>
                                        <img className={styles.customSelectArrow} src={bizDropdownOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </button>
                                    {bizDropdownOpen && (
                                        <div className={styles.customSelectDropdown}>
                                            {businessList.length === 0 ? (
                                                <div className={styles.customSelectItem} style={{ color: "var(--text-muted)" }}>등록된 사업자가 없습니다</div>
                                            ) : (
                                                businessList.map((b) => (
                                                    <div
                                                        key={b.id}
                                                        className={`${styles.customSelectItem} ${businessId === b.id ? styles.customSelectItemActive : ""}`}
                                                        onClick={() => {
                                                            setBusinessId(b.id);
                                                            setBizDropdownOpen(false);
                                                            setErrors(p => ({ ...p, businessId: false }));
                                                        }}
                                                    >
                                                        {b.name}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                                {errors.businessId && <div className={styles.errorMessage}>필수 선택 항목입니다.</div>}
                            </div>
                        </div>
                        {/* Row 3: 시리얼 번호 / S/W 버전 */}
                        <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>시리얼 번호 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                                <input
                                    type="text"
                                    maxLength={20}
                                    value={robotSN}
                                    onChange={(e) => { setRobotSN(e.target.value); setErrors((p) => ({ ...p, robotSN: false })); setSnDuplicateMsg(""); }}
                                    placeholder='20글자 이내로 작성해 주세요.'
                                    className={errors.robotSN ? styles.inputError : ""}
                                    aria-label="시리얼 번호"
                                    aria-invalid={errors.robotSN || false}
                                />
                                {errors.robotSN && (
                                    <div className={styles.errorMessage}>
                                        {snDuplicateMsg || "필수 입력 항목입니다."}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>S/W 버전</div>
                            <div className={styles.insertInputWrap}>
                                <input
                                    type="text"
                                    maxLength={20}
                                    value={swVersion}
                                    onChange={(e) => setSwVersion(e.target.value)}
                                    placeholder='예: 1.0.0'
                                    aria-label="S/W 버전"
                                />
                            </div>
                        </div>
                        {/* Row 4: 복귀 배터리양 */}
                        <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>복귀 배터리양 <span className={styles.batteryCurrentValue}>{battery.value}%</span></div>
                            <div className={styles.batterySliderWrap}>
                                <div className={styles.batterySliderTrackArea}>
                                    <input
                                        className={styles.batterySlider}
                                        type="range"
                                        min={battery.min}
                                        max={battery.max}
                                        step={1}
                                        value={battery.value}
                                        onChange={battery.handleSliderChange}
                                        aria-label="복귀 배터리양 조정"
                                        style={{ ['--percent' as any]: `${battery.sliderPercent}%` }}
                                    />
                                </div>
                                <div className={styles.batterySliderLabels}>
                                    <span>{battery.min}%</span>
                                    <span>{battery.max}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className={styles.insertBtnTotal}>
                        <button
                            type="button"
                            className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`}
                            onClick={handleCancel}
                            disabled={isSubmitting}
                        >
                            <img src="/icon/close_btn.png" alt="cancel"/>
                            <div>취소</div>
                        </button>
                        <button
                            type="button"
                            className={`${styles.insertConfrimBtn} ${styles.btnBgBlue} ${isSubmitting ? styles.btnDisabled : ""}`}
                            onClick={handleSave}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <div className={styles.btnSpinner} />
                            ) : (
                                <img src="/icon/check.png" alt="save" />
                            )}
                            <div>{isSubmitting ? "저장 중..." : "저장"}</div>
                        </button>
                    </div>
                </div>
            </div>
            {battery.alertOpen && (
                <CancelConfirmModal
                    message={battery.alertMsg}
                    onConfirm={battery.closeAlert}
                    onCancel={battery.closeAlert}
                />
            )}
            {apiAlert.isOpen && (
                <ConfirmOnlyModal
                    message={apiAlert.message}
                    onConfirm={apiAlert.close}
                />
            )}
            {saveSuccessOpen && (
                <ConfirmOnlyModal
                    message="로봇이 등록되었습니다."
                    onConfirm={() => {
                        setSaveSuccessOpen(false);
                        onClose();
                        window.location.reload();
                    }}
                />
            )}
        </>
    );

}
