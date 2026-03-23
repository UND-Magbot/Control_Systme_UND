"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './Alerts.module.css';
import { alertMockData, type AlertMockData, type AlertType } from '@/app/mock/alerts_data';
import Pagination from '@/app/components/pagination';
import FilterSelectBox, { type FilterOption } from '@/app/components/button/FilterSelectBox';

type TabKey = 'total' | 'schedule' | 'robot' | 'notice';
type StatusFilter = '' | 'all' | 'read' | 'unread';

const statusFilterOptions: FilterOption[] = [
  { id: 'unread', label: '미읽음' },
  { id: 'read', label: '읽음' },
];

const typeLabels: Record<AlertType, string> = {
  Notice: '공지사항',
  Schedule: '스케줄',
  Robot: '로봇',
};

const tabTypeMap: Record<TabKey, AlertType | null> = {
  total: null,
  schedule: 'Schedule',
  robot: 'Robot',
  notice: 'Notice',
};

const badgeClass: Record<AlertType, string> = {
  Notice: styles.badgeNotice,
  Schedule: styles.badgeSchedule,
  Robot: styles.badgeRobot,
};

function getDisplayStatus(item: AlertMockData): 'error' | 'info' | 'event' | null {
  if (item.type !== 'Robot') return null;
  if (item.status === 'error') return 'error';
  if (item.status === 'info') return 'info';
  if (item.status === 'event') return 'event';
  return null;
}

function formatAlertDate(date: string): string {
  const datePart = date.slice(2, 10);   // YY-MM-DD
  const timePart = date.slice(11);      // HH:mm
  const seconds = timePart.length === 5 ? ':00' : '';
  return `${datePart} ${timePart}${seconds}`;
}

