"use client";

import React, { useState, useRef, useEffect } from "react";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import type { RobotRowData } from '@/app/types';
import styles from './Button.module.css';

type RobotSelectBoxProps = {
  robots: RobotRowData[];
  activeIndex: number;
  selectedRobot?: RobotRowData | null;
  onSelect: (index: number, robot: RobotRowData) => void;
  className?: string;
  selectStyles?: Record<string, string>;
};

export default function RobotSelectBox({
  robots,
  activeIndex,
  selectedRobot = null,
  onSelect,
  className,
  selectStyles
}: RobotSelectBoxProps) {
  const s = selectStyles ?? styles;

  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  const handleSelectRobot = (idx: number, robot: RobotRowData) => {
    onSelect(idx, robot);
    setIsOpen(false);
  };

  const needsScroll = robots.length > 3;

  useCustomScrollbar({
    enabled: isOpen && needsScroll,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 50,
    deps: [robots.length],
  });

  const selectRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const calcPosition = () => {
    if (!selectRef.current) return;
    const rect = selectRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left: rect.left,
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

  const handleToggle = () => {
    if (!isOpen) calcPosition();
    setIsOpen(!isOpen);
  };

  return (

    <div ref={wrapperRef} className={`${s.seletWrapper} ${className ?? ""}`}>
      <div ref={selectRef} className={s.selete} onClick={handleToggle}>
        <span>{selectedRobot?.no ?? "로봇 명"}</span>
        {isOpen ? (
          <img src="/icon/arrow_up.png" alt="arrow_up" />
        ) : (
          <img src="/icon/arrow_down.png" alt="arrow_down" />
        )}
      </div>
      {isOpen && (
        <div className={s.seletbox} style={dropdownStyle}>
          <div ref={scrollRef} className={s.inner} style={{ maxHeight: needsScroll ? 112 : "none", overflowY: needsScroll ? "scroll" : "visible" }} role="listbox">
          {robots.map((robot, idx) => (
            <div key={robot.id} className={`${s.robotsLabel} ${ activeIndex === idx ? s["active"] : "" }`.trim()}
            onClick={() => handleSelectRobot(idx, robot)}>{robot.no}
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