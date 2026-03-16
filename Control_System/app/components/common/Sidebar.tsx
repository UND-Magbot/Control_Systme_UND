"use client"

import styles from './common.module.css';
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Sidebar() {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const router = useRouter();

    const menuItems = [
      { path: "/dashboard", icon: "main", label: "Home" },
      { path: "/robots", icon: "robot", label: "Robot" },
      { path: "/dataManagement", icon: "data", label: "Data" },
      { path: "/schedules", icon: "schedule", label: "Schedule" },
      { path: "/alerts", icon: "alerts", label: "Alerts" }
    ];

    const handleLogout = () => {
        localStorage.clear();
        router.replace("/login");
    };

    const handleImgError = () => {
        setTimeout(() => {
            setRetryKey(prev => prev + 1);
        }, 1000); // 1초 뒤 재시도
    };


    return(
        <aside className={styles.sidebar}>
            <div>
                {menuItems.map((item, idx) => (
                    <Link key={idx} className={styles.menuItems} 
                            href={item.path}
                            onClick={(e) => {
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

            <div>
                <Link href="/settings"
                        onClick={(e) => {
                            if (window.location.pathname === "/settings") {
                            e.preventDefault();
                            window.location.reload();
                            }
                        }}
                        className={styles.menuItems} onMouseEnter={() => setHoveredIndex(100)} onMouseLeave={() => setHoveredIndex(null)}>
                    <div className={`setting-icon`}>
                        <img src={ hoveredIndex === 100 ? `/icon/setting_d.png` : `/icon/setting_w.png`} alt="setting" key={retryKey} onError={handleImgError} />
                    </div>
                    setting
                </Link>
                <div className={styles.menuItems} onClick={handleLogout} onMouseEnter={() => setHoveredIndex(101)} onMouseLeave={() => setHoveredIndex(null)}>
                    <div className={`log_out-icon`}>
                        <img src={ hoveredIndex === 101 ? `/icon/log_out_d.png` : `/icon/log_out_w.png`} alt="log_out" key={retryKey} onError={handleImgError} />
                    </div>
                    Log out
                </div>
            </div>
        </aside>
    )
}