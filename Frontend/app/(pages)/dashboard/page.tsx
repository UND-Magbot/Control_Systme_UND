import React from 'react';
import DashboardClient from "./components/DashboardClient";
import PermissionGuard from "@/app/components/common/PermissionGuard";
import getFloors from '@/app/lib/floorInfo';
import VideoStatus from '@/app/lib/videoStatus';

export default async function DashboardPage() {
  const floors = await getFloors();
  return (
    <PermissionGuard requiredPermissions={["dashboard"]}>
      <DashboardClient
        floors={floors}
        videoStatus={VideoStatus()}
      />
    </PermissionGuard>
  );
}
