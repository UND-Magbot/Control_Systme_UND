"use client";

import { useEffect } from "react";

type UseCustomScrollbarArgs = {
  enabled: boolean; // 드롭다운 열렸을 때만 true
  scrollRef: React.RefObject<HTMLElement | null>;
  trackRef: React.RefObject<HTMLElement | null>;
  thumbRef: React.RefObject<HTMLElement | null>;
  minThumbHeight?: number; // 기본 50
  deps?: any[]; // 목록 길이 등 외부 deps
};

export function useCustomScrollbar({
  enabled,
  scrollRef,
  trackRef,
  thumbRef,
  minThumbHeight = 50,
  deps = [],
}: UseCustomScrollbarArgs) {
  useEffect(() => {
    if (!enabled) return;

    const scrollEl = scrollRef.current;
    const trackEl = trackRef.current;
    const thumbEl = thumbRef.current;

    if (!scrollEl || !trackEl || !thumbEl) return;

    const resizeThumb = () => {
      const ratio = scrollEl.clientHeight / scrollEl.scrollHeight;
      const h = Math.max(ratio * trackEl.clientHeight, minThumbHeight);

      thumbEl.style.height = `${h}px`;
      thumbEl.style.opacity =
        scrollEl.scrollHeight > scrollEl.clientHeight ? "1" : "0";
    };

    const syncThumb = () => {
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      const maxTop = trackEl.clientHeight - thumbEl.clientHeight;

      if (maxScroll <= 0) {
        thumbEl.style.top = "0px";
        return;
      }

      const ratio = scrollEl.scrollTop / maxScroll;
      thumbEl.style.top = `${ratio * maxTop}px`;
    };

    // 열릴 때 1회 반영
    resizeThumb();
    syncThumb();

    scrollEl.addEventListener("scroll", syncThumb);
    window.addEventListener("resize", resizeThumb);

    // 콘텐츠 높이 변동(리스트 변화, 폰트 로드 등)에 대응
    const ro = new ResizeObserver(() => {
      resizeThumb();
      syncThumb();
    });
    ro.observe(scrollEl);
    ro.observe(trackEl);

    return () => {
      scrollEl.removeEventListener("scroll", syncThumb);
      window.removeEventListener("resize", resizeThumb);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, minThumbHeight, ...deps]);
}