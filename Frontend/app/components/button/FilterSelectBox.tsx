"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import { useOutsideClick } from "@/app/hooks/useOutsideClick";
import selectStyles from "./SelectModern.module.css";

export type FilterOption = {
  id: string | number;
  label: string;
};

type FilterSelectBoxProps = {
  items: FilterOption[];
  selectedLabel: string | null;   // null = 전체
  placeholder: string;            // e.g. "로봇명 선택"
  showTotal?: boolean;            // 기본 true
  onSelect: (item: FilterOption | null) => void; // null = 전체 선택
  className?: string;
  width?: number | string;        // 기본 "auto" — 옵션 중 가장 긴 텍스트에 맞춤
  minWidth?: number;              // 최소 너비 (px), 기본 100
};

export default function FilterSelectBox({
  items,
  selectedLabel,
  placeholder,
  showTotal = true,
  onSelect,
  className,
  width = "auto",
  minWidth = 130,
}: FilterSelectBoxProps) {
  const s = selectStyles;

  // 옵션 텍스트 중 가장 긴 것 기준으로 너비 자동 계산
  const resolvedWidth = useMemo(() => {
    if (width !== "auto") return width;
    const labels = items.map(i => i.label);
    if (showTotal) labels.push("전체");
    labels.push(placeholder);
    const maxLen = Math.max(...labels.map(l => l.length));
    // padding 42px (좌14+우14+gap8+arrow14) + 글자당 13px (한글 기준)
    const estimated = maxLen * 13 + 42;
    return Math.max(estimated, minWidth);
  }, [width, items, showTotal, placeholder, minWidth]);

  const [isOpen, setIsOpen] = useState(false);
  const [totalClicked, setTotalClicked] = useState(false);
  const prevLabelRef = useRef<string | null>(selectedLabel);

  // 외부에서 특정 항목으로 변경되면 totalClicked 리셋
  useEffect(() => {
    if (selectedLabel !== null && selectedLabel !== "전체") {
      setTotalClicked(false);
    }
    prevLabelRef.current = selectedLabel;
  }, [selectedLabel]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  useOutsideClick(wrapperRef, useCallback(() => setIsOpen(false), []));

  // 고정 포지셔닝 계산
  const calcPosition = () => {
    if (!selectRef.current) return;
    const rect = selectRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left: rect.left,
      minWidth: rect.width,
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("scroll", calcPosition, true);
    window.addEventListener("resize", calcPosition);
    return () => {
      window.removeEventListener("scroll", calcPosition, true);
      window.removeEventListener("resize", calcPosition);
    };
  }, [isOpen]);

  // 스크롤바: 전체 포함 3개까지 표시, 이후 스크롤
  const DROPDOWN_MAX_HEIGHT = 112;   // 32px × 3행 + padding 16px
  const totalCount = showTotal ? items.length + 1 : items.length;
  const needsScroll = totalCount > 3;

  useCustomScrollbar({
    enabled: isOpen && needsScroll,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 30,
    deps: [items.length, isOpen],
  });

  const handleToggle = () => {
    if (!isOpen) calcPosition();
    setIsOpen((v) => !v);
  };

  // selectedLabel이 "전체" 문자열이거나, null인데 전체를 클릭한 적 있으면 "전체" 표시
  const isAllSelected = selectedLabel === "전체" || (selectedLabel === null && totalClicked);
  const displayText = isAllSelected ? "전체" : (selectedLabel ?? placeholder);

  return (
    <div ref={wrapperRef} className={`${s.seletWrapper} ${className ?? ""}`} style={{ width: resolvedWidth }}>
      <div ref={selectRef} className={s.selete} onClick={handleToggle}>
        <span>{displayText}</span>
        <img
          src={isOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
          alt=""
        />
      </div>

      {isOpen && (
        <div className={s.seletbox} style={dropdownStyle}>
          <div
            ref={scrollRef}
            className={s.inner}
            style={{
              maxHeight: DROPDOWN_MAX_HEIGHT,
              overflowY: needsScroll ? "scroll" : "visible",
            }}
            role="listbox"
          >
            {showTotal && (
              <div
                className={`${s.floorLabel} ${isAllSelected ? s.active ?? "" : ""}`.trim()}
                onClick={() => {
                  setTotalClicked(true);
                  onSelect(null);
                  setIsOpen(false);
                }}
              >
                전체
              </div>
            )}
            {items.map((item) => (
              <div
                key={item.id}
                className={`${s.floorLabel} ${selectedLabel === item.label ? s.active ?? "" : ""}`.trim()}
                onClick={() => {
                  setTotalClicked(false);
                  onSelect(item);
                  setIsOpen(false);
                }}
              >
                {item.label}
              </div>
            ))}
          </div>

          {needsScroll && (
            <div ref={trackRef} className={s.scrollTrack}>
              <div ref={thumbRef} className={s.scrollThumb} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
