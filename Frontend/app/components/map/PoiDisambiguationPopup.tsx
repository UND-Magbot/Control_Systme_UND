"use client";

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getCategoryMeta } from "./categoryMeta";

export type DisambiguationCandidate = {
  key: string;
  name: string;
  category?: string | null;
  pending?: boolean;
};

type Props = {
  open: boolean;
  screenX: number;
  screenY: number;
  candidates: DisambiguationCandidate[];
  onPick: (key: string) => void;
  onCancel: () => void;
};

const POPUP_WIDTH = 240;
const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 28;
const MAX_ROWS_VISIBLE = 6;

export default function PoiDisambiguationPopup({
  open,
  screenX,
  screenY,
  candidates,
  onPick,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  // 캡처 단계 mousedown 리스너 — 자식 요소의 stopPropagation 이 있어도 안정적으로 감지.
  // 팝업이 열린 직후의 동일 클릭이 즉시 닫게 하지 않도록 mousedownAt 타임스탬프로 가드.
  useEffect(() => {
    if (!open) return;
    const openedAt = Date.now();
    const handleMouseDown = (e: MouseEvent) => {
      // 팝업이 방금 열린 직후의 같은 mousedown 은 무시 (방어적)
      if (Date.now() - openedAt < 16) return;
      const node = ref.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) {
        onCancel();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("mousedown", handleMouseDown, true); // capture phase
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  const visibleRows = Math.min(candidates.length, MAX_ROWS_VISIBLE);
  const popupH = HEADER_HEIGHT + ROW_HEIGHT * visibleRows + 8;

  const left = Math.max(
    8,
    Math.min(screenX, window.innerWidth - POPUP_WIDTH - 8),
  );
  const top = Math.max(
    8,
    Math.min(screenY, window.innerHeight - popupH - 8),
  );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="겹친 POI 선택"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1000,
        width: POPUP_WIDTH,
        maxHeight: 260,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-2)",
        border: "1px solid var(--surface-border)",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
        padding: 4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: "6px 10px",
          fontSize: "var(--font-size-sm)",
          color: "var(--text-secondary)",
          borderBottom: "1px solid var(--surface-border)",
          marginBottom: 2,
        }}
      >
        겹친 POI {candidates.length}개 — 선택
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {candidates.map((c) => {
          const meta = getCategoryMeta(c.category);
          return (
            <button
              key={c.key}
              onClick={() => onPick(c.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                minHeight: ROW_HEIGHT,
                padding: "6px 10px",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "var(--text-primary)",
                fontSize: "var(--font-size-sm)",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(255, 255, 255, 0.05)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: meta.color,
                  flexShrink: 0,
                }}
              />
              <strong
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 500,
                }}
                title={c.name}
              >
                {c.name}
              </strong>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  flexShrink: 0,
                }}
              >
                {meta.label}
              </span>
              {c.pending && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "rgba(255, 215, 0, 0.15)",
                    color: "#FFD700",
                    border: "1px solid rgba(255, 215, 0, 0.4)",
                    flexShrink: 0,
                  }}
                >
                  미저장
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
