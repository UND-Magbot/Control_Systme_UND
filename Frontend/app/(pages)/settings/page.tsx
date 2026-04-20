"use client";

import PermissionGuard from "@/app/components/common/PermissionGuard";
import SettingsTabs from "./components/SettingsTabs";

export default function Page() {
  return (
    <PermissionGuard requiredPermissions={["menu-permissions", "db-backup"]}>
      <SettingsTabs />
    </PermissionGuard>
  );
}
