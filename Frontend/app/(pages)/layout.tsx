"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Header from "@/app/components/common/Header";
import Sidebar from "@/app/components/common/Sidebar";
import AlertsConfirmModal from "@/app/components/modal/AlertsConfirmModal";
import IdleTimeoutWarning from "@/app/components/modal/IdleTimeoutWarning";
import GlobalErrorAlert from "@/app/components/common/GlobalErrorAlert";
import GlobalLoading from "@/app/components/common/GlobalLoading";
import { ToastProvider } from "@/app/components/common/Toast";
import { SidebarProvider } from "@/app/context/SidebarContext";
import { AlertProvider } from "@/app/context/AlertContext";
import { useAuth } from "@/app/context/AuthContext";
import { useIdleTimeout } from "@/app/hooks/useIdleTimeout";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;    // 30분
const WARNING_BEFORE_MS = 5 * 60 * 1000;   // 25분에 경고 표시

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, logout, refreshUser } = useAuth();
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

  // 미인증 시 로그인 페이지로
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  // 로딩 중 또는 미인증
  if (isLoading || !isAuthenticated) return null;

  return (
    <SidebarProvider>
      <AlertProvider>
        <ToastProvider>
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
        </ToastProvider>
      </AlertProvider>
    </SidebarProvider>
  );
}
