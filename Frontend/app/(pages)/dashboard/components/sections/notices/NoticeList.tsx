"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './NoticeList.module.css';
import { getAlerts } from '@/app/lib/alertData';
import type { AlertMockData } from '@/app/types';

const VISIBLE_COUNT = 3;

function formatDate(date: string): string {
  const datePart = date.slice(2, 10);   // YY-MM-DD
  const timePart = date.slice(11);      // HH:mm
  const seconds = timePart.length === 5 ? ':00' : '';
  return `${datePart} ${timePart}${seconds}`;
}

type NoticeListProps = {
  canLinkNotice?: boolean;
};

export default function NoticeList({ canLinkNotice = true }: NoticeListProps) {
  const router = useRouter();
  const [allNotices, setAllNotices] = useState<AlertMockData[]>([]);

  useEffect(() => {
    getAlerts({ type: "Notice", size: VISIBLE_COUNT })
      .then((res) => setAllNotices(res.items))
      .catch(() => setAllNotices([]));
  }, []);

  // 미읽음 우선 → 최신순 정렬
  const notices = useMemo(() => {
    return [...allNotices].sort((a, b) => {
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      return b.date.localeCompare(a.date);
    });
  }, [allNotices]);

  const visibleNotices = notices.slice(0, VISIBLE_COUNT);

  return (
    <div className={styles.wrapper}>
      <div className={`${styles["notice-list"]} ${styles.fadeIn}`}>
        {notices.length === 0 ? (
          <div className={styles.emptyState}>
            <span>등록된 공지사항이 없습니다</span>
            <span className={styles.emptyStateSub}>새로운 공지가 등록되면 여기에 표시됩니다</span>
          </div>
        ) : (
          <>
            {visibleNotices.map((notice) => {
              const isUnread = !notice.isRead;

              const itemClasses = [
                styles["notice-item"],
                isUnread ? styles["notice-item--unread"] : '',
              ].filter(Boolean).join(' ');

              return (
                <div
                  key={notice.id}
                  className={itemClasses}
                  onClick={canLinkNotice ? () => router.push(`/alerts?tab=notice&id=${notice.id}`) : undefined}
                  style={canLinkNotice ? undefined : { cursor: "default" }}
                  title={notice.title ?? notice.content}
                >
                  <div>
                    {isUnread && <span className={styles.newBadge}>NEW</span>}
                    <p className={styles.content}>{notice.title ?? notice.content}</p>
                  </div>
                  <span className={styles.time}>{formatDate(notice.date)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
