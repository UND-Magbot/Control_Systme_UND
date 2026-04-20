"use client";

import { useEffect, useState } from "react";
import { usePageLoading } from "@/app/context/PageLoadingContext";
import styles from "./GlobalLoading.module.css";

const FADE_DURATION = 150;

export default function GlobalLoading() {
  const { isPageLoading } = usePageLoading();
  const [visible, setVisible] = useState(isPageLoading);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    if (isPageLoading) {
      setVisible(true);
      setIsFading(false);
    } else if (visible) {
      setIsFading(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setIsFading(false);
      }, FADE_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isPageLoading]);

  if (!visible) return null;

  return (
    <div className={`${styles.overlay} ${isFading ? styles.fadeOut : ""}`}>
      <div className={styles.spinner} />
      <span className={styles.text}>로딩중...</span>
    </div>
  );
}
