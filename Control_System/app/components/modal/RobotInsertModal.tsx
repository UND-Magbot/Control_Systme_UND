'use client';

import styles from './Modal.module.css';
import React, { useEffect, useState, useRef, useMemo } from 'react';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { API_BASE } from "@/app/config";


export default function RobotInsertModal({ 
    isOpen,
    onClose 
}: { isOpen: boolean; onClose: () => void; }){
    

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

    // 배터리 수치 확인 알림창
    const [batteryAlertOpen, setBatteryAlertOpen] = useState(false);
    const [batteryAlertMsg, setBatteryAlertMsg] = useState("");
        
    const MIN = 15;
    const MAX = 30;
    const DEFAULT_RETURN_BATTERY = 30;
    
    const [robotName, setRobotName] = useState("");
    const [robotModel, setRobotModel] = useState("");
    const [robotSN, setRobotSN] = useState("");

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
        } else {
        commitByNumber(n);
        }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
        e.preventDefault();
        validateAndFix();
        }
    };


    const handleCancel = () => {
        onClose();
    };
      
    const handleSave = async  () => {
        const payload = {
            robot_id: robotSN,
            robot_name: robotName,
            robot_model: robotModel,
            limit_battery: returnBattery
        };
        try {
            const res = await fetch(`${API_BASE}/DB/RobotInsert`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            if (res.status === 409) {
                const data = await res.json();
                alert(data.detail || "이미 등록된 시리얼 넘버입니다.");
                return;
            }
            if (!res.ok) {
                throw new Error("로봇 등록 실패");
            }

            onClose();
        } catch (err) {
            console.error(err);
            alert("로봇 등록 중 오류 발생");
        }
        onClose();
    };

    useEffect(() => {
        if (!isOpen) return;

        setReturnBattery(DEFAULT_RETURN_BATTERY);
        setReturnBatteryText(String(DEFAULT_RETURN_BATTERY));
        lastValidRef.current = DEFAULT_RETURN_BATTERY;
    }, [isOpen]);

    if (!isOpen) return null;
    
    return (
        <>
            <div className={styles.modalOverlay} onClick={onClose}>
                <div className={styles.insertModalContent} onClick={(e) => e.stopPropagation()}>
                    <button className={styles.insertCloseBtn} onClick={onClose}>✕</button>
                    <div className={styles.insertTitle}>
                        <img src="/icon/robot_status_w.png" alt="Robot Registeration" />
                        <h2>로봇 등록</h2>
                    </div>
                    <div className={styles.itemBoxContainer}>
                        <div className={styles.insertItemBox}>
                            <div>로봇명</div>
                            <input type="text" maxLength={20} value={robotName} onChange={(e) => setRobotName(e.target.value)}placeholder='20글자 이내로 작성해 주세요.' />
                        </div>
                        <div className={styles.insertItemBox}>
                            <div>모델명</div>
                            <input type="text" maxLength={20} value={robotModel} onChange={(e) => setRobotModel(e.target.value)} placeholder='20글자 이내로 작성해 주세요.' />
                        </div>
                        <div className={styles.insertItemBox}>
                            <div>시리얼 넘버(SN)</div>
                            <input type="text" maxLength={20} value={robotSN} onChange={(e) => setRobotSN(e.target.value)} placeholder='20글자 이내로 작성해 주세요.' />
                        </div>
                        <div className={styles.insertItemBox}>
                            <div>복귀 배터리양</div>
                            <input type="text"
                                inputMode="numeric"
                                value={returnBatteryText}
                                onChange={handleInputChange}
                                onBlur={validateAndFix}
                                onKeyDown={handleInputKeyDown}
                                placeholder='아래 조정바로 설정하거나 15~30사이의 숫자만 기입 (%제외)' />
                        </div>
                        <div className={styles.slidebarinsert}>
                            <div />
                            <div className={styles.batterySliderWrap}>
                                <div className={styles.batterySliderTrackArea}>
                                <input
                                    className={styles.batterySlider}
                                    type="range"
                                    min={MIN}
                                    max={MAX}
                                    step={1}
                                    value={returnBattery}
                                    onChange={handleSliderChange}
                                    aria-label="복귀 배터리양 조정"
                                    style={{ ['--percent' as any]: `${sliderPercent}%` }}
                                />
                                </div>

                                <div className={styles.batterySliderLabels}>
                                <span>{MIN}%</span>
                                <span>{MAX}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className={styles.insertBtnTotal}>
                        <div className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`} onClick={handleCancel} >
                            <img src="/icon/close_btn.png" alt="cancel"/>
                            <div>취소</div>
                        </div>
                        <div className={`${styles.insertConfrimBtn} ${styles.btnBgBlue}`}  onClick={handleSave}>
                            <img src="/icon/check.png" alt="save" />
                            <div>저장</div>
                        </div>
                    </div>
                </div>
            </div>
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