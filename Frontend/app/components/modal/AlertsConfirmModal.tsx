'use client';

import styles from './Modal.module.css';
import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { type AlertMockData, type AlertType } from '@/app/mock/alerts_data';
import { useCustomScrollbar } from '@/app/hooks/useCustomScrollbar';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { useAlertContext } from '@/app/context/AlertContext';

type AlertsConfirmModalProps = {
    isOpen: boolean;
    onClose: () => void;
};

type ModalTabKey = 'total' | 'schedule' | 'robot' | 'notice';

const tabTypeMap: Record<ModalTabKey, AlertType | null> = {
    total: null,
    schedule: 'Schedule',
    robot: 'Robot',
    notice: 'Notice',
};

const emptyMessages: Record<ModalTabKey, string> = {
    total: '새로운 알림이 없습니다',
    schedule: '스케줄 알림이 없습니다',
    robot: '로봇 알림이 없습니다',
    notice: '공지사항 알림이 없습니다',
};

export default function AlertsConfirmModal({
    isOpen,
    onClose,
}: AlertsConfirmModalProps) {
    const { unreadAlerts, unreadCounts: ctxCounts, refresh, handleMarkRead, handleMarkAllRead } = useAlertContext();
    const [activeTab, setActiveTab] = useState<ModalTabKey>('total');

    const router = useRouter();

    // 로그 전송 확인 모달
    const [showConfirm, setShowConfirm] = useState(false);
    const [selectedAlert, setSelectedAlert] = useState<AlertMockData | null>(null);

    // 스크롤 refs
    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);

    // 모달 열릴 때 탭 초기화 + 최신 데이터 보장
    useEffect(() => {
        if (isOpen) {
            setActiveTab('total');
            refresh();
        }
    }, [isOpen, refresh]);

    // ESC 키로 모달 닫기 (CancelConfirmModal 스택 충돌 방지)
    useModalBehavior({ isOpen, onClose, disabled: showConfirm });

    // 탭별 미읽음 카운트 (Context의 카운트를 모달 탭 키로 매핑)
    const tabCounts = useMemo<Record<ModalTabKey, number>>(() => ({
        total: ctxCounts.total,
        schedule: ctxCounts.schedule,
        robot: ctxCounts.robot,
        notice: ctxCounts.notice,
    }), [ctxCounts]);

    // 탭 라벨
    const tabs = useMemo<{ id: ModalTabKey; label: string }[]>(() => [
        { id: 'total', label: tabCounts.total > 0 ? `전체 (${tabCounts.total})` : '전체' },
        { id: 'schedule', label: tabCounts.schedule > 0 ? `스케줄 (${tabCounts.schedule})` : '스케줄' },
        { id: 'robot', label: tabCounts.robot > 0 ? `로봇 (${tabCounts.robot})` : '로봇' },
        { id: 'notice', label: tabCounts.notice > 0 ? `공지사항 (${tabCounts.notice})` : '공지사항' },
    ], [tabCounts]);

    // 필터: 탭 타입별
    const filteredAlerts = useMemo(() => {
        let list = [...unreadAlerts];

        const filterType = tabTypeMap[activeTab];
        if (filterType) {
            list = list.filter((a) => a.type === filterType);
        }

        list.sort((a, b) => b.date.localeCompare(a.date));

        return list;
    }, [unreadAlerts, activeTab]);

    // 타입별 배지 슬러그
    const toTypeSlug = (t?: string) => {
        const v = (t ?? '').toLowerCase();
        if (v.startsWith('emerg')) return 'emerg';
        return v;
    };

    // 타입 배지 한글 라벨
    const typeLabel: Record<string, string> = {
        Robot: '로봇',
        Schedule: '스케줄',
        Notice: '공지',
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

    // 알림 클릭 → 해당 항목 상세로 이동
    const handleAlertClick = (item: AlertMockData) => {
        const tabMap: Record<string, string> = { Robot: 'robot', Schedule: 'schedule', Notice: 'notice' };
        const tab = tabMap[item.type] ?? 'total';
        onClose();
        router.push(`/alerts?tab=${tab}&id=${item.id}`);
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

                    {/* 탭 바 + 전체 읽음 */}
                    <div className={styles.alertsTabRow}>
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
                        <button
                            className={styles.alertsMarkAllReadBtn}
                            onClick={handleMarkAllRead}
                            disabled={unreadAlerts.length === 0}
                        >
                            전체 읽음
                        </button>
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
                                                onClick={() => handleAlertClick(item)}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <div className={styles.topContents}>
                                                    <div className={`${styles.aletsType} ${styles[`badge--${toTypeSlug(item.type)}`]}`}>
                                                        {typeLabel[item.type] ?? item.type}
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
                                                {item.detail && (
                                                    <div className={styles.aletsDetail}>{item.detail}</div>
                                                )}
                                                <div className={styles.bottomContents}>
                                                    <div className={styles.aletsDate}>{item.date}</div>

                                                    <div className={styles.aletsActions} onClick={(e) => e.stopPropagation()}>
                                                        {/* 로그 전송: 외부 통합관제시스템 연동 시 활성화 예정 */}
                                                        {/* {isError && (
                                                            <button className={styles.aletsSendLogBtn} onClick={() => handleSendLog(item)}>
                                                                <img src="/icon/alerts_send_w.png" alt="" />
                                                                <span>로그 전송</span>
                                                            </button>
                                                        )} */}
                                                        <button className={styles.aletsReadBtn} onClick={() => handleMarkRead(item.id)}>
                                                            읽음
                                                        </button>
                                                    </div>
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
