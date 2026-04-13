"use client";

import dynamic from "next/dynamic";

const DebugMapPanel = dynamic(() => import("@/app/components/map/DebugMapPanel"), { ssr: false });

export default function DebugMapPanelLoader() {
  return <DebugMapPanel />;
}
