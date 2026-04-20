"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getAlerts, markAlertRead, markAllAlertsRead } from "@/app/lib/alertData";
import type { AlertMockData } from "@/app/types";

type UnreadCounts = {
  total: number;
  robot: number;
  schedule: number;
  notice: number;
};

type AlertContextType = {
  /** 미읽음 알림 목록 (단일 데이터 소스) */
  unreadAlerts: AlertMockData[];
  /** 타입별 미읽음 카운트 */
  unreadCounts: UnreadCounts;
  /** 데��터 새로고침 */
  refresh: () => Promise<void>;
  /** 개별 읽음 처리 */
  handleMarkRead: (alertId: number) => Promise<void>;
  /** 전체 읽음 처리 */
  handleMarkAllRead: () => Promise<void>;
};

const EMPTY_COUNTS: UnreadCounts = { total: 0, robot: 0, schedule: 0, notice: 0 };

const AlertContext = createContext<AlertContextType>({
  unreadAlerts: [],
  unreadCounts: EMPTY_COUNTS,
  refresh: async () => {},
  handleMarkRead: async () => {},
  handleMarkAllRead: async () => {},
});

const POLL_INTERVAL = 30_000;

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [unreadAlerts, setUnreadAlerts] = useState<AlertMockData[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>(EMPTY_COUNTS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getAlerts({ is_read: "false", size: 200 });
      setUnreadAlerts(data.items);
      setUnreadCounts(data.unread_count);
    } catch {
      // 실패 시 기존 상태 유지 (0으로 덮어쓰지 않음)
    }
  }, []);

  const handleMarkRead = useCallback(async (alertId: number) => {
    try {
      await markAlertRead(alertId);
      setUnreadAlerts(prev => {
        const next = prev.filter(a => a.id !== alertId);
        setUnreadCounts(computeCounts(next));
        return next;
      });
      window.dispatchEvent(new Event("alert-read-changed"));
    } catch {
      // API 실패 시 상태 변경하지 않음
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllAlertsRead();
      setUnreadAlerts([]);
      setUnreadCounts(EMPTY_COUNTS);
      window.dispatchEvent(new Event("alert-read-changed"));
    } catch {
      // API 실패 시 상태 변경하지 않음
    }
  }, []);

  // 폴링 + 외부 이벤트 수신
  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, POLL_INTERVAL);

    const handleExternalChange = () => refresh();
    window.addEventListener("alert-read-changed", handleExternalChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("alert-read-changed", handleExternalChange);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ unreadAlerts, unreadCounts, refresh, handleMarkRead, handleMarkAllRead }),
    [unreadAlerts, unreadCounts, refresh, handleMarkRead, handleMarkAllRead]
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
    </AlertContext.Provider>
  );
}

export function useAlertContext() {
  return useContext(AlertContext);
}

/** 알림 목록에서 카운트 계산 */
function computeCounts(alerts: AlertMockData[]): UnreadCounts {
  const counts: UnreadCounts = { total: 0, robot: 0, schedule: 0, notice: 0 };
  for (const a of alerts) {
    counts.total++;
    if (a.type === "Schedule") counts.schedule++;
    else if (a.type === "Robot") counts.robot++;
    else if (a.type === "Notice") counts.notice++;
  }
  return counts;
}
