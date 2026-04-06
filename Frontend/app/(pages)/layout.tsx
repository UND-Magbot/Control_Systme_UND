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
  const { isAuthenticated, isLoading, logout, refreshUser } = useAuth();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [showSessionExpired, setShowSessionExpired] = useState(false);

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

  // 미인증 시 로그인 페���지로 (세션 만료 여부 구분)
  const wasAuthenticated = React.useRef(false);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticated.current = true;
    }
    if (!isLoading && !isAuthenticated) {
      if (wasAuthenticated.current) {
        // 세션 만료 알림을 먼저 표시 후 리다이렉트
        setShowSessionExpired(true);
        const timer = setTimeout(() => {
          router.replace("/login?reason=session_expired");
        }, 2000);
        return () => clearTimeout(timer);
      } else {
        router.replace("/login");
      }
    }
  }, [isLoading, isAuthenticated, router]);

  // 세션 만료 알림 표시 중
  if (showSessionExpired) {
    return (
      <div style={{
        position: "fixed", inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        display: "flex", justifyContent: "center", alignItems: "center",
        zIndex: 9999,
      }}>
        <div style={{
          background: "var(--surface-3)",
          borderLeft: "3px solid var(--color-error)",
          borderRadius: "8px",
          padding: "20px 32px",
          color: "var(--text-primary)",
          fontSize: "var(--font-size-md)",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
        }}>
          세션이 만료되었습니다. 다시 로그인해주세요.
        </div>
      </div>
    );
  }

  // 로딩 중 또는 미��증
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
