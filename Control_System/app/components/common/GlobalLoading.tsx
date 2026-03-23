"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./GlobalLoading.module.css";

const LOADING_DURATION = 5000;
const FADE_DURATION = 500;

export default function GlobalLoading() {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const [isFading, setIsFading] = useState(false);
  const [visible, setVisible] = useState(true);
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      setIsLoading(true);
      setIsFading(false);
      setVisible(true);
    }
  }, [pathname]);

  useEffect(() => {
    if (!isLoading) return;

    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, LOADING_DURATION);

    const removeTimer = setTimeout(() => {
      setIsLoading(false);
      setIsFading(false);
      setVisible(false);
    }, LOADING_DURATION + FADE_DURATION);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div className={`${styles.overlay} ${isFading ? styles.fadeOut : ""}`}>
      <div className={styles.spinner} />
      <span className={styles.text}>로딩중...</span>
    </div>
  );
}
