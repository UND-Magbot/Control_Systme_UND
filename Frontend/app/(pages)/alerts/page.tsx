"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import PermissionGuard from "@/app/components/common/PermissionGuard";
import styles from './Alerts.module.css';
import { type AlertMockData, type AlertType } from '@/app/mock/alerts_data';
import { getAlerts, markAlertRead, markAllAlertsRead, createNotice, updateNotice, deleteNotice, uploadNoticeFile } from '@/app/lib/alertData';
import { apiFetch } from "@/app/lib/api";
import { API_BASE } from '@/app/config';
import { usePageReady } from "@/app/context/PageLoadingContext";
import Pagination from '@/app/components/pagination';
import FilterSelectBox, { type FilterOption } from '@/app/components/button/FilterSelectBox';
import NoticeForm, { type NoticeFormData } from './components/NoticeCrudModal';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';

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
  if (item.type === 'Notice') return null;
  if (item.status === 'error') return 'error';
  if (item.status === 'info') return 'info';
  if (item.status === 'event') return 'event';
  return null;
}

const statusLabel: Record<string, string> = {
  error: '오류',
  info: '정보',
  event: '이벤트',
};

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
  const setPageReady = usePageReady();
  const router = useRouter();

  const isAdmin = true;
  const [currentUserId, setCurrentUserId] = useState<number>(0);
  const [currentUserName, setCurrentUserName] = useState<string>('');

  const [alerts, setAlerts] = useState<AlertMockData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 현재 사용자 + 알림 목록 로드
  const fetchAlerts = useCallback(async (initial = false) => {
    const data = await getAlerts({ size: 10000 });
    setAlerts(data.items);
    setIsLoading(false);
    if (initial) setPageReady();
  }, [setPageReady]);

  useEffect(() => {
    apiFetch(`/user/current`)
      .then(res => res.json())
      .then(user => {
        setCurrentUserId(user.id ?? 0);
        setCurrentUserName(user.UserName ?? '');
      })
      .catch(() => {});
    fetchAlerts(true);

    const handleExternalRead = () => fetchAlerts();
    window.addEventListener('alert-read-changed', handleExternalRead);
    return () => window.removeEventListener('alert-read-changed', handleExternalRead);
  }, [fetchAlerts]);

  // URL 파라미터 id로 상세 패널 열기 (데이터 로드 후 적용)
  useEffect(() => {
    if (paramId && alerts.length > 0) {
      const id = Number(paramId);
      if (alerts.some(a => a.id === id)) {
        setSelectedAlertId(id);
      }
    }
  }, [paramId, alerts]);
  const [activeTab, setActiveTab] = useState<TabKey>(paramTab && ['total', 'schedule', 'robot', 'notice'].includes(paramTab) ? paramTab : 'total');
  const [noticeFormOpen, setNoticeFormOpen] = useState(false);
  const [noticeFormMode, setNoticeFormMode] = useState<'create' | 'edit'>('create');
  const [noticeFormDirty, setNoticeFormDirty] = useState(false);
  const [showTabConfirm, setShowTabConfirm] = useState<TabKey | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  const handleMarkRead = async (id: number) => {
    try {
      await markAlertRead(id);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a));
      window.dispatchEvent(new Event('alert-read-changed'));
    } catch {
      // API 실패 시 상태 변경하지 않음
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const filterType = tabTypeMap[activeTab] ?? undefined;
      await markAllAlertsRead(undefined, filterType ?? undefined);
      setAlerts(prev => prev.map(a => {
        if (!filterType || a.type === filterType) return { ...a, isRead: true };
        return a;
      }));
      window.dispatchEvent(new Event('alert-read-changed'));
    } catch {
      // API 실패 시 상태 변경하지 않음
    }
  };

  const handleSearch = () => {
    setAppliedSearch(searchQuery);
    setAppliedStatus(statusFilter);
    setCurrentPage(1);
  };

  const handleOpenCreateNotice = () => {
    setNoticeFormMode('create');
    setNoticeFormOpen(true);
  };

  const handleOpenEditNotice = () => {
    setNoticeFormMode('edit');
    setNoticeFormOpen(true);
  };

  const handleNoticeSubmit = async (data: NoticeFormData) => {
    let attachmentName = data.attachment?.name;
    let attachmentUrl: string | undefined;

    if (data.attachment) {
      const uploaded = await uploadNoticeFile(data.attachment);
      attachmentName = uploaded.original_name;
      attachmentUrl = uploaded.url;
    }

    if (noticeFormMode === 'create') {
      await createNotice({
        Title: data.title,
        Content: data.content,
        Importance: data.importance,
        UserId: currentUserId,
        AttachmentName: attachmentName,
        AttachmentUrl: attachmentUrl,
      });
    } else if (selectedAlertId !== null) {
      const alert = alerts.find(a => a.id === selectedAlertId);
      if (alert?.noticeId) {
        await updateNotice(alert.noticeId, {
          Title: data.title,
          Content: data.content,
          Importance: data.importance,
          AttachmentName: attachmentName,
          AttachmentUrl: attachmentUrl,
        });
      }
    }
    // API 호출 후 목록 새로고침 + 배지 갱신
    await fetchAlerts();
    window.dispatchEvent(new Event('alert-read-changed'));
  };

  const handleDeleteNotice = async () => {
    if (!selectedAlert?.noticeId) return;
    try {
      await deleteNotice(selectedAlert.noticeId);
      setShowDeleteConfirm(false);
      setSelectedAlertId(null);
      await fetchAlerts();
      window.dispatchEvent(new Event('alert-read-changed'));
    } catch (e) {
      console.error('공지사항 삭제 실패:', e);
      setShowDeleteConfirm(false);
    }
  };

  // 중복 제목 목록 (폼에 전달)
  const noticeTitles = useMemo(() =>
    alerts.filter(a => a.type === 'Notice' && a.id !== selectedAlertId).map(a => a.title ?? a.content),
    [alerts, selectedAlertId]
  );

  // 수정 중 원본 삭제 방어
  useEffect(() => {
    if (noticeFormOpen && noticeFormMode === 'edit' && selectedAlert === null) {
      setNoticeFormOpen(false);
    }
  }, [noticeFormOpen, noticeFormMode, selectedAlert]);

  // 탭 전환 핸들러
  const handleTabChange = (tabId: TabKey) => {
    if (noticeFormOpen && noticeFormDirty && tabId !== 'notice') {
      setShowTabConfirm(tabId);
      return;
    }
    if (tabId !== 'notice' && noticeFormOpen) setNoticeFormOpen(false);
    setActiveTab(tabId);
    setCurrentPage(1);
  };

  const handleTabConfirm = () => {
    if (showTabConfirm) {
      setNoticeFormOpen(false);
      setActiveTab(showTabConfirm);
      setCurrentPage(1);
      setShowTabConfirm(null);
    }
  };

  return (
    <PermissionGuard requiredPermissions={["alert-total", "alert-schedule", "alert-robot", "alert-notice"]}>
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
                  onClick={() => handleTabChange(tab.id as TabKey)}
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
            {isAdmin && activeTab === 'notice' && (
              <button className={styles.noticeCreateBtn} onClick={handleOpenCreateNotice}>
                공지 등록
              </button>
            )}
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
                          {statusLabel[displayStatus]}
                        </span>
                      )}
                      <p className={styles.alertContent}>
                        {item.robotName && (
                          <span className={styles.alertRobotName}>{item.robotName}</span>
                        )}
                        {item.title && item.title !== item.content && (
                          <span className={styles.alertTitle}>{item.title}</span>
                        )}
                        <span>{item.content}</span>
                      </p>
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

        {/* 우측 패널 - 알림 상세 / 공지 등록·수정 */}
        <div className={styles.rightPanel}>
          {noticeFormOpen ? (
            <NoticeForm
              mode={noticeFormMode}
              initial={noticeFormMode === 'edit' ? selectedAlert : null}
              existingTitles={noticeTitles}
              onClose={() => setNoticeFormOpen(false)}
              onSubmit={handleNoticeSubmit}
              onDirtyChange={setNoticeFormDirty}
            />
          ) : selectedAlert ? (
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
                        {statusLabel[status]}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div className={styles.detailHeaderBtns}>
                  {selectedAlert.status === 'error' && (
                    <button
                      className={styles.viewLogBtn}
                      onClick={() => router.push(`/dataManagement?tab=log&search=${encodeURIComponent(selectedAlert.robotName || '')}`)}
>
                      상세 로그
                    </button>
                  )}
                  {isAdmin && selectedAlert.type === 'Notice' && (
                    <>
                      <button className={styles.noticeEditBtn} onClick={handleOpenEditNotice}>
                        수정
                      </button>
                      <button className={styles.noticeDeleteBtn} onClick={() => setShowDeleteConfirm(true)}>
                        삭제
                      </button>
                    </>
                  )}
                  <button
                    className={`${styles.markReadBtn} ${selectedAlert.isRead ? styles.markReadBtnDone : ''}`}
                    onClick={() => !selectedAlert.isRead && handleMarkRead(selectedAlert.id)}
                    disabled={selectedAlert.isRead}
                  >
                    {selectedAlert.isRead ? '읽음 완료' : '읽음 처리'}
                  </button>
                </div>
              </div>

              <div className={styles.detailMetaInline}>
                <span className={styles.detailMetaItem}>
                  <span className={styles.detailMetaLabel}>날짜</span>
                  <span className={styles.detailMetaValue}>{selectedAlert.date}</span>
                </span>
                {selectedAlert.robotName && (
                  <>
                    <span className={styles.detailMetaDivider}>|</span>
                    <span className={styles.detailMetaItem}>
                      <span className={styles.detailMetaLabel}>로봇</span>
                      <span className={styles.detailMetaValue}>{selectedAlert.robotName}</span>
                    </span>
                  </>
                )}
                {selectedAlert.author && (
                  <>
                    <span className={styles.detailMetaDivider}>|</span>
                    <span className={styles.detailMetaItem}>
                      <span className={styles.detailMetaLabel}>작성자</span>
                      <span className={styles.detailMetaValue}>{selectedAlert.author}</span>
                    </span>
                  </>
                )}
                {selectedAlert.importance && (
                  <>
                    <span className={styles.detailMetaDivider}>|</span>
                    <span className={`${styles.importanceBadge} ${
                      selectedAlert.importance === 'high' ? styles.importanceHigh
                      : selectedAlert.importance === 'normal' ? styles.importanceNormal
                      : styles.importanceLow
                    }`}>
                      {selectedAlert.importance === 'high' ? '높음' : selectedAlert.importance === 'normal' ? '일반' : '낮음'}
                    </span>
                  </>
                )}
              </div>

              <div className={styles.detailBody}>
                {selectedAlert.title && (
                  <div className={styles.detailTitleText}>
                    {selectedAlert.title}
                  </div>
                )}
                <div className={styles.detailContentText}>
                  {selectedAlert.content}
                </div>

                {selectedAlert.attachmentName && (
                  <div className={styles.detailAttachment}>
                    <span className={styles.detailAttachmentIcon}>📎</span>
                    {selectedAlert.attachmentUrl ? (
                      <a
                        href={`${API_BASE}${selectedAlert.attachmentUrl}`}
                        className={styles.detailAttachmentLink}
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const res = await apiFetch(`${selectedAlert.attachmentUrl}`);
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = selectedAlert.attachmentName || 'download';
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        {selectedAlert.attachmentName}
                      </a>
                    ) : (
                      <span className={styles.detailAttachmentName}>
                        {selectedAlert.attachmentName}
                        <span className={styles.attachmentNoFile}> (파일 없음)</span>
                      </span>
                    )}
                  </div>
                )}

                {selectedAlert.detail && (
                  <div className={styles.detailNoticeBody}>
                    {selectedAlert.type === 'Schedule' ? (() => {
                      const lines = selectedAlert.detail.split('\n').filter(Boolean);
                      const arrivals = lines.filter(l => l.includes('도착'));
                      const totalMatch = lines[0]?.match(/(\d+)개 포인트/);
                      const total = totalMatch ? Number(totalMatch[1]) : 0;
                      const arrived = arrivals.length;
                      const hasError = lines.some(l => l.startsWith('❌'));
                      const errorLine = lines.find(l => l.startsWith('❌'));
                      const isComplete = selectedAlert.content === '네비게이션 완료';

                      // "경로: A → B → C" 라인에서 장소명 추출
                      const routeLine = lines.find(l => l.startsWith('경로:'));
                      const routeNames = routeLine
                        ? routeLine.replace('경로:', '').trim().split('→').map(s => s.trim())
                        : [];

                      // 도착한 장소명 목록 (로그에서 추출)
                      const arrivedNames = arrivals.map(l => l.replace(/\s*도착.*$/, '').trim());

                      // 오류 발생 장소 인덱스 (도착한 다음 지점)
                      const errorAtIndex = hasError ? arrived : -1;

                      return (
                        <>
                          {/* 첫 줄: 스케줄/경로 제목 */}
                          <div className={styles.timelineHeader}>
                            {lines[0]}
                          </div>

                          {total > 0 && (
                            <div className={styles.progressBar}>
                              <div className={styles.progressInfo}>
                                <span>{arrived}/{total} 완료</span>
                                <span className={
                                  hasError ? styles.progressStatusError
                                  : isComplete ? styles.progressStatusDone
                                  : styles.progressStatusActive
                                }>
                                  {hasError ? '오류 중단' : isComplete ? '완료' : '진행 중'}
                                </span>
                              </div>
                              <div className={styles.progressTrack}>
                                <div
                                  className={`${styles.progressFill} ${hasError ? styles.progressFillError : isComplete ? styles.progressFillDone : ''}`}
                                  style={{ width: `${total > 0 ? (arrived / total) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {/* 경로 전체 스텝 표시 */}
                          {routeNames.length > 0 ? (
                            <div className={styles.routeSteps}>
                              {routeNames.map((name, i) => {
                                const isDone = arrivedNames.includes(name) || i < arrived;
                                const isErrorPoint = i === errorAtIndex;
                                const isPending = !isDone && !isErrorPoint;

                                return (
                                  <div key={i} className={styles.routeStep}>
                                    <div className={styles.routeStepIndicator}>
                                      <span className={`${styles.routeStepDot} ${
                                        isErrorPoint ? styles.routeStepDotError
                                        : isDone ? styles.routeStepDotDone
                                        : styles.routeStepDotPending
                                      }`}>
                                        {isErrorPoint ? '!' : isDone ? '✓' : (i + 1)}
                                      </span>
                                      {i < routeNames.length - 1 && (
                                        <span className={`${styles.routeStepLine} ${
                                          isDone && !isErrorPoint ? styles.routeStepLineDone : ''
                                        }`} />
                                      )}
                                    </div>
                                    <div className={`${styles.routeStepContent} ${
                                      isErrorPoint ? styles.routeStepContentError
                                      : isPending ? styles.routeStepContentPending : ''
                                    }`}>
                                      <span className={styles.routeStepName}>{name}</span>
                                      {isDone && <span className={styles.routeStepBadgeDone}>도착</span>}
                                      {isErrorPoint && <span className={styles.routeStepBadgeError}>오류 중단</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            /* 경로 정보 없는 기존 로그: 기존 타임라인 방식 */
                            <div className={styles.scheduleTimeline}>
                              {lines.map((line, i) => {
                                const isError = line.startsWith('❌');
                                return (
                                  <div key={i} className={`${styles.timelineItem} ${isError ? styles.timelineError : ''}`}>
                                    <span className={`${styles.timelineDot} ${isError ? styles.timelineDotError : ''}`} />
                                    <span>{line}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* 오류 상세 표시 */}
                          {errorLine && (
                            <div className={styles.routeErrorDetail}>
                              {errorLine}
                            </div>
                          )}
                        </>
                      );
                    })() : (
                      selectedAlert.detail
                    )}
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

      {showTabConfirm && (
        <CancelConfirmModal
          message="작성 중인 내용이 있습니다. 탭을 이동하시겠습니까?"
          onConfirm={handleTabConfirm}
          onCancel={() => setShowTabConfirm(null)}
        />
      )}
      {showDeleteConfirm && (
        <CancelConfirmModal
          message="해당 공지사항을 삭제하시겠습니까?"
          onConfirm={handleDeleteNotice}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
    </PermissionGuard>
  );
}
