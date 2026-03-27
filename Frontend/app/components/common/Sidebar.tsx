"use client"

import styles from './common.module.css';
import React, { useState } from "react";
import Link from "next/link";
import { useSidebar } from "@/app/context/SidebarContext";

export default function Sidebar() {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const { isOpen, close } = useSidebar();

    const menuItems = [
      { path: "/dashboard", icon: "main", label: "대시보드" },
      { path: "/robots", icon: "robot", label: "로봇관리" },
      { path: "/mapManagement", icon: "map", label: "맵 관리" },
      { path: "/dataManagement", icon: "data", label: "데이터관리" },
      { path: "/schedules", icon: "schedule", label: "작업관리" },
      { path: "/alerts", icon: "alerts", label: "알림" },
      { path: "/settings", icon: "setting", label: "설정" }
    ];

    const handleImgError = () => {
        setTimeout(() => {
            setRetryKey(prev => prev + 1);
        }, 1000);
    };

    return(
        <>
            {/* 반투명 배경 */}
            {isOpen && (
                <div className={styles.sidebarBackdrop} onClick={close} />
            )}

            <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}>
                <div>
                    {menuItems.map((item, idx) => (
                        <Link key={idx} className={styles.menuItems}
                                href={item.path}
                                onClick={(e) => {
                                    close();
                                    if (window.location.pathname === item.path) {
                                        e.preventDefault();
                                        window.location.reload();
                                    }
                                }}
                                onMouseEnter={() => setHoveredIndex(idx)} onMouseLeave={() => setHoveredIndex(null)}>
                            <div className={`${item.icon}-icon`}>
                                <img src={ hoveredIndex === idx ? `/icon/${item.icon}_d.png` : `/icon/${item.icon}_w.png`} alt={item.label} key={retryKey} onError={handleImgError} />
                            </div>
                            {item.label}
                        </Link>
                    ))}
                </div>
            </aside>
        </>
    )
}
