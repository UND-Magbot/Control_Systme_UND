"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Header from "@/app/components/common/Header";
import Sidebar from "@/app/components/common/Sidebar";
import AlertsConfirmModal from "@/app/components/modal/AlertsConfirmModal";
import IdleTimeoutWarning from "@/app/components/modal/IdleTimeoutWarning";
import GlobalErrorAlert from "@/app/components/common/GlobalErrorAlert";
import GlobalLoading from "@/app/components/common/GlobalLoading";
import { PageLoadingProvider } from "@/app/context/PageLoadingContext";
import { ToastProvider } from "@/app/components/common/Toast";
import { SidebarProvider } from "@/app/context/SidebarContext";
import { AlertProvider } from "@/app/context/AlertContext";
import { RobotStatusProvider } from "@/app/context/RobotStatusContext";
import { useAuth } from "@/app/context/AuthContext";
import { useIdleTimeout } from "@/app/hooks/useIdleTimeout";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;    // 30분
const WARNING_BEFORE_MS = 5 * 60 * 1000;   // 25분에 경고 표시

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, isManualLogout, logout, refreshUser } = useAuth();
  const [alertsOpen, setAlertsOpen] = useState(false);

  const handleTimeout = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [logout, router]);

  const handleExtend = useCallback(async () => {
    await refreshUser();
  }, [refreshUser]);

  const { isWarningVisible, remainingSeconds, extendSession, logoutNow } =
    useIdleTimeout({
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      warningBeforeMs: WARNING_BEFORE_MS,
      onTimeout: handleTimeout,
      onExtend: handleExtend,
      enabled: isAuthenticated,
    });

  // 미인증 시 로그인 페이지로 (로그아웃/세션 만료 구분)
  const wasAuthenticated = React.useRef(false);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticated.current = true;
    }
    if (!isLoading && !isAuthenticated) {
      if (wasAuthenticated.current && !isManualLogout.current) {
        // 세션 만료: 로그인 페이지 상단 배너로 표시
        router.replace("/login?reason=session_expired");
      } else {
        // 자발적 로그아웃 또는 미인증 상태
        router.replace("/login");
      }
    }
  }, [isLoading, isAuthenticated, isManualLogout, router]);

  // 로딩 중 또는 미인증
  if (isLoading || !isAuthenticated) return null;

  return (
    <SidebarProvider>
      <RobotStatusProvider>
      <AlertProvider>
        <ToastProvider>
          <PageLoadingProvider>
          <GlobalLoading />
          <Header onAlertClick={() => setAlertsOpen(true)} />
          <Sidebar />
          <main className="page-container">{children}</main>

          <AlertsConfirmModal
            isOpen={alertsOpen}
            onClose={() => setAlertsOpen(false)}
          />

          <GlobalErrorAlert />

          {isWarningVisible && (
            <IdleTimeoutWarning
              remainingSeconds={remainingSeconds}
              onExtend={extendSession}
              onLogout={logoutNow}
            />
          )}
          </PageLoadingProvider>
        </ToastProvider>
      </AlertProvider>
      </RobotStatusProvider>
    </SidebarProvider>
  );
}
