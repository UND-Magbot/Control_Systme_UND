"use client";

import React, { useState, useRef, useEffect } from "react";
import type { RobotRowData, PrimaryViewType } from '@/app/type';
import styles from './Button.module.css';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";

type ModalRobotSelectProps = {
  robots: RobotRowData[];
  activeIndex: number;
  selectedLabel: string; // 현재 선택된 로봇 이름
  onSelect: (index: number, robot: RobotRowData) => void;
  className?: string;
  primaryView: PrimaryViewType;
};

export default function RobotSelectBox({
  robots,
  activeIndex,
  selectedLabel,
  onSelect,
  className,
  primaryView
}: ModalRobotSelectProps) {

  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const isMap = primaryView === "map"; 

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false); // 외부 클릭 → 닫기
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  useCustomScrollbar({
    enabled: isOpen,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 50,
    deps: [robots.length],
  });

  return (

    <div ref={wrapperRef} className={`${styles.modalSeletWrapper} ${styles.className}`}>
      <div className={`${styles.modalRobotSelect} ${ isMap ? styles.mapSelect : "" }`.trim()} onClick={() => setIsOpen(!isOpen)}>
        
        <span>{selectedLabel}</span>

        {isOpen ? (
          <img src={"/icon/arrow_up.png"} alt="arrow up" />
        ) : (
          <img src={"/icon/arrow_down.png"} alt="arrow down" />
        )}

      </div>
      
      {isOpen && (
        <div className={styles.modalSeletbox}>
          <div ref={scrollRef} className={styles.inner} role="listbox">
            {robots.map((item, idx) => (
              <div key={item.id} className={`${styles.robotsItem} ${ activeIndex === idx ? styles["active"] : "" }`.trim()}
              onClick={() => { onSelect(idx, item); setIsOpen(false); }}>{item.no}</div>
            ))}
          </div>

          <div ref={trackRef} className={styles.scrollTrack}>
            <div ref={thumbRef} className={styles.scrollThumb} />
          </div>
        </div>
      )}
    </div>
  );
}