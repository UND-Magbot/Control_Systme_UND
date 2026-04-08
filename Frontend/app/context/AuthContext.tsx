"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "@/app/config";

export type AuthUser = {
  id: number;
  login_id: string;
  user_name: string;
  role: number; // 1=admin, 2=user
  permissions: string[];
};

type AuthContextType = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  isManualLogout: React.MutableRefObject<boolean>;
  hasPermission: (menuId: string) => boolean;
  login: (loginId: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isManualLogout = useRef(false);

  const isAuthenticated = user !== null;
  const isAdmin = user?.role === 1;

  const hasPermission = useCallback(
    (menuId: string): boolean => {
      if (!user) return false;
      if (user.role === 1) return true; // admin bypass
      return user.permissions.includes(menuId);
    },
    [user]
  );

  // 현재 사용자 정보 가져오기 (401 시 refresh 시도, 리다이렉트 없음)
  const refreshUser = useCallback(async () => {
    const fetchOpts: RequestInit = {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    };
    try {
      let res = await fetch(`${API_BASE}/api/auth/me`, fetchOpts);
      if (res.status === 401) {
        // access token 만료 → refresh 시도
        const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          ...fetchOpts,
        });
        if (refreshRes.ok) {
          res = await fetch(`${API_BASE}/api/auth/me`, fetchOpts);
        }
      }
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  // 로그인
  const login = useCallback(
    async (loginId: string, password: string) => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ login_id: loginId, password }),
        });

        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          return { success: true };
        }

        const errorData = await res.json().catch(() => ({ detail: "로그인에 실패했습니다" }));
        return { success: false, error: errorData.detail };
      } catch {
        return { success: false, error: "서버에 연결할 수 없습니다" };
      }
    },
    []
  );

  // 로그아웃
  const logout = useCallback(async () => {
    isManualLogout.current = true;
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
    } catch {
      // 무시
    }
    setUser(null);
  }, []);

  // 앱 시작 시 인증 확인
  useEffect(() => {
    (async () => {
      await refreshUser();
      setIsLoading(false);
    })();
  }, [refreshUser]);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated, isAdmin, isLoading, isManualLogout, hasPermission, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
