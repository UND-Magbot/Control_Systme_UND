'use client';

import styles from './Modal.module.css';
import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState  } from 'react';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { alertMockData, type AlertMockData } from '@/app/mock/alerts_data';
import { useCustomScrollbar } from '@/app/hooks/useCustomScrollbar';

type alertsConfirmModalOpenProps = {
    isOpen: boolean;
    onClose: () => void;
}


export default function RobotDetailModal({
    isOpen,
    onClose,
}:alertsConfirmModalOpenProps ){

    // 미읽음 알림만 필터링
    const visibleAlerts = useMemo(() => {
        return alertMockData.filter((a) => a.isRead === false);
    }, []);

    //알림 페이지로 이동
    const router = useRouter();

    // 로그 전송 알림
    const [showConfirm, setShowConfirm] = useState(false);
    const [selectedAlert, setSelectedAlert] = useState<AlertMockData | null>(null);

    // 표시 영역 초과 > 스크롤
    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    
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

    // 알림 타입 별 배경 색상 적용(슬러그로 변환)
    const toTypeSlug = (t?: string) => {
    const v = (t ?? '').toLowerCase();
    if (v.startsWith('emerg')) return 'emerg'; // Emergency / Emerg
    return v; // notice, schedule, robot
    };

    const getDisplayStatus = (
            item: AlertMockData
    ): 'new' | 'error' | null => {
        // Robot + error → error
        if (item.type === 'Robot' && item.status === 'error') {
        return 'error';
        }

        // 신규 알림
        if (!item.isRead) {
        return 'new';
        }

        return null;
    };

    useCustomScrollbar({
        enabled: isOpen, // 모달 열렸을 때만
        scrollRef,
        trackRef,
        thumbRef,
        deps: [alertMockData.length], // 목록 길이 변동 대응
    });

    if (!isOpen) return null;

    // 로그 전송 버튼 핸들러
  const handleSendLog = (alert: AlertMockData) => {
    setSelectedAlert(alert);
    setShowConfirm(true);
  };
  
    // 로그 전송 확인 창 - confirm 창에서 확인 눌렀을 때
    const handleSendLogOk = () => {
        setShowConfirm(false);
        setSelectedAlert(null);
        onClose();
    };
  
     // 로그 전송 확인 창 - confirm 창만 닫기
    const handleSendLogCancel = () => {
        setShowConfirm(false);
        setSelectedAlert(null);
    };

    // 알림 페이지로 이동
    const handleMoveToAlerts = () => {
        onClose();
        router.push('/alerts');
    };

    
    return (
        <>
            <div className={styles.modalOverlay} onClick={onClose}>
                <div className={styles.alertsModalContent} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.alertsModalTop}>
                        <div className={styles.alertsModalTitle}>
                            <img src="/icon/alerts_w.png" alt="" />
                            <h2>알림</h2>
                        </div>
                        <button onClick={onClose}>X</button>
                    </div>

                    <div className={styles.alertsContents}>
                        <div ref={scrollRef} className={styles.alertsScroll}>
                            <div className={styles.alertsInner}>
                                {visibleAlerts.map((item) => (
                                    <div key={item.id} className={styles.alertsItem}>
                                        <div className={styles.topContents}>
                                            <div className={`${styles.aletsType} ${styles[`badge--${toTypeSlug(item.type)}`]}`}>
                                                {item.type}
                                            </div>

                                            {(() => {
                                                const displayStatus = getDisplayStatus(item);
                                                return displayStatus ? (
                                                <div
                                                    className={`${styles.aletsStatus} ${
                                                    displayStatus === 'error' ? styles.error : styles.new
                                                    }`}
                                                >
                                                    {displayStatus}
                                                </div>
                                                ) : (
                                                <div className={styles.aletsStatusEmpty} />
                                                );
                                            })()}

                                            <div className={styles.aletsContent}>{item.content}</div>
                                        </div> 
                                        <div className={styles.aletsDate}>{item.date}</div>
                                        <button onClick={() => handleSendLog(item)}>
                                            <img src="/icon/alerts_send_w.png" alt="" />
                                            <span>로그 전송</span>
                                        </button>
                                    </div>
                                ))}
                            </div>    
                        </div>

                        <div ref={trackRef} className={styles.scrollTrack}>
                            <div ref={thumbRef} className={styles.scrollThumb} />
                        </div>
                    </div>
                    
                    <div className={styles.pgBtnDiv}>
                        <button className={styles.alertsPgBtn} onClick={handleMoveToAlerts}>
                            <span>알림 화면으로 이동 </span>
                            <span>→</span>
                        </button>
                    </div>
                </div>
            </div>
            {showConfirm && (
                <CancelConfirmModal
                message="운영사의 통합관제시스템으로 로그 전송 하시겠습니까?"
                onConfirm={handleSendLogOk}
                onCancel={handleSendLogCancel}
                />
            )}
        </>
    );
    
}