"use client";

import React from "react";
import { useAuth } from "@/app/context/AuthContext";

/**
 * 페이지 레벨 권한 가드.
 * requiredPermissions 중 하나라도 권한이 있고 DB에 존재·노출 상태면 children 렌더링.
 * 아니면 "접근 권한이 없습니다" 표시.
 */
export default function PermissionGuard({
  requiredPermissions,
  children,
}: {
  requiredPermissions: string[];
  children: React.ReactNode;
}) {
  const { hasPermission, isMenuVisible } = useAuth();

  const hasAccess = requiredPermissions.some(
    (id) => hasPermission(id) && isMenuVisible(id)
  );

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
