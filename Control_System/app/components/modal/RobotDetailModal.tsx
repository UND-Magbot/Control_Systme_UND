'use client';

import styles from './Modal.module.css';
import React, { useState, useEffect, useRef, useMemo  } from 'react';
import type { RobotRowData } from '@/app/type';
import type { RobotDraft } from "@/app/(pages)/robots/components/RobotList";
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { API_BASE } from "@/app/config";

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

    useEffect(() => {
        if (!isOpen) return;
        if (selectedRobotId == null) return;
        if (!selectedRobot) return;
        
        console.log("🚀 fetch robot detail id:", selectedRobotId);

        fetch(`${API_BASE}/DB/robots/${selectedRobotId}`)
            .then((res) => {
                if (!res.ok) {
                    throw new Error("로봇 상세 조회 실패");
                }
                return res.json();
            })
            .then((data) => {
                console.log("✅ robot detail from DB:", data);
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
                // ⭐ 배터리 UI 동기화
                setReturnBattery(limitBattery);
                setReturnBatteryText(String(limitBattery));
                lastValidRef.current = limitBattery;
            })
            .catch((err) => {
                console.error("❌ robot detail fetch error:", err);
            });
    }, [isOpen, selectedRobotId]);

    
    const [showConfirm, setShowConfirm] = useState(false);

    // 배터리 수치 확인 알림창
    const [batteryAlertOpen, setBatteryAlertOpen] = useState(false);
    const [batteryAlertMsg, setBatteryAlertMsg] = useState("");

    const [isEditMode, setIsEditMode] = useState(false);

    const MIN = 15;
    const MAX = 30;
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

    
            
    // 단일 소스: 배터리 복귀 기준(%)
    const [returnBattery, setReturnBattery] = useState<number>(DEFAULT_RETURN_BATTERY);

    // 입력창에는 문자열이 필요(타이핑 중 공백/부분 입력 허용)
    const [returnBatteryText, setReturnBatteryText] = useState<string>(String(DEFAULT_RETURN_BATTERY));

    // 마지막 정상값(범위 밖 입력 시 되돌릴 용도)
    const lastValidRef = useRef<number>(DEFAULT_RETURN_BATTERY);

    const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

    const commitByNumber = (n: number) => {
        const v = clamp(n);
        setReturnBattery(v);
        setReturnBatteryText(String(v));
        lastValidRef.current = v;
    };

    const sliderPercent = useMemo(() => {
        const p = ((returnBattery - MIN) / (MAX - MIN)) * 100;
        return Number.isFinite(p) ? p : 0;
    }, [returnBattery]);

    // 조건1: 슬라이더 드래그(15~30)
    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = Number(e.target.value);
        commitByNumber(v); // 조건2: 슬라이더 값이 그대로 input에 반영
    };

    // 조건3: input 입력 시 슬라이더도 재세팅(정상 범위면)
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;

        // 숫자만 허용(빈값은 타이핑 중 허용)
        if (!/^\d*$/.test(raw)) return;

        setReturnBatteryText(raw);

        // 타이핑 중 빈값이면 확정하지 않음
        if (raw === '') return;

        const n = Number(raw);
        if (Number.isNaN(n)) return;

        // 정상 범위면 즉시 동기화
        if (n >= MIN && n <= MAX) {
        commitByNumber(n);
        }
    };

    // 조건4: input에 15~30 밖 입력 시 알림 + 되돌리기
    const validateAndFix = () => {
        const raw = returnBatteryText.trim();
        // 빈값이면 마지막 정상값으로 복원
        if (raw === '') {
            commitByNumber(lastValidRef.current);
            return;
        }

        const n = Number(raw);
        if (Number.isNaN(n) || n < MIN || n > MAX) {
            setBatteryAlertMsg(`복귀 배터리양은 ${MIN}~${MAX} 범위내에서 숫자만 직접 기입하거나 \n 최소 복귀 배터리양 조정바로 설정해 주세요.`);
            setBatteryAlertOpen(true);
            // 마지막 정상값으로 되돌림
            commitByNumber(lastValidRef.current);
            
            return false;
        }
        commitByNumber(n);
        return true; // ✅ valid
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
        e.preventDefault();
        validateAndFix();
        }
    };


    // ESC 키로 모달 닫기
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden'; // 스크롤 방지
        }
        
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
        }, [isOpen, onClose]);
        
    if (!isOpen) return null;
    if (!selectedRobot) return null;

    // 삭제 버튼 클릭 핸들러
    const handleDelete = () => {
      setShowConfirm(true);   // 커스텀 confirm 열기
    };
  
    // 삭제 재 확인 창 - confirm 창에서 확인 눌렀을 때
    const handleConfirmOk = async () => {
        if (!selectedRobotId) return;

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
            console.error("❌ robot delete error:", err);
            alert("로봇 삭제 실패");
        }
    };
    
     // 삭제 재 확인 창 - confirm 창만 닫기
    const handleConfirmCancel = () => {
      setShowConfirm(false);
    };
 
    const handleUdate = () => {
        setIsEditMode(true);
        console.log("수정되었습니다.");
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

    // 2) 배터리 입력 UI도 원복(사용 중인 함수 그대로)
    commitByNumber(typeof rb === "number" ? rb : DEFAULT_RETURN_BATTERY);

    // 3) 모달 닫지 않고 "보기모드"로만 전환
    setIsEditMode(false);
    };
    
    const handleSave = async () => {
        const ok = validateAndFix();
        if (!ok) return;

        const rb = lastValidRef.current;

        const payload = {
            operator: draft.operator,
            serialNumber: draft.serialNumber,
            model: draft.model,
            group: draft.group,
            softwareVersion: draft.softwareVersion,
            site: draft.site,
            limit_battery: rb,
        };

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

            // ✅ 1. 화면에 쓰이는 robotDetail 갱신
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
                    return: rb, // ← 배터리
                }
                : prev
            );

            // ✅ 2. draft도 동기화
            setDraft((p) => ({ ...p, returnBattery: rb }));

            // ✅ 3. 보기모드 전환
            setIsEditMode(false);
        } catch (err) {
            console.error("❌ robot update error:", err);
            alert("로봇 정보 저장 실패");
        }
    };

    
    return (
        <>
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>
                <button className={styles.detailCloseBtn} onClick={onClose}>✕</button>
                <div className={styles.detailTitle}>
                    <img src="/icon/robot_status_w.png" alt="Robot Registeration" />
                    <h2>로봇 정보</h2>
                </div>
                <div className={`${styles.detailItemBoxContainer} ${styles.detailBoxFs} ${isEditMode ? styles.editMode : ""}`}>

                {/* 1. Robot Type(Name) / Operator */}
                <div className={`${styles.detailRowItemBox} ${styles.btnBline}`}>
                    <div className={styles.detailItemBox}>
                        <div className={`${styles.itemTitleBox} ${styles.borderTl8}`}>
                            로봇명
                        </div>
                        <div className={`${styles.itemContentBox} ${styles.lhUnset} ${styles.plusPd11}`}>
                            {/* 예: Quadruped (Robot 1) */}
                            {selectedRobot
                            ? `${(robotDetail ?? selectedRobot).group} (${(robotDetail ?? selectedRobot).no})`
                            : "-"}
                        </div>
                    </div>

                    <div className={styles.detailItemBox}>
                    <div className={styles.itemTitleBox}>운영사</div>
                    <div className={`${styles.itemContentBox} ${styles.lhUnset} ${styles.borderTr8}`}>
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
                    <div className={styles.detailItemBox}>
                    <div className={styles.itemTitleBox}>시리얼 넘버(SN)</div>
                    <div className={`${styles.itemContentBox} ${styles.lhUnset}`}>
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
                    <div className={`${styles.itemContentBox} ${styles.lhUnset}`}>
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
                    <div className={styles.detailItemBox}>
                    <div className={styles.itemTitleBox}>그룹</div>
                    <div className={`${styles.itemContentBox} ${styles.lhUnset}`}>
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
                    <div className={`${styles.itemContentBox} ${styles.lhUnset}`}>
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
                    <div className={styles.detailItemBox}>
                        <div className={`${styles.itemTitleBox}`}>
                            사이트
                        </div>
                        <div className={`${styles.itemContentBox} ${styles.lhUnset}`}>
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
                    <div className={`${styles.itemTitleBox} ${styles.lhUnset}`}>
                        <div>로봇 등록 일시</div>
                    </div>
                    <div className={`${styles.itemContentBox} ${styles.lhUnset} ${styles.plusPd11}`}>
                        {(robotDetail ?? selectedRobot)?.registrationDateTime ?? "-"}
                    </div>
                    </div>
                </div>

                {/* 5. Battery */}
                <div className={styles.detailRowItemBox}>
                    <div className={styles.detailItemBox}>
                        <div className={`${styles.itemTitleBox} ${styles.borderBl8}`}>
                            복귀 배터리양
                        </div>
                        <div className={`${styles.itemContentBox} ${styles.lhUnset} ${styles.batteryBar}`}>
                            {isEditMode ? (
                                <input
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                value={returnBatteryText}
                                onChange={handleInputChange}
                                onBlur={validateAndFix}
                                onKeyDown={handleInputKeyDown}
                                />
                            ) : (
                                <div>{draft.returnBattery}%</div>
                            )}
                        </div>
                    </div>

                    <div className={`${styles.slidebarinsert} ${styles.detailBattery} ${styles.borderBr8}`}>
                        <div className={styles.batterySliderWrap}>
                            <div className={styles.batterySliderTrackArea}>
                                <input
                                className={`
                                    ${styles.batterySlider}
                                    ${styles.batteryBarInputBg}
                                    ${!isEditMode ? styles.sliderDisabled : ""}
                                `}
                                type="range"
                                min={MIN}
                                max={MAX}
                                step={1}
                                value={returnBattery}
                                onChange={isEditMode ? handleSliderChange : undefined}
                                aria-label="복귀 배터리양 조정"
                                disabled={!isEditMode}
                                style={{ ["--percent" as any]: `${sliderPercent}%` }}
                                />
                            </div>

                            <div
                                className={`
                                ${styles.batterySliderLabels}
                                ${styles.batteryBarFc}
                                ${!isEditMode ? styles.sliderLabelDisabled : ""}
                                `}
                            >
                                <span>{MIN}%</span>
                                <span>{MAX}%</span>
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
                    >
                        <img src="/icon/delete_icon.png" alt="delete" />
                        <span>삭제</span>
                    </button>

                    <button
                        type="button"
                        className={`${styles.btnItemCommon} ${styles.btnBgGray}`}
                        onClick={() => {
                        // 기존 handleUdate가 수정모드 진입 역할이라면 그대로 호출
                        // handleUdate 안에서 setIsEditMode(true) 처리 권장
                        handleUdate?.();
                        // 만약 handleUdate가 setIsEditMode(true)를 안 한다면 아래 한 줄 추가
                        // setIsEditMode(true);
                        }}
                    >
                        <img src="/icon/edit_icon.png" alt="edit" />
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
                    >
                        <img src="/icon/close_btn.png" alt="cancel" />
                        <span>취소</span>
                    </button>

                    <button
                        type="button"
                        className={`${styles.btnItemCommon} ${styles.btnBgBlue}`}
                        onClick={handleSave}
                    >
                        <img src="/icon/check.png" alt="save" />
                        <span>저장</span>
                    </button>
                    </div>
                )}
                </div>
            </div>
        </div>
        {showConfirm && (
            <CancelConfirmModal
            message="해당 로봇을 정말 삭제 하시겠습니까?"
            onConfirm={handleConfirmOk}
            onCancel={handleConfirmCancel}
            />
        )}
        {batteryAlertOpen && (
            <CancelConfirmModal
                message={batteryAlertMsg}
                onConfirm={() => setBatteryAlertOpen(false)}
                onCancel={() => setBatteryAlertOpen(false)}
            />
        )}
        </>
    );
    
}