'use client';

import styles from './Modal.module.css';
import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { alertMockData, type AlertMockData, type AlertType } from '@/app/mock/alerts_data';
import { useCustomScrollbar } from '@/app/hooks/useCustomScrollbar';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';

type AlertsConfirmModalProps = {
    isOpen: boolean;
    onClose: () => void;
};

type ModalTabKey = 'total' | 'schedule' | 'robot';

const tabTypeMap: Record<ModalTabKey, AlertType | null> = {
    total: null,
    schedule: 'Schedule',
    robot: 'Robot',
};

const emptyMessages: Record<ModalTabKey, string> = {
    total: '오늘 새로운 알림이 없습니다',
    schedule: '오늘 스케줄 알림이 없습니다',
    robot: '오늘 로봇 알림이 없습니다',
};

export default function AlertsConfirmModal({
    isOpen,
    onClose,
}: AlertsConfirmModalProps) {
    // 로컬 상태 관리 (향후 Context/Store 전환 대비)
    const [alerts] = useState<AlertMockData[]>(() => [...alertMockData]);
    const [activeTab, setActiveTab] = useState<ModalTabKey>('total');

    const router = useRouter();

    // 로그 전송 확인 모달
    const [showConfirm, setShowConfirm] = useState(false);
    const [selectedAlert, setSelectedAlert] = useState<AlertMockData | null>(null);

    // 스크롤 refs
    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);

    // 당일 날짜 (컴포넌트 마운트 시 계산 — 자정 경계 대응)
    const today = useMemo(() => {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }, []);

    // 모달 열릴 때 탭 초기화
    useEffect(() => {
        if (isOpen) {
            setActiveTab('total');
        }
    }, [isOpen]);

    // ESC 키로 모달 닫기 (CancelConfirmModal 스택 충돌 방지)
    useModalBehavior({ isOpen, onClose, disabled: showConfirm });

    // 탭별 미읽음 카운트 (당일 + 미읽음 + Notice 제외)
    const unreadCounts = useMemo(() => {
        const counts: Record<ModalTabKey, number> = { total: 0, schedule: 0, robot: 0 };
        for (const a of alerts) {
            if (!a.isRead && a.date.startsWith(today) && a.type !== 'Notice') {
                counts.total++;
                if (a.type === 'Schedule') counts.schedule++;
                else if (a.type === 'Robot') counts.robot++;
            }
        }
        return counts;
    }, [alerts, today]);

    // 탭 라벨
    const tabs = useMemo<{ id: ModalTabKey; label: string }[]>(() => [
        { id: 'total', label: unreadCounts.total > 0 ? `전체 (${unreadCounts.total})` : '전체' },
        { id: 'schedule', label: unreadCounts.schedule > 0 ? `스케줄 (${unreadCounts.schedule})` : '스케줄' },
        { id: 'robot', label: unreadCounts.robot > 0 ? `로봇 (${unreadCounts.robot})` : '로봇' },
    ], [unreadCounts]);

    // 3단계 필터: 당일 → 미읽음 → 탭 타입 (Notice 제외)
    const filteredAlerts = useMemo(() => {
        let list = alerts.filter(
            (a) => a.date.startsWith(today) && !a.isRead && a.type !== 'Notice'
        );

        // 탭별 타입 필터
        const filterType = tabTypeMap[activeTab];
        if (filterType) {
            list = list.filter((a) => a.type === filterType);
        }

        // 날짜 최신순 정렬
        list.sort((a, b) => b.date.localeCompare(a.date));

        return list;
    }, [alerts, today, activeTab]);

    // 타입별 배지 슬러그
    const toTypeSlug = (t?: string) => {
        const v = (t ?? '').toLowerCase();
        if (v.startsWith('emerg')) return 'emerg';
        return v;
    };

    // 표시 상태 결정 (알림 페이지와 동일한 Robot 상태값)
    const getDisplayStatus = (item: AlertMockData): 'error' | 'info' | 'event' | null => {
        if (item.type !== 'Robot') return null;
        if (item.status === 'error') return 'error';
        if (item.status === 'info') return 'info';
        if (item.status === 'event') return 'event';
        return null;
    };

    // 커스텀 스크롤바 (필터된 리스트 길이에 따라 재계산)
    useCustomScrollbar({
        enabled: isOpen,
        scrollRef,
        trackRef,
        thumbRef,
        deps: [filteredAlerts.length, activeTab],
    });

    if (!isOpen) return null;

    // 탭 전환 핸들러
    const handleTabChange = (tabId: ModalTabKey) => {
        setActiveTab(tabId);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    };

    // 로그 전송 버튼 핸들러
    const handleSendLog = (alert: AlertMockData) => {
        setSelectedAlert(alert);
        setShowConfirm(true);
    };

    // 로그 전송 확인 — 확인창만 닫고 모달은 유지
    const handleSendLogOk = () => {
        setShowConfirm(false);
        setSelectedAlert(null);
    };

    // 로그 전송 취소
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
                    {/* 헤더 */}
                    <div className={styles.alertsModalTop}>
                        <div className={styles.alertsModalTitle}>
                            <img src="/icon/alerts_w.png" alt="" />
                            <h2>알림</h2>
                        </div>
                        <button onClick={onClose} aria-label="닫기">
                            <img src="/icon/close_btn.png" alt="" />
                        </button>
                    </div>

                    {/* 탭 바 */}
                    <div className={styles.alertsTabBar} role="tablist" aria-label="알림 카테고리">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={activeTab === tab.id}
                                aria-controls="alerts-tabpanel"
                                className={`${styles.alertsTab} ${activeTab === tab.id ? styles.alertsTabActive : ''}`}
                                onClick={() => handleTabChange(tab.id)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* 알림 리스트 */}
                    <div className={styles.alertsContents}>
                        <div
                            ref={scrollRef}
                            className={styles.alertsScroll}
                            id="alerts-tabpanel"
                            role="tabpanel"
                            aria-live="polite"
                        >
                            <div className={styles.alertsInner} key={activeTab}>
                                {filteredAlerts.length === 0 ? (
                                    <div className={styles.alertsEmpty}>
                                        <span>{emptyMessages[activeTab]}</span>
                                    </div>
                                ) : (
                                    filteredAlerts.map((item) => {
                                        const displayStatus = getDisplayStatus(item);
                                        const isError = item.type === 'Robot' && item.status === 'error';

                                        return (
                                            <div
                                                key={item.id}
                                                className={`${styles.alertsItem} ${isError ? styles.alertsItemError : ''}`}
                                            >
                                                <div className={styles.topContents}>
                                                    <div className={`${styles.aletsType} ${styles[`badge--${toTypeSlug(item.type)}`]}`}>
                                                        {item.type}
                                                    </div>

                                                    {displayStatus ? (
                                                        <div
                                                            className={`${styles.aletsStatus} ${
                                                                displayStatus === 'error' ? styles.statusError
                                                                : displayStatus === 'info' ? styles.statusInfo
                                                                : styles.statusEvent
                                                            }`}
                                                        >
                                                            {displayStatus}
                                                        </div>
                                                    ) : (
                                                        <div className={styles.aletsStatusEmpty} />
                                                    )}

                                                    <div className={styles.aletsContent}>{item.content}</div>
                                                </div>
                                                <div className={styles.bottomContents}>
                                                    <div className={styles.aletsDate}>{item.date}</div>

                                                    {/* 로그 전송: Robot + error 항목에만 표시 */}
                                                    {isError && (
                                                        <button onClick={() => handleSendLog(item)}>
                                                            <img src="/icon/alerts_send_w.png" alt="" />
                                                            <span>로그 전송</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        <div ref={trackRef} className={styles.scrollTrack}>
                            <div ref={thumbRef} className={styles.scrollThumb} />
                        </div>
                    </div>

                    {/* 하단 이동 버튼 */}
                    <div className={styles.pgBtnDiv}>
                        <button className={styles.alertsPgBtn} onClick={handleMoveToAlerts}>
                            <span>알림 화면으로 이동 </span>
                            <span>→</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* 로그 전송 확인 모달 */}
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
