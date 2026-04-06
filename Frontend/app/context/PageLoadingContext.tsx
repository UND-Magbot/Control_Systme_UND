"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";

type PageLoadingContextType = {
  isPageLoading: boolean;
  setPageReady: () => void;
};

const PageLoadingContext = createContext<PageLoadingContextType>({
  isPageLoading: false,
  setPageReady: () => {},
});

const FALLBACK_TIMEOUT_MS = 5000; // 5초 내 setPageReady 안 오면 자동 해제

export function PageLoadingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isPageLoading, setIsPageLoading] = useState(true);
  const prevPathRef = useRef(pathname);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPageReady = useCallback(() => {
    if (fallbackRef.current) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
    setIsPageLoading(false);
  }, []);

  // 경로 변경 시 로딩 시작
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      setIsPageLoading(true);

      // fallback: 페이지가 setPageReady를 호출하지 않는 경우 대비
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
      fallbackRef.current = setTimeout(() => {
        setIsPageLoading(false);
      }, FALLBACK_TIMEOUT_MS);
    }
  }, [pathname]);

  // 초기 마운트 fallback
  useEffect(() => {
    fallbackRef.current = setTimeout(() => {
      setIsPageLoading(false);
    }, FALLBACK_TIMEOUT_MS);
    return () => {
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    };
  }, []);

  return (
    <PageLoadingContext.Provider value={{ isPageLoading, setPageReady }}>
      {children}
    </PageLoadingContext.Provider>
  );
}

/** 페이지 데이터 로드 완료 시 호출하는 훅 */
export function usePageReady() {
  const { setPageReady } = useContext(PageLoadingContext);
  return setPageReady;
}

export function usePageLoading() {
  return useContext(PageLoadingContext);
}