export default function AlertsPage() {
  const searchParams = useSearchParams();
  const paramTab = searchParams.get('tab') as TabKey | null;
  const paramId = searchParams.get('id');

  const [alerts, setAlerts] = useState<AlertMockData[]>(() => [...alertMockData]);
  const [activeTab, setActiveTab] = useState<TabKey>(paramTab && ['total', 'schedule', 'robot', 'notice'].includes(paramTab) ? paramTab : 'total');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedStatus, setAppliedStatus] = useState<StatusFilter>('');
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(paramId ? Number(paramId) : null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const listRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 48;

  const calcPageSize = useCallback(() => {
    if (listRef.current) {
      const available = listRef.current.clientHeight;
      const count = Math.max(1, Math.floor(available / ROW_HEIGHT));
      setPageSize(count);
    }
  }, []);

  useEffect(() => {
    calcPageSize();
    window.addEventListener('resize', calcPageSize);
    return () => window.removeEventListener('resize', calcPageSize);
  }, [calcPageSize]);

  // 미읽음 카운트 (탭 라벨용)
  const unreadCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { total: 0, schedule: 0, robot: 0, notice: 0 };
    for (const a of alerts) {
      if (!a.isRead) {
        counts.total++;
        if (a.type === 'Schedule') counts.schedule++;
        else if (a.type === 'Robot') counts.robot++;
        else if (a.type === 'Notice') counts.notice++;
      }
    }
    return counts;
  }, [alerts]);

  const tabs = useMemo<{ id: TabKey; label: string }[]>(() => [
    { id: 'total',     label: unreadCounts.total > 0 ? `전체 (${unreadCounts.total})` : '전체' },
    { id: 'schedule',  label: unreadCounts.schedule > 0 ? `스케줄 (${unreadCounts.schedule})` : '스케줄' },
    { id: 'robot',     label: unreadCounts.robot > 0 ? `로봇 (${unreadCounts.robot})` : '로봇' },
    { id: 'notice',    label: unreadCounts.notice > 0 ? `공지사항 (${unreadCounts.notice})` : '공지사항' },
  ], [unreadCounts]);

  // 필터링 + 정렬
  const filteredAlerts = useMemo(() => {
    let list = [...alerts];

    // 탭 필터
    const filterType = tabTypeMap[activeTab];
    if (filterType) list = list.filter(a => a.type === filterType);

    // 상태 필터
    if (appliedStatus === 'read') list = list.filter(a => a.isRead);
    if (appliedStatus === 'unread') list = list.filter(a => !a.isRead);

    // 검색 필터
    if (appliedSearch.trim()) {
      const q = appliedSearch.toLowerCase();
      list = list.filter(a =>
        a.content.toLowerCase().includes(q) ||
        (a.detail?.toLowerCase().includes(q))
      );
    }

    // 날짜 최신순 정렬
    list.sort((a, b) => b.date.localeCompare(a.date));

    return list;
  }, [alerts, activeTab, appliedStatus, appliedSearch]);

  // 페이징
  const pagedAlerts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAlerts.slice(start, start + pageSize);
  }, [filteredAlerts, currentPage]);

  // 요약 카운트
  const summaryStats = useMemo(() => {
    const total = filteredAlerts.length;
    const unread = filteredAlerts.filter(a => !a.isRead).length;
    const error = filteredAlerts.filter(a => a.status === 'error').length;
    return { total, unread, error };
  }, [filteredAlerts]);

  // 선택된 알림 상세
  const selectedAlert = useMemo(() => {
    if (selectedAlertId === null) return null;
    return alerts.find(a => a.id === selectedAlertId) ?? null;
  }, [alerts, selectedAlertId]);

  // 핸들러
  const handleSelectAlert = (id: number) => {
    setSelectedAlertId(id);
  };

  const handleMarkRead = (id: number) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a));
  };

  const handleMarkAllRead = () => {
    setAlerts(prev => prev.map(a => ({ ...a, isRead: true })));
  };

  const handleSearch = () => {
    setAppliedSearch(searchQuery);
    setAppliedStatus(statusFilter);
    setCurrentPage(1);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="page-header">
        <h1>알림 관리</h1>
      </div>

      <div className={styles.container}>
        {/* 좌측 패널 - 알림 목록 */}
        <div className={styles.leftPanel}>
          <div className={styles.pillTabs}>
            <div className={styles.pillTabList}>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  className={`${styles.pillTab} ${activeTab === tab.id ? styles.pillTabActive : ''}`}
                  onClick={() => { setActiveTab(tab.id as TabKey); setCurrentPage(1); }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={styles.tabSummary}>
              <span><strong className={styles.summaryCount}>{summaryStats.total}</strong>건</span>
              {(activeTab === 'total' || activeTab === 'robot') && (
                <>
                  <span className={styles.summaryDot}>·</span>
                  <span>오류 <strong className={styles.summaryError}>{summaryStats.error}</strong></span>
                </>
              )}
            </div>
          </div>
          <div className={styles.topActions}>
            <div className={styles.searchWrapper}>
              <img src="/icon/search.png" alt="" className={styles.searchIcon} />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="알림 내용 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <FilterSelectBox
              items={statusFilterOptions}
              selectedLabel={
                statusFilter === 'unread' ? '미읽음'
                : statusFilter === 'read' ? '읽음'
                : null
              }
              placeholder="읽음 여부"
              onSelect={(item) => {
                setStatusFilter(item ? (item.id as StatusFilter) : 'all');
              }}
              width={120}
            />
            <button className={styles.searchBtn} onClick={handleSearch}>
              조회
            </button>
            <button className={styles.markAllReadBtn} onClick={handleMarkAllRead}>
              전체 읽음
            </button>
          </div>

          <div ref={listRef} className={`${styles.alertList} ${styles.fadeIn}`} key={`${activeTab}-${currentPage}`}>
            {pagedAlerts.length === 0 ? (
              <div className={styles.emptyList}>
                {searchQuery.trim() ? '검색 결과가 없습니다' : '알림이 없습니다'}
              </div>
            ) : (
              pagedAlerts.map((item) => {
                const isUnread = !item.isRead;
                const isSelected = selectedAlertId === item.id;

                const itemClasses = [
                  styles.alertItem,
                  isUnread ? styles.alertItemUnread : '',
                  isSelected ? styles.alertItemSelected : '',
                ].filter(Boolean).join(' ');

                const displayStatus = getDisplayStatus(item);

                return (
                  <div
                    key={item.id}
                    className={itemClasses}
                    onClick={() => handleSelectAlert(item.id)}
                    title={item.content}
                  >
                    <div className={styles.alertRow1}>
                      <span className={`${styles.badge} ${badgeClass[item.type]}`}>
                        {typeLabels[item.type]}
                      </span>
                      {displayStatus && (
                        <span className={`${styles.statusTag} ${
                          displayStatus === 'error' ? styles.statusError
                          : displayStatus === 'info' ? styles.statusInfo
                          : styles.statusEvent
                        }`}>
                          {displayStatus}
                        </span>
                      )}
                      <p className={styles.alertContent}>{item.content}</p>
                      <span className={styles.alertDate}>{formatAlertDate(item.date)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className={styles.paginationBar}>
            <Pagination
              totalItems={filteredAlerts.length}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              pageSize={pageSize}
            />
          </div>
        </div>

        {/* 우측 패널 - 알림 상세 */}
        <div className={styles.rightPanel}>
          {selectedAlert ? (
            <div className={`${styles.fadeIn} ${styles.detailInner}`} key={selectedAlert.id}>
              <div className={styles.detailHeader}>
                <div className={styles.detailHeaderLeft}>
                  <span className={`${styles.badge} ${badgeClass[selectedAlert.type]}`}>
                    {typeLabels[selectedAlert.type]}
                  </span>
                  {(() => {
                    const status = getDisplayStatus(selectedAlert);
                    return status ? (
                      <span className={`${styles.statusTag} ${
                        status === 'error' ? styles.statusError
                        : status === 'info' ? styles.statusInfo
                        : styles.statusEvent
                      }`}>
                        {status}
                      </span>
                    ) : null;
                  })()}
                </div>
                <button
                  className={`${styles.markReadBtn} ${selectedAlert.isRead ? styles.markReadBtnDone : ''}`}
                  onClick={() => !selectedAlert.isRead && handleMarkRead(selectedAlert.id)}
                  disabled={selectedAlert.isRead}
                >
                  {selectedAlert.isRead ? '읽음 완료' : '읽음 처리'}
                </button>
              </div>

              <div className={styles.detailMetaInline}>
                <span className={styles.detailMetaItem}>
                  <span className={styles.detailMetaLabel}>날짜</span>
                  <span className={styles.detailMetaValue}>{selectedAlert.date}</span>
                </span>
              </div>

              <div className={styles.detailBody}>
                <div className={styles.detailContentText}>
                  {selectedAlert.content}
                  {selectedAlert.robotName && (
                    <span className={styles.detailRobotName}> — {selectedAlert.robotName}</span>
                  )}
                </div>

                {selectedAlert.detail && (
                  <div className={styles.detailNoticeBody}>
                    {selectedAlert.detail}
                  </div>
                )}

                {selectedAlert.errorJson && (
                  <div className={styles.errorJsonBlock}>
                    <span className={styles.errorJsonLabel}>Error Detail</span>
                    <pre className={styles.errorJsonPre}>
                      {JSON.stringify(selectedAlert.errorJson, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.emptyDetail}>
              <div className={styles.emptyDetailDot} />
              <span>알림을 선택하세요</span>
              <span className={styles.emptyDetailSub}>목록에서 알림을 클릭하면 상세 내용을 확인할 수 있습니다</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
