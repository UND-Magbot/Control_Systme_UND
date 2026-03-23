"use client";

import React, { useState, useRef, useCallback } from "react";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import { useOutsideClick } from "@/app/hooks/useOutsideClick";
import styles from "./CustomSelect.module.css";

export type SelectOption = {
  id: string | number;
  label: string;
};

type CustomSelectProps<T extends SelectOption = SelectOption> = {
  options: T[];
  value: T | null;
  onChange: (option: T) => void;
  placeholder: string;
  compact?: boolean;
  width?: number | string;
  error?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  className?: string;
};

export default function CustomSelect<T extends SelectOption = SelectOption>({
  options,
  value,
  onChange,
  placeholder,
  compact = false,
  width,
  error = false,
  disabled = false,
  emptyMessage,
  className,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => setIsOpen(false), []);
  useOutsideClick(wrapperRef, handleClose, isOpen);

  const needsScroll = options.length >= 5;

  useCustomScrollbar({
    enabled: isOpen && needsScroll,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 30,
    deps: [options.length, isOpen],
  });

  const handleToggle = () => {
    if (!disabled) setIsOpen((v) => !v);
  };

  const handleSelect = (option: T) => {
    onChange(option);
    setIsOpen(false);
  };

  const wrapperStyle: React.CSSProperties = {};
  if (width !== undefined) {
    wrapperStyle.width = typeof width === "number" ? `${width}px` : width;
  }

  const selectClasses = [
    styles.select,
    compact ? styles.selectCompact : "",
    error ? styles.selectError : "",
    disabled ? styles.selectDisabled : "",
  ]
    .filter(Boolean)
    .join(" ");

  const wrapperClasses = [
    styles.selectWrapper,
    compact ? styles.selectWrapperCompact : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const dropdownClasses = [
    styles.dropdown,
    compact ? styles.dropdownCompact : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={wrapperRef} className={wrapperClasses} style={wrapperStyle}>
      <div className={selectClasses} onClick={handleToggle}>
        <span>{value?.label ?? placeholder}</span>
        <img
          src={isOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
          alt=""
        />
      </div>

      {isOpen && (
        <div className={dropdownClasses}>
          {options.length === 0 ? (
            <div className={styles.emptyMessage}>
              {emptyMessage ?? "항목이 없습니다"}
            </div>
          ) : (
            <>
              <div ref={scrollRef} className={styles.scrollArea} role="listbox">
                {options.map((option) => (
                  <div
                    key={option.id}
                    className={`${styles.option} ${
                      value?.id === option.id ? styles.optionActive : ""
                    }`.trim()}
                    onClick={() => handleSelect(option)}
                  >
                    {option.label}
                  </div>
                ))}
              </div>

              {needsScroll && (
                <div ref={trackRef} className={styles.scrollTrack}>
                  <div ref={thumbRef} className={styles.scrollThumb} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
