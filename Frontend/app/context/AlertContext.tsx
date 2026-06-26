"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { getAlerts, markAlertRead, markAllAlertsRead } from "@/app/lib/alertData";
import { useVisibilityAwareInterval } from "@/app/hooks/useVisibilityAwareInterval";
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

// 폴링 주기 — 2초. 열화상 고온 감지처럼 즉시 모달이 떠야 하는 알림 때문에
// 짧게 잡는다. 응답 크기가 작아 backend 부하는 미미하다.
// (정말 0지연이 필요하면 SSE/WebSocket으로 전환 검토)
const POLL_INTERVAL = 2_000;
// 백그라운드 탭에서는 완화(2s→10s). 경보는 백그라운드에서도 완전히 끊지 않고
// 최소 갱신을 유지한다(C-7). 탭 복귀 시 즉시 갱신된다.
const POLL_INTERVAL_HIDDEN = 10_000;

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [unreadAlerts, setUnreadAlerts] = useState<AlertMockData[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>(EMPTY_COUNTS);

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

  // 폴링 — 가시성 인지(C-7): 보일 때 2s, 가려지면 10s, 복귀 시 즉시 갱신
  useVisibilityAwareInterval(refresh, {
    activeMs: POLL_INTERVAL,
    hiddenMs: POLL_INTERVAL_HIDDEN,
    immediate: true,
  });

  // 외부 읽음 변경 이벤트 수신
  useEffect(() => {
    const handleExternalChange = () => refresh();
    window.addEventListener("alert-read-changed", handleExternalChange);
    return () => {
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
