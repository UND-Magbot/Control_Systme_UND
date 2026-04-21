"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../ScheduleCrud.module.css";
import MiniCalendar from "./MiniCalendar";

type DateFieldProps = {
  value: string;                   // "YYYY-MM-DD"
  onChange: (v: string) => void;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
  className?: string;
};

export default function DateField({
  value,
  onChange,
  minDate,
  maxDate,
  disabled,
  className,
}: DateFieldProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const el = triggerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setPos({ left: rect.left, top: rect.bottom + 4 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const initialDate = value ? (() => {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  })() : null;

  return (
    <>
      <div
        ref={triggerRef}
        className={`${styles.seriesDateInput} ${className || ""} ${disabled ? styles.disabled : ""}`}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: disabled ? "not-allowed" : "pointer" }}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
      >
        <span>{value || "날짜 선택"}</span>
        <img src="/icon/search_calendar.png" alt="" style={{ height: 14, marginLeft: 4 }} />
      </div>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 1000 }}
        >
          <MiniCalendar
            value={initialDate}
            size="modal"
            showTodayButton
            minDate={minDate}
            maxDate={maxDate}
            onPickDate={(d) => {
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const dd = String(d.getDate()).padStart(2, "0");
              onChange(`${yyyy}-${mm}-${dd}`);
              setOpen(false);
            }}
          />
        </div>,
        document.body
      )}
    </>
  );
}
