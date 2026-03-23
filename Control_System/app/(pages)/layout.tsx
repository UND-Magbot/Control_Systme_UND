"use client";

import React, { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Header from "@/app/components/common/Header";
import Sidebar from "@/app/components/common/Sidebar";
import AlertsConfirmModal from "@/app/components/modal/AlertsConfirmModal";
import GlobalLoading from "@/app/components/common/GlobalLoading";
import { ToastProvider } from "@/app/components/common/Toast";

function getAuthCookie(): boolean {
  return document.cookie.split(";").some((c) => c.trim().startsWith("auth="));
}

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);

  // 경로가 바뀔 때마다 인증 쿠키 재검증 (URL 직접 입력, 뒤로가기 등 대응)
  useEffect(() => {
    if (!getAuthCookie()) {
      setIsAuthed(false);
      router.replace("/login");
    } else {
      setIsAuthed(true);
    }
  }, [router, pathname]);

  // 인증 확인 전이거나 미인증이면 아무것도 렌더링하지 않음
  if (!isAuthed) return null;

  return (
    <ToastProvider>
      <GlobalLoading />
      <Header onAlertClick={() => setAlertsOpen(true)} />
      <Sidebar />
      <main className="page-container">{children}</main>

      <AlertsConfirmModal
        isOpen={alertsOpen}
        onClose={() => setAlertsOpen(false)}
      />
    </ToastProvider>
  );
}