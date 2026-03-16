"use client";

import React, { useState, useRef, useEffect } from "react";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import styles from './Button.module.css';
import type { Floor, Camera } from "@/app/type";


type FloorSelectBoxProps = {
  floors: Floor[];
  activeIndex: number;
  selectedFloor: Floor | null;
  onSelect: (index: number, floors: Floor) => void;
  className?: string;
};

export default function FloorSelectBox({
  floors,
  activeIndex,
  selectedFloor,
  onSelect,
  className
}: FloorSelectBoxProps) {

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


  useCustomScrollbar({
    enabled: isOpen,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 50,
    deps: [floors.length],
  });

  

  return (

    <div ref={wrapperRef} className={`${styles.seletWrapper} ${className ?? ""}`}>
      
      <div className={styles.selete} onClick={() => setIsOpen(!isOpen)}>
        <span>{ selectedFloor?.label ?? "층별 선택" }</span>
        {isOpen ? (
          <img src="/icon/arrow_up.png" alt="arrow_up" />
        ) : (
          <img src="/icon/arrow_down.png" alt="arrow_down" />
        )}
      </div>

      {isOpen && (
        <div className={styles.seletbox}>
          <div ref={scrollRef} className={styles.inner} role="listbox">
          {floors.map((item, idx) => (
            <div key={item.id} className={`${styles.floorLabel} ${ activeIndex === idx ? styles["active"] : "" }`.trim()}
                 onClick={() => { onSelect(idx, item); setIsOpen(false); }}>
                 {item.label}
            </div>
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