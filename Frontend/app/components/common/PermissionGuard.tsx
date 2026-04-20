"use client";

import React from "react";
import { useAuth } from "@/app/context/AuthContext";

/**
 * 페이지 레벨 권한 가드.
 * requiredPermissions 중 하나라도 있으면 children 렌더링,
 * 없으면 "접근 권한이 없습니다" 메시지 표시.
 */
export default function PermissionGuard({
  requiredPermissions,
  children,
}: {
  requiredPermissions: string[];
  children: React.ReactNode;
}) {
  const { hasPermission } = useAuth();

  const hasAccess = requiredPermissions.some((id) => hasPermission(id));

  if (!hasAccess) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "60vh",
          fontSize: "18px",
          color: "var(--text-secondary, #888)",
        }}
      >
        접근 권한이 없습니다.
      </div>
    );
  }

  return <>{children}</>;
}
