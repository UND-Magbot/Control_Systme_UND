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

    // ── thumb 드래그 ──
    let dragging = false;
    let startY = 0;
    let startScrollTop = 0;

    const onThumbMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startScrollTop = scrollEl.scrollTop;
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const deltaY = e.clientY - startY;
      const trackHeight = trackEl.clientHeight - thumbEl.clientHeight;
      if (trackHeight <= 0) return;
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      scrollEl.scrollTop = startScrollTop + (deltaY / trackHeight) * maxScroll;
    };

    const onMouseUp = () => {
      dragging = false;
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    // ── 트랙 클릭 (thumb 외 영역) ──
    const onTrackClick = (e: MouseEvent) => {
      if (e.target === thumbEl) return;
      const trackRect = trackEl.getBoundingClientRect();
      const clickRatio = (e.clientY - trackRect.top) / trackRect.height;
      scrollEl.scrollTop = clickRatio * (scrollEl.scrollHeight - scrollEl.clientHeight);
    };

    // 열릴 때 1회 반영
    resizeThumb();
    syncThumb();

    thumbEl.style.cursor = "grab";
    thumbEl.addEventListener("mousedown", onThumbMouseDown);
    trackEl.addEventListener("click", onTrackClick);
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
      thumbEl.removeEventListener("mousedown", onThumbMouseDown);
      trackEl.removeEventListener("click", onTrackClick);
      scrollEl.removeEventListener("scroll", syncThumb);
      window.removeEventListener("resize", resizeThumb);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, minThumbHeight, ...deps]);
}