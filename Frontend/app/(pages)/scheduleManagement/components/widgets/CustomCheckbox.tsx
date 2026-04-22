"use client";

import React from "react";

type CustomCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  size?: number;
};

export default function CustomCheckbox({
  checked,
  onChange,
  label,
  disabled,
  size = 16,
}: CustomCheckboxProps) {
  const boxStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 4,
    border: checked ? "1px solid var(--color-info, #00b0ee)" : "1px solid rgba(255,255,255,0.3)",
    background: checked ? "var(--color-info, #00b0ee)" : "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "background 0.15s, border-color 0.15s",
  };

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontSize: 12,
        color: "#ffffff",
        userSelect: "none",
      }}
      onClick={(e) => {
        if (disabled) return;
        e.preventDefault();
        onChange(!checked);
      }}
    >
      <span style={boxStyle} aria-checked={checked} role="checkbox">
        {checked && (
          <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      {label != null && <span>{label}</span>}
    </label>
  );
}
