'use client';

import styles from './Modal.module.css';
import React, { useEffect, useState } from 'react';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { getApiBase } from "@/app/config";
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

    const [robotName, setRobotName] = useState("");
    const [robotModel, setRobotModel] = useState("");
    const [robotSN, setRobotSN] = useState("");

    const battery = useBatterySlider({ min: 15, max: 30, defaultValue: 30 });

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
            limit_battery: battery.value
        };
        try {
            const res = await fetch(`${getApiBase()}/DB/RobotInsert`, {
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
        setErrors({});
        setSnDuplicateMsg("");
        setIsSubmitting(false);
        battery.reset();
    }, [isOpen]);

    if (!isOpen) return null;

    const isFormEmpty = !robotName.trim() || !robotModel.trim() || !robotSN.trim();

    return (
        <>
            <div className={styles.modalOverlay} onClick={isSubmitting ? undefined : onClose}>
                <div className={styles.insertModalContent} onClick={(e) => e.stopPropagation()}>
                    <button className={styles.insertCloseBtn} onClick={handleCancel} disabled={isSubmitting} aria-label="닫기">✕</button>
                    <div className={styles.insertTitle}>
                        <img src="/icon/robot_status_w.png" alt="Robot Registeration" />
                        <h2>로봇 등록</h2>
                    </div>
                    <div className={styles.itemBoxContainer}>
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
                            <div className={styles.insertItemLabel}>모델 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                                <input
                                    type="text"
                                    maxLength={20}
                                    value={robotModel}
                                    onChange={(e) => { setRobotModel(e.target.value); setErrors((p) => ({ ...p, robotModel: false })); }}
                                    placeholder='20글자 이내로 작성해 주세요.'
                                    className={errors.robotModel ? styles.inputError : ""}
                                    aria-label="모델"
                                    aria-invalid={errors.robotModel || false}
                                />
                                {errors.robotModel && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
                            </div>
                        </div>
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
                            <div className={styles.insertItemLabel}>복귀 배터리양</div>
                            <input type="text"
                                inputMode="numeric"
                                value={battery.text}
                                onChange={battery.handleInputChange}
                                onBlur={battery.validateAndFix}
                                onKeyDown={battery.handleInputKeyDown}
                                placeholder='아래 조정바로 설정하거나 15~30사이의 숫자만 기입 (%제외)'
                                aria-label="복귀 배터리양"
                            />
                        </div>
                        <div className={styles.slidebarinsert}>
                            <div className={styles.insertItemLabel} />
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
                            className={`${styles.insertConfrimBtn} ${styles.btnBgBlue} ${(isSubmitting || isFormEmpty) ? styles.btnDisabled : ""}`}
                            onClick={handleSave}
                            disabled={isSubmitting || isFormEmpty}
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
                <CancelConfirmModal
                    message={apiAlert.message}
                    onConfirm={apiAlert.close}
                    onCancel={apiAlert.close}
                />
            )}
            {saveSuccessOpen && (
                <CancelConfirmModal
                    message="로봇이 등록되었습니다."
                    onConfirm={() => {
                        setSaveSuccessOpen(false);
                        onClose();
                        window.location.reload();
                    }}
                    onCancel={() => {
                        setSaveSuccessOpen(false);
                        onClose();
                        window.location.reload();
                    }}
                />
            )}
        </>
    );

}
