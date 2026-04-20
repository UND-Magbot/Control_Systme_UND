"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Header from "@/app/components/common/Header";
import Sidebar from "@/app/components/common/Sidebar";
import GlobalErrorAlert from "@/app/components/common/GlobalErrorAlert";
import GlobalLoading from "@/app/components/common/GlobalLoading";
import { PageLoadingProvider } from "@/app/context/PageLoadingContext";
import { ToastProvider } from "@/app/components/common/Toast";
import { SidebarProvider } from "@/app/context/SidebarContext";
import { AlertProvider } from "@/app/context/AlertContext";
import { RobotStatusProvider } from "@/app/context/RobotStatusContext";
import { useAuth } from "@/app/context/AuthContext";

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, isManualLogout } = useAuth();
  // 미인증 시 로그인 페이지로 (로그아웃/세션 만료 구분)
  const wasAuthenticated = React.useRef(false);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticated.current = true;
    }
    if (!isLoading && !isAuthenticated) {
      if (wasAuthenticated.current && !isManualLogout.current) {
        router.replace("/login?reason=session_expired");
      } else {
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
          <Header />
          <Sidebar />
          <main className="page-container">{children}</main>

          <GlobalErrorAlert />
          </PageLoadingProvider>
        </ToastProvider>
      </AlertProvider>
      </RobotStatusProvider>
    </SidebarProvider>
  );
}
