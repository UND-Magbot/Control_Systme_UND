"use client";

import React, { useState, useRef, useCallback } from "react";
import styles from "./NumberSpinner.module.css";

type NumberSpinnerProps = {
  value: number | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
  /** 표시할 자릿수 (기본 2 → "03") */
  pad?: number;
};

export default function NumberSpinner({
  value,
  onChange,
  min = 0,
  max = 59,
  placeholder = "00",
  error = false,
  disabled = false,
  pad = 2,
}: NumberSpinnerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const clamp = useCallback(
    (n: number) => Math.max(min, Math.min(max, n)),
    [min, max]
  );

  const display =
    value !== null ? String(value).padStart(pad, "0") : "";

  const handleFocus = () => {
    setEditing(true);
    setDraft(display);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commit = (raw: string) => {
    setEditing(false);
    const n = parseInt(raw, 10);
    if (!isNaN(n)) {
      onChange(clamp(n));
    }
  };

  const handleBlur = () => commit(draft);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      commit(draft);
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      setEditing(false);
      setDraft(display);
      inputRef.current?.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = clamp((value ?? min) + 1);
      onChange(next);
      setDraft(String(next).padStart(pad, "0"));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = clamp((value ?? min) - 1);
      onChange(next);
      setDraft(String(next).padStart(pad, "0"));
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = clamp((value ?? min) + dir);
    onChange(next);
    if (editing) setDraft(String(next).padStart(pad, "0"));
  };

  const wrapperClass = [
    styles.wrapper,
    error ? styles.wrapperError : "",
    disabled ? styles.wrapperDisabled : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClass} onWheel={handleWheel}>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        inputMode="numeric"
        value={editing ? draft : display}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, String(max).length);
          setDraft(v);
        }}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
