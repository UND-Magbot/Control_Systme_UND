"use client";

import React, { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Header from "@/app/components/common/Header";
import Sidebar from "@/app/components/common/Sidebar";
import AlertsConfirmModal from "@/app/components/modal/AlertsConfirmModal";
import GlobalLoading from "@/app/components/common/GlobalLoading";
import { ToastProvider } from "@/app/components/common/Toast";
import { SidebarProvider } from "@/app/context/SidebarContext";

function getAuthCookie(): boolean {
  return document.cookie.split(";").some((c) => c.trim().startsWith("auth="));
}

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);

  useEffect(() => {
    if (!getAuthCookie()) {
      setIsAuthed(false);
      router.replace("/login");
    } else {
      setIsAuthed(true);
    }
  }, [router, pathname]);

  if (!isAuthed) return null;

  return (
    <SidebarProvider>
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
    </SidebarProvider>
  );
}
