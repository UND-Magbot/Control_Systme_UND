"use client";

import React, { useState, useRef, useEffect } from "react";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import type { RobotRowData } from '@/app/type';
import styles from './Button.module.css';

type RobotSelectBoxProps = {
  robots: RobotRowData[];
  activeIndex: number; 
  onSelect: (index: number, robot: RobotRowData) => void;
  className?: string;
};

export default function RobotSelectBox({
  robots,
  activeIndex,
  onSelect,
  className
}: RobotSelectBoxProps) {
  
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);

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

  const handleSelectRobot = (robot: RobotRowData) => {
    setSelectedRobot(robot);
    setIsOpen(false);
  };

  useCustomScrollbar({
    enabled: isOpen,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 50,
    deps: [robots.length],
  });

  return (

    <div ref={wrapperRef} className={`${styles.seletWrapper} ${className ?? ""}`}>
      <div className={styles.selete} onClick={() => setIsOpen(!isOpen)}>
        <span>{selectedRobot?.no ?? "로봇명 선택"}</span>
        {isOpen ? (
          <img src="/icon/arrow_up.png" alt="arrow_up" />
        ) : (
          <img src="/icon/arrow_down.png" alt="arrow_down" />
        )}
      </div> 
      {isOpen && (
        <div className={styles.seletbox}>
          <div ref={scrollRef} className={styles.inner} role="listbox">
          {robots.map((robot, idx) => (
            <div key={robot.id} className={`${styles.robotsLabel} ${ activeIndex === idx ? styles["active"] : "" }`.trim()}
            onClick={() => handleSelectRobot(robot)}>{robot.no}
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