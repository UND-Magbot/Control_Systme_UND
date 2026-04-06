"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
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
  overlay?: boolean;
  /** true이면 드롭다운에 검색 input 표시 + 직접 입력 가능 */
  searchable?: boolean;
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
  overlay = false,
  searchable = false,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => setIsOpen(false), []);

  // overlay 모드에서는 portal 영역도 "내부"로 취급
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (portalRef.current?.contains(target)) return;
      handleClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen, handleClose]);

  // overlay가 아닌 경우에만 기존 useOutsideClick 사용
  useOutsideClick(wrapperRef, handleClose, isOpen && !overlay);

  const needsScroll = (compact || overlay) ? options.length >= 3 : options.length >= 5;

  useCustomScrollbar({
    enabled: isOpen && needsScroll,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 30,
    deps: [options.length, isOpen],
  });

  useEffect(() => {
    if (!overlay || !isOpen || !wrapperRef.current) return;
    const updatePos = () => {
      const rect = wrapperRef.current!.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    };
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [overlay, isOpen]);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = searchable && searchText
    ? options.filter((o) => o.label.includes(searchText))
    : options;

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen((v) => {
      if (!v) setSearchText("");
      return !v;
    });
  };

  // searchable: 열릴 때 input에 포커스
  useEffect(() => {
    if (isOpen && searchable) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [isOpen, searchable]);

  const handleSelect = (option: T) => {
    onChange(option);
    setSearchText("");
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
    overlay ? styles.dropdownOverlay : "",
  ]
    .filter(Boolean)
    .join(" ");

  const dropdownContent = (
    <div
      className={dropdownClasses}
      style={
        overlay && dropdownPos
          ? { position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }
          : undefined
      }
    >
      {filteredOptions.length === 0 ? (
        <div className={styles.emptyMessage}>
          {emptyMessage ?? "항목이 없습니다"}
        </div>
      ) : (
        <>
          <div ref={scrollRef} className={`${styles.scrollArea} ${(compact || overlay) && needsScroll ? styles.scrollAreaCompact : ""}`} role="listbox">
            {filteredOptions.map((option) => (
              <div
                key={option.id}
                className={styles.option}
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
  );

  return (
    <div ref={wrapperRef} className={wrapperClasses} style={wrapperStyle}>
      {searchable ? (
        <div className={selectClasses} onClick={() => { if (!disabled && !isOpen) { setSearchText(""); setIsOpen(true); } }}>
          <input
            ref={searchInputRef}
            className={styles.inlineInput}
            type="text"
            value={isOpen ? searchText : (value?.label ?? "")}
            placeholder={placeholder}
            onChange={(e) => {
              setSearchText(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => { setSearchText(""); setIsOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filteredOptions.length > 0) {
                handleSelect(filteredOptions[0]);
              } else if (e.key === "Escape") {
                setIsOpen(false);
                searchInputRef.current?.blur();
              }
            }}
          />
          <img
            src={isOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
            alt=""
            onClick={(e) => { e.stopPropagation(); handleToggle(); }}
          />
        </div>
      ) : (
        <div className={selectClasses} onClick={handleToggle}>
          <span>{value?.label ?? placeholder}</span>
          <img
            src={isOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
            alt=""
          />
        </div>
      )}

      {isOpen && (overlay ? createPortal(<div ref={portalRef}>{dropdownContent}</div>, document.body) : dropdownContent)}
    </div>
  );
}
