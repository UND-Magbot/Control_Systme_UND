'use client';

import styles from './Modal.module.css';
import React, { useState, useEffect } from 'react';
import type { RobotRowData } from '@/app/type';
import type { RobotDraft } from "@/app/(pages)/robots/components/RobotList";
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { API_BASE } from "@/app/config";
import { useBatterySlider } from '@/app/hooks/useBatterySlider';
import { useAlertModal } from '@/app/hooks/useAlertModal';

type DetailModalProps = {
    isOpen: boolean;
    onClose: () => void;
    selectedRobotId: number | null;
    selectedRobot: RobotRowData | null;
    robots: RobotRowData[];

    persistedDraft?: RobotDraft;
    onPersistDraft?: (robotId: number, next: RobotDraft) => void;
}

export default function RobotDetailModal({
    isOpen,
    onClose,
    selectedRobotId,
    selectedRobot,
    robots
}:DetailModalProps ){

    const [robotDetail, setRobotDetail] = useState<RobotRowData | null>(null);

    // B-1: 로딩 / 에러 상태
    const [isLoading, setIsLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        if (selectedRobotId == null) return;
        if (!selectedRobot) return;

        setIsLoading(true);
        setFetchError(null);

        fetch(`${API_BASE}/DB/robots/${selectedRobotId}`)
            .then((res) => {
                if (!res.ok) {
                    throw new Error("로봇 상세 조회 실패");
                }
                return res.json();
            })
            .then((data) => {
                const limitBattery = data.LimitBattery ?? DEFAULT_RETURN_BATTERY;
                const detail = {
                    ...selectedRobot,
                    id: data.id ?? selectedRobot.id,
                    no: data.RobotName,
                    operator: data.ProductCompany ?? selectedRobot.operator,
                    serialNumber: data.SerialNumber ?? selectedRobot.serialNumber,
                    model: data.ModelName ?? selectedRobot.model,
                    group: data.Group ?? selectedRobot.group,
                    softwareVersion: data.SWversion ?? selectedRobot.softwareVersion,
                    site: data.Site ?? selectedRobot.site,
                    registrationDateTime: data.Adddate ?? selectedRobot.registrationDateTime,
                    return: data.LimitBattery ?? selectedRobot.return ?? DEFAULT_RETURN_BATTERY,
                    };

                setRobotDetail(detail);

                setDraft({
                    operator: detail.operator,
                    serialNumber: detail.serialNumber,
                    model: detail.model,
                    group: detail.group,
                    softwareVersion: detail.softwareVersion,
                    site: detail.site,
                    registrationDateTime: detail.registrationDateTime,
                    returnBattery: detail.return ?? DEFAULT_RETURN_BATTERY,
                    });
                // 배터리 UI 동기화
                battery.reset(limitBattery);
            })
            .catch((err) => {
                console.error("robot detail fetch error:", err);
                setFetchError("로봇 정보를 불러오는 데 실패했습니다.");
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [isOpen, selectedRobotId]);


    const [showConfirm, setShowConfirm] = useState(false);

    const [saveSuccessOpen, setSaveSuccessOpen] = useState(false);

    // B-3: API 에러 알림창 (alert 대체)
    const apiAlert = useAlertModal();

    const [isEditMode, setIsEditMode] = useState(false);

    // B-4: 저장/삭제 중복 제출 방지
    const [isSubmitting, setIsSubmitting] = useState(false);

    const DEFAULT_RETURN_BATTERY = 30;

    type RobotDraft = {
    operator: string;
    serialNumber: string;
    model: string;
    group: string;
    softwareVersion: string;
    site: string;
    registrationDateTime: string;
    // 복귀 배터리(현재 RobotRowData에 없어서 안전 처리)
    returnBattery: number;
    };

    const [draft, setDraft] = useState<RobotDraft>({
    operator: "",
    serialNumber: "",
    model: "",
    group: "",
    softwareVersion: "",
    site: "",
    registrationDateTime: "",
    returnBattery: DEFAULT_RETURN_BATTERY,
    });

    const battery = useBatterySlider({ min: 15, max: 30, defaultValue: DEFAULT_RETURN_BATTERY });


    // B-9: ESC 키 동작 - 수정 모드에서는 보기 모드로 전환, 보기 모드에서는 모달 닫기
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isSubmitting) return;
                if (isEditMode) {
                    handleCancel();
                } else {
                    onClose();
                }
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden'; // 스크롤 방지
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
        }, [isOpen, onClose, isEditMode, isSubmitting]);

    if (!isOpen) return null;
    if (!selectedRobot) return null;

    // 삭제 버튼 클릭 핸들러
    const handleDelete = () => {
      setShowConfirm(true);   // 커스텀 confirm 열기
    };

    // 삭제 재 확인 창 - confirm 창에서 확인 눌렀을 때
    const handleConfirmOk = async () => {
        if (!selectedRobotId) return;
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            const res = await fetch(
            `${API_BASE}/DB/robots/${selectedRobotId}`,
            { method: "DELETE" }
            );

            if (!res.ok) {
            throw new Error("로봇 삭제 실패");
            }

            setShowConfirm(false);
            onClose();
            window.location.reload();
        } catch (err) {
            console.error("robot delete error:", err);
            setShowConfirm(false);
            apiAlert.show("로봇 삭제에 실패했습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

     // 삭제 재 확인 창 - confirm 창만 닫기
    const handleConfirmCancel = () => {
      setShowConfirm(false);
    };

    const handleUdate = () => {
        setIsEditMode(true);
    };


    const handleCancel = () => {
    // 1) 선택 로봇 값으로 draft 되돌리기
    const rb =
        ((robotDetail ?? selectedRobot) as any)?.returnBattery ??
        ((robotDetail ?? selectedRobot) as any)?.return ??
        DEFAULT_RETURN_BATTERY;

    setDraft({
        operator: (robotDetail ?? selectedRobot)?.operator ?? "",
        serialNumber: (robotDetail ?? selectedRobot)?.serialNumber ?? "",
        model: (robotDetail ?? selectedRobot)?.model ?? "",
        group: (robotDetail ?? selectedRobot)?.group ?? "",
        softwareVersion: (robotDetail ?? selectedRobot)?.softwareVersion ?? "",
        site: (robotDetail ?? selectedRobot)?.site ?? "",
        registrationDateTime: (robotDetail ?? selectedRobot)?.registrationDateTime ?? "",
        returnBattery: typeof rb === "number" ? rb : DEFAULT_RETURN_BATTERY,
    });

    // 2) 배터리 입력 UI도 원복
    battery.commitByNumber(typeof rb === "number" ? rb : DEFAULT_RETURN_BATTERY);

    // 3) 모달 닫지 않고 "보기모드"로만 전환
    setIsEditMode(false);
    };

    const handleSave = async () => {
        if (isSubmitting) return;

        const ok = battery.validateAndFix();
        if (!ok) return;

        const rb = battery.value;

        const payload = {
            operator: draft.operator,
            serialNumber: draft.serialNumber,
            model: draft.model,
            group: draft.group,
            softwareVersion: draft.softwareVersion,
            site: draft.site,
            limit_battery: rb,
        };

        setIsSubmitting(true);
        try {
            const res = await fetch(
            `${API_BASE}/DB/robots/${selectedRobotId}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }
            );

            if (!res.ok) throw new Error("로봇 정보 수정 실패");

            // 1. 화면에 쓰이는 robotDetail 갱신
            setRobotDetail((prev) =>
            prev
                ? {
                    ...prev,
                    operator: payload.operator,
                    serialNumber: payload.serialNumber,
                    model: payload.model,
                    group: payload.group,
                    softwareVersion: payload.softwareVersion,
                    site: payload.site,
                    return: rb,
                }
                : prev
            );

            // 2. draft도 동기화
            setDraft((p) => ({ ...p, returnBattery: rb }));

            // 3. 보기모드 전환
            setIsEditMode(false);

            // 4. 저장 완료 알림
            setSaveSuccessOpen(true);
        } catch (err) {
            console.error("robot update error:", err);
            apiAlert.show("로봇 정보 저장에 실패했습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // B-5: 수정 불가 필드 식별용 클래스
    const readonlyContentClass = `${styles.itemContentBox} ${isEditMode ? styles.readonlyField : ""}`;

    return (
        <>
        <div className={styles.modalOverlay} onClick={isSubmitting ? undefined : onClose}>
            <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>
                <button className={styles.detailCloseBtn} onClick={onClose} disabled={isSubmitting} aria-label="닫기">✕</button>
                <div className={styles.detailTitle}>
                    <img src="/icon/robot_status_w.png" alt="로봇 정보" />
                    <h2>로봇 정보</h2>
                </div>

                {/* B-1: 로딩 상태 */}
                {isLoading && (
                    <div className={styles.detailLoadingWrap}>
                        <div className={styles.detailSpinner} />
                        <span>로봇 정보를 불러오는 중...</span>
                    </div>
                )}

                {/* B-2: fetch 에러 상태 */}
                {!isLoading && fetchError && (
                    <div className={styles.detailErrorWrap}>
                        <span>{fetchError}</span>
                        <button
                            type="button"
                            className={`${styles.btnItemCommon} ${styles.btnBgGray}`}
                            onClick={() => {
                                setFetchError(null);
                                setIsLoading(true);
                                fetch(`${API_BASE}/DB/robots/${selectedRobotId}`)
                                    .then(res => { if (!res.ok) throw new Error(); return res.json(); })
                                    .then(data => {
                                        const limitBattery = data.LimitBattery ?? DEFAULT_RETURN_BATTERY;
                                        const detail = {
                                            ...selectedRobot,
                                            id: data.id ?? selectedRobot.id,
                                            no: data.RobotName,
                                            operator: data.ProductCompany ?? selectedRobot.operator,
                                            serialNumber: data.SerialNumber ?? selectedRobot.serialNumber,
                                            model: data.ModelName ?? selectedRobot.model,
                                            group: data.Group ?? selectedRobot.group,
                                            softwareVersion: data.SWversion ?? selectedRobot.softwareVersion,
                                            site: data.Site ?? selectedRobot.site,
                                            registrationDateTime: data.Adddate ?? selectedRobot.registrationDateTime,
                                            return: data.LimitBattery ?? selectedRobot.return ?? DEFAULT_RETURN_BATTERY,
                                        };
                                        setRobotDetail(detail);
                                        setDraft({
                                            operator: detail.operator, serialNumber: detail.serialNumber,
                                            model: detail.model, group: detail.group,
                                            softwareVersion: detail.softwareVersion, site: detail.site,
                                            registrationDateTime: detail.registrationDateTime,
                                            returnBattery: detail.return ?? DEFAULT_RETURN_BATTERY,
                                        });
                                        battery.reset(limitBattery);
                                    })
                                    .catch(() => setFetchError("로봇 정보를 불러오는 데 실패했습니다."))
                                    .finally(() => setIsLoading(false));
                            }}
                        >
                            <span>다시 시도</span>
                        </button>
                    </div>
                )}

                {/* 데이터 로드 완료 시 표시 */}
                {!isLoading && !fetchError && (
                <>
                <div className={`${styles.detailItemBoxContainer} ${styles.detailBoxFs} ${isEditMode ? styles.editMode : ""}`}>

                {/* 1. Robot Type(Name) / Operator */}
                <div className={`${styles.detailRowItemBox} ${styles.btnBline}`}>
                    <div className={`${styles.detailItemBox} ${styles.detailItemBoxBorderRight}`}>
                        <div className={styles.itemTitleBox}>
                            로봇명
                        </div>
                        <div className={readonlyContentClass}>
                            {selectedRobot
                            ? `${(robotDetail ?? selectedRobot).group} (${(robotDetail ?? selectedRobot).no})`
                            : "-"}
                        </div>
                    </div>

                    <div className={styles.detailItemBox}>
                    <div className={styles.itemTitleBox}>운영사</div>
                    <div className={styles.itemContentBox}>
                        {isEditMode ? (
                            <input
                            className={styles.editInput}
                            type="text"
                            maxLength={20}
                            value={draft.operator}
                            placeholder='20글자 이내로 작성 (40byte 이내)'
                            onChange={(e) => setDraft((p) => ({ ...p, operator: e.target.value }))}
                            />
                        ) : (
                            ((robotDetail ?? selectedRobot)?.operator ?? "-")
                        )}
                    </div>
                    </div>
                </div>

                {/* 2. Serial Number / Model */}
                <div className={`${styles.detailRowItemBox} ${styles.btnBline}`}>
                    <div className={`${styles.detailItemBox} ${styles.detailItemBoxBorderRight}`}>
                    <div className={styles.itemTitleBox}>시리얼 번호(SN)</div>
                    <div className={`${styles.itemContentBox}`}>
                        {isEditMode ? (
                            <input
                            className={styles.editInput}
                            type="text"
                            maxLength={20}
                            value={draft.serialNumber}
                            placeholder='20글자 이내로 작성 (40byte 이내)'
                            onChange={(e) => setDraft((p) => ({ ...p, serialNumber: e.target.value }))}
                            />
                        ) : (
                            ((robotDetail ?? selectedRobot)?.serialNumber ?? "-")
                        )}
                    </div>
                    </div>

                    <div className={styles.detailItemBox}>
                    <div className={styles.itemTitleBox}>모델</div>
                    <div className={`${styles.itemContentBox}`}>
                        {isEditMode ? (
                            <input
                            className={styles.editInput}
                            type="text"
                            maxLength={20}
                            value={draft.model}
                            placeholder='20글자 이내로 작성 (40byte 이내)'
                            onChange={(e) => setDraft((p) => ({ ...p, model: e.target.value }))}
                            />
                        ) : (
                            ((robotDetail ?? selectedRobot)?.model ?? "-")
                        )}
                    </div>
                    </div>
                </div>

                {/* 3. Group / Software Version */}
                <div className={`${styles.detailRowItemBox} ${styles.btnBline}`}>
                    <div className={`${styles.detailItemBox} ${styles.detailItemBoxBorderRight}`}>
                    <div className={styles.itemTitleBox}>그룹</div>
                    <div className={`${styles.itemContentBox}`}>
                        {isEditMode ? (
                            <input
                            className={styles.editInput}
                            type="text"
                            maxLength={20}
                            value={draft.group}
                            placeholder='20글자 이내로 작성 (40byte 이내)'
                            onChange={(e) => setDraft((p) => ({ ...p, group: e.target.value }))}
                            />
                        ) : (
                            ((robotDetail ?? selectedRobot)?.group ?? "-")
                        )}
                    </div>
                    </div>

                    <div className={styles.detailItemBox}>
                    <div className={styles.itemTitleBox}>소프트웨어 버전</div>
                    <div className={`${styles.itemContentBox}`}>
                        {isEditMode ? (
                            <input
                            className={styles.editInput}
                            type="text"
                            maxLength={20}
                            value={draft.softwareVersion}
                            placeholder='20글자 이내로 작성 (40byte 이내)'
                            onChange={(e) => setDraft((p) => ({ ...p, softwareVersion: e.target.value }))}
                            />
                        ) : (
                            ((robotDetail ?? selectedRobot)?.softwareVersion ?? "-")
                        )}
                    </div>
                    </div>
                </div>

                {/* 4. Site / Robot Registration Date/Time */}
                <div className={`${styles.detailRowItemBox} ${styles.btnBline}`}>
                    <div className={`${styles.detailItemBox} ${styles.detailItemBoxBorderRight}`}>
                        <div className={`${styles.itemTitleBox}`}>
                            사이트
                        </div>
                        <div className={`${styles.itemContentBox}`}>
                            {isEditMode ? (
                                <input
                                className={styles.editInput}
                                type="text"
                                maxLength={20}
                                value={draft.site}
                                placeholder='20글자 이내로 작성 (40byte 이내)'
                                onChange={(e) => setDraft((p) => ({ ...p, site: e.target.value }))}
                                />
                            ) : (
                                ((robotDetail ?? selectedRobot)?.site ?? "-")
                            )}
                        </div>
                    </div>

                    <div className={styles.detailItemBox}>
                    <div className={styles.itemTitleBox}>
                        로봇 등록 일시
                    </div>
                    <div className={readonlyContentClass}>
                        {(robotDetail ?? selectedRobot)?.registrationDateTime ?? "-"}
                    </div>
                    </div>
                </div>

                {/* 5. Battery */}
                <div className={styles.detailRowBattery}>
                    <div className={`${styles.detailItemBox} ${styles.detailItemBoxBorderRight}`}>
                        <div className={styles.itemTitleBox}>
                            복귀 배터리양
                        </div>
                        <div className={`${styles.itemContentBox} ${styles.batteryBar}`}>
                            {isEditMode ? (
                                <input
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                value={battery.text}
                                onChange={battery.handleInputChange}
                                onBlur={battery.validateAndFix}
                                onKeyDown={battery.handleInputKeyDown}
                                />
                            ) : (
                                <div>{draft.returnBattery}%</div>
                            )}
                        </div>
                    </div>

                    <div className={`${styles.slidebarinsert} ${styles.detailBattery}`}>
                        <div className={styles.batterySliderWrap}>
                            <div className={styles.batterySliderTrackArea}>
                                <input
                                className={`
                                    ${styles.batterySlider}
                                    ${styles.batteryBarInputBg}
                                    ${!isEditMode ? styles.sliderDisabled : ""}
                                `}
                                type="range"
                                min={battery.min}
                                max={battery.max}
                                step={1}
                                value={battery.value}
                                onChange={isEditMode ? battery.handleSliderChange : undefined}
                                aria-label="복귀 배터리양 조정"
                                disabled={!isEditMode}
                                style={{ ["--percent" as any]: `${battery.sliderPercent}%` }}
                                />
                            </div>

                            <div
                                className={`
                                ${styles.batterySliderLabels}
                                ${styles.batteryBarFc}
                                ${!isEditMode ? styles.sliderLabelDisabled : ""}
                                `}
                            >
                                <span>{battery.min}%</span>
                                <span>{battery.max}%</span>
                            </div>
                        </div>
                    </div>
                </div>

                </div>
                <div className={styles.btnTotal}>
                {/* 왼쪽: 삭제/수정 (보기모드에서만) */}
                {!isEditMode && (
                    <div className={styles.btnLeftBox}>
                    <button
                        type="button"
                        className={`${styles.btnItemCommon} ${styles.btnBgGray} ${styles.mr10}`}
                        onClick={handleDelete}
                        disabled={isSubmitting}
                    >
                        <span className={styles.btnIcon}><img src="/icon/delete_icon.png" alt="삭제" /></span>
                        <span>삭제</span>
                    </button>

                    <button
                        type="button"
                        className={`${styles.btnItemCommon} ${styles.btnBgGray}`}
                        onClick={() => { handleUdate?.(); }}
                    >
                        <span className={styles.btnIcon}><img src="/icon/edit_icon.png" alt="edit" /></span>
                        <span>수정</span>
                    </button>
                    </div>
                )}

                {/* 오른쪽: 취소/저장 (수정모드에서만) */}
                {isEditMode && (
                    <div className={styles.btnRightBox}>
                    <button
                        type="button"
                        className={`${styles.btnItemCommon} ${styles.btnBgRed}`}
                        onClick={handleCancel}
                        disabled={isSubmitting}
                    >
                        <span className={styles.btnIcon}><img src="/icon/close_btn.png" alt="cancel" /></span>
                        <span>취소</span>
                    </button>

                    <button
                        type="button"
                        className={`${styles.btnItemCommon} ${styles.btnBgBlue} ${isSubmitting ? styles.btnDisabled : ""}`}
                        onClick={handleSave}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <span className={styles.btnSpinner} />
                        ) : (
                            <span className={styles.btnIcon}><img src="/icon/check.png" alt="save" /></span>
                        )}
                        <span>{isSubmitting ? "저장 중..." : "저장"}</span>
                    </button>
                    </div>
                )}
                </div>
                </>
                )}
            </div>
        </div>
        {showConfirm && (
            <CancelConfirmModal
            message="해당 로봇을 정말 삭제 하시겠습니까?"
            onConfirm={handleConfirmOk}
            onCancel={handleConfirmCancel}
            />
        )}
        {battery.alertOpen && (
            <CancelConfirmModal
                message={battery.alertMsg}
                onConfirm={battery.closeAlert}
                onCancel={battery.closeAlert}
            />
        )}
        {saveSuccessOpen && (
            <CancelConfirmModal
                message="저장되었습니다."
                onConfirm={() => setSaveSuccessOpen(false)}
                onCancel={() => setSaveSuccessOpen(false)}
            />
        )}
        {apiAlert.isOpen && (
            <CancelConfirmModal
                message={apiAlert.message}
                onConfirm={apiAlert.close}
                onCancel={apiAlert.close}
            />
        )}
        </>
    );

}
