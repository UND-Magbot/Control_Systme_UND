"use client"

import styles from './common.module.css';
import React from "react";
import Link from "next/link";
import { useSidebar } from "@/app/context/SidebarContext";

export default function Sidebar() {
    const { isOpen, close } = useSidebar();

    const menuItems = [
      { path: "/dashboard", icon: "main", label: "대시보드" },
      { path: "/schedules", icon: "schedule", label: "작업관리" },
      { path: "/robots", icon: "robot", label: "운영관리" },
      { path: "/mapManagement", icon: "map", label: "맵 관리" },
      { path: "/dataManagement", icon: "data", label: "데이터관리" },
      { path: "/alerts", icon: "alerts", label: "알림" },
      { path: "/settings", icon: "setting", label: "설정" }
    ];

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
                                }}>
                            <div className={`${item.icon}-icon ${styles.iconWrap}`}>
                                <img className={styles.iconDefault} src={`/icon/${item.icon}_w.png`} alt={item.label} />
                                <img className={styles.iconHover} src={`/icon/${item.icon}_d.png`} alt="" />
                            </div>
                            {item.label}
                        </Link>
                    ))}
                </div>
            </aside>
        </>
    )
}
