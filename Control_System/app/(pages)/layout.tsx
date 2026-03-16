"use client";

import React, { useState } from "react";
import Header from "@/app/components/common/Header";
import Sidebar from "@/app/components/common/Sidebar";
import Footer from "@/app/components/common/Footer";
import AlertsConfirmModal from "@/app/components/modal/AlertsConfirmModal";

export default function PagesLayout({ children }: { children: React.ReactNode }) {

  const [alertsOpen, setAlertsOpen] = useState(false);

  return (
    <>
      <Header onAlertClick={() => setAlertsOpen(true)} />
      <Sidebar />
      <main className="page-container">{children}</main>
      <Footer />

      <AlertsConfirmModal
        isOpen={alertsOpen}
        onClose={() => setAlertsOpen(false)}
      />
    </>
  );
}