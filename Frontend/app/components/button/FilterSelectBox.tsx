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
  /**
   * 전체 선택 상태의 문구. 미지정 시 트리거는 placeholder 를 유지하고
   * 드롭다운 첫 항목은 "전체"를 쓴다.
   * 트리거를 리터럴 "전체"로 덮으면 나란히 놓인 필터끼리 구분이 사라진다(T-03).
   */
  allLabel?: string;
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
  allLabel,
  showTotal = true,
  onSelect,
  className,
  width = "auto",
  minWidth = 130,
}: FilterSelectBoxProps) {
  const s = selectStyles;
  const resolvedAllLabel = allLabel ?? placeholder;   // 트리거 표시용
  const allOptionLabel = allLabel ?? "전체";           // 드롭다운 첫 항목

  // 옵션 텍스트 중 가장 긴 것 기준으로 너비 자동 계산
  const resolvedWidth = useMemo(() => {
    if (width !== "auto") return width;
    const labels = items.map(i => i.label);
    if (showTotal) labels.push(resolvedAllLabel);
    labels.push(placeholder);
    const maxLen = Math.max(...labels.map(l => l.length));
    // padding 42px (좌14+우14+gap8+arrow14) + 글자당 13px (한글 기준)
    const estimated = maxLen * 13 + 42;
    return Math.max(estimated, minWidth);
  }, [width, items, showTotal, placeholder, resolvedAllLabel, minWidth]);

  const [isOpen, setIsOpen] = useState(false);
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
      // 드롭다운 폭을 트리거(select) 폭과 정확히 일치시킨다(옵션 길이에 따라 넓어지지 않음).
      width: rect.width,
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

  // 전체 항목이 있는 필터에서 selectedLabel=null 은 곧 전체다.
  // showTotal=false 인 필수 선택(예: 작업유형)에서는 null 이 "미선택"이라 placeholder 를 남긴다.
  const isAllSelected =
    selectedLabel === "전체" ||
    selectedLabel === resolvedAllLabel ||
    (selectedLabel === null && showTotal);
  // 전체여도 무엇에 대한 필터인지 남긴다 — 리터럴 "전체"로 덮지 않는다
  const displayText = isAllSelected ? resolvedAllLabel : (selectedLabel ?? placeholder);

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
                  onSelect(null);
                  setIsOpen(false);
                }}
              >
                {allOptionLabel}
              </div>
            )}
            {items.map((item) => (
              <div
                key={item.id}
                className={`${s.floorLabel} ${selectedLabel === item.label ? s.active ?? "" : ""}`.trim()}
                onClick={() => {
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
