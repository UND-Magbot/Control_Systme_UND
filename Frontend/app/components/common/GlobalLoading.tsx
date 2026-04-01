"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./GlobalLoading.module.css";

const MIN_DISPLAY_MS = 300;   // 최소 표시 시간 (깜빡임 방지)
const FADE_DURATION = 300;

export default function GlobalLoading() {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const [isFading, setIsFading] = useState(false);
  const [visible, setVisible] = useState(true);
  const prevPathRef = useRef(pathname);
  const showTimeRef = useRef(Date.now());

  // 경로 변경 → 로딩 시작
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      showTimeRef.current = Date.now();
      setIsLoading(true);
      setIsFading(false);
      setVisible(true);
    }
  }, [pathname]);

  // 페이지 렌더 완료 감지 → 최소 표시 시간 후 페이드 아웃
  useEffect(() => {
    if (!isLoading) return;

    // pathname 변경 후 이 effect가 실행되면 새 페이지가 렌더된 것
    const elapsed = Date.now() - showTimeRef.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, remaining);

    const removeTimer = setTimeout(() => {
      setIsLoading(false);
      setIsFading(false);
      setVisible(false);
    }, remaining + FADE_DURATION);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [isLoading, pathname]);

  if (!visible) return null;

  return (
    <div className={`${styles.overlay} ${isFading ? styles.fadeOut : ""}`}>
      <div className={styles.spinner} />
      <span className={styles.text}>로딩중...</span>
    </div>
  );
}
