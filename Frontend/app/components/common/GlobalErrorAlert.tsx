'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import styles from './GlobalErrorAlert.module.css';
import { type AlertMockData } from '@/app/types';
import { getAlerts, markAlertRead } from '@/app/lib/alertData';

const POLL_INTERVAL = 30_000;

export default function GlobalErrorAlert() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertMockData[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const fetchErrorAlerts = useCallback(async () => {
    try {
      const data = await getAlerts({ type: 'Robot', status: 'error', is_read: 'false', size: 100 });
      const errors = data.items.filter(
        (a) => a.type === 'Robot' && a.status === 'error' && !a.isRead
      );
      if (errors.length === 0) {
        setAlerts([]);
        return;
      }
      // 신규 에러가 있으면 dismissed 해제하여 모달 재표시
      setAlerts((prev) => {
        const prevIds = new Set(prev.map((a) => a.id));
        const hasNew = errors.some((e) => !prevIds.has(e.id));
        if (hasNew) setDismissed(false);
        return errors;
      });
    } catch {
      // 실패 시 무시
    }
  }, []);

  useEffect(() => {
    fetchErrorAlerts();
    const timer = setInterval(fetchErrorAlerts, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchErrorAlerts]);

  useEffect(() => {
    const handler = () => fetchErrorAlerts();
    window.addEventListener('alert-read-changed', handler);
    return () => window.removeEventListener('alert-read-changed', handler);
  }, [fetchErrorAlerts]);

  // 단건 확인
  const handleConfirm = async () => {
    const target = alerts[0];
    if (!target) return;
    await markAlertRead(target.id);
    window.dispatchEvent(new Event('alert-read-changed'));
    setAlerts((prev) => prev.slice(1));
  };

  // 전체 확인 (리스트 모드)
  const handleConfirmAll = async () => {
    await Promise.all(alerts.map((a) => markAlertRead(a.id)));
    window.dispatchEvent(new Event('alert-read-changed'));
    setAlerts([]);
  };

  // 상세 보기 — 모달 닫고 알림 상세로 이동
  const handleDetail = (id: number) => {
    setDismissed(true);
    router.push(`/alerts?tab=robot&id=${id}`);
  };

  // 닫기 — 모달만 닫음 (신규 에러 발생 시 기존 미읽음과 함께 재표시)
  const handleDismiss = () => {
    setDismissed(true);
  };

  if (dismissed || alerts.length === 0) return null;

  const isSingle = alerts.length === 1;
  const current = alerts[0];

  // ── 단건 UI ──
  if (isSingle) {
    return (
      <div className={styles.overlay}>
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <span className={styles.warningIcon}>&#9888;</span>
              <span className={styles.headerTitle}>로봇 에러 알림</span>
            </div>
          </div>

          <div className={styles.body} onClick={() => handleDetail(current.id)} style={{ cursor: 'pointer' }}>
            {current.robotName && (
              <div className={styles.robotName}>{current.robotName}</div>
            )}
            <div className={styles.content}>{current.content}</div>
            <div className={styles.date}>{current.date}</div>
          </div>

          <div className={styles.footer}>
            <div className={styles.footerRight}>
              <button className={styles.detailBtn} onClick={() => handleDetail(current.id)}>
                상세 보기
              </button>
              <button className={styles.confirmBtn} onClick={handleConfirm}>
                확인
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 다건 UI (리스트형) ──
  return (
    <div className={styles.overlay}>
      <div className={`${styles.container} ${styles.containerList}`}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.warningIcon}>&#9888;</span>
            <span className={styles.headerTitle}>로봇 에러 알림</span>
            <span className={styles.countBadge}>{alerts.length}건</span>
          </div>
          <button className={styles.closeBtn} onClick={handleDismiss} aria-label="닫기">
            &#10005;
          </button>
        </div>

        <div className={styles.list}>
          {alerts.map((item) => (
            <div
              key={item.id}
              className={styles.listItem}
              onClick={() => handleDetail(item.id)}
            >
              <div className={styles.listItemDot} />
              <div className={styles.listItemBody}>
                {item.robotName && (
                  <span className={styles.listItemRobot}>{item.robotName}</span>
                )}
                <span className={styles.listItemContent}>{item.content}</span>
                <span className={styles.listItemDate}>{item.date}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button className={styles.dismissBtn} onClick={handleDismiss}>
            닫기
          </button>
          <div className={styles.footerRight}>
            <button className={styles.detailBtn} onClick={() => { setDismissed(true); router.push('/alerts?tab=robot'); }}>
              알림 화면으로 이동
            </button>
            <button className={styles.confirmAllBtn} onClick={handleConfirmAll}>
              모두 확인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
