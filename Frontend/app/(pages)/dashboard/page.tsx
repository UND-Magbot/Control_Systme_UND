import React from 'react';
import DashboardClient from "./components/DashboardClient";
import PermissionGuard from "@/app/components/common/PermissionGuard";
import Floors from '@/app/lib/floorInfo';
import VideoStatus from '@/app/lib/videoStatus';

export default function DashboardPage() {
  return (
    <PermissionGuard requiredPermissions={["dashboard"]}>
      <DashboardClient
        floors={Floors()}
        videoStatus={VideoStatus()}
      />
    </PermissionGuard>
  );
}
