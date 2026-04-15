"use client"

import styles from './common.module.css';
import React, { useMemo } from "react";
import { useSidebar } from "@/app/context/SidebarContext";
import { useAuth } from "@/app/context/AuthContext";

// 메뉴별 필요 권한 매핑
// childIds: 부모 메뉴는 하위 리프 ID 중 하나라도 있으면 표시
const MENU_ITEMS = [
  { path: "/dashboard", icon: "main", label: "대시보드", childIds: ["dashboard"] },
  { path: "/scheduleManagement", icon: "schedule", label: "작업관리", childIds: ["schedule-list"] },
  { path: "/operationManagement", icon: "robot", label: "운영관리", childIds: ["robot-list", "business-list"] },
  { path: "/mapManagement", icon: "map", label: "맵 관리", childIds: ["map-edit", "place-list", "path-list"] },
  { path: "/dataManagement", icon: "data", label: "데이터관리", childIds: ["video", "statistics", "log"] },
  { path: "/alerts", icon: "alerts", label: "알림", childIds: ["alert-total", "alert-schedule", "alert-robot", "alert-notice"] },
  { path: "/settings", icon: "setting", label: "설정", childIds: ["menu-permissions", "db-backup"] },
];

export default function Sidebar() {
    const { isOpen, close } = useSidebar();
    const { hasPermission, isAdmin } = useAuth();

    const menuItems = useMemo(() => {
      return MENU_ITEMS.filter((item) => {
        // 하위 리프 중 하나라도 권한이 있으면 부모 메뉴 표시
        return item.childIds.some((id) => hasPermission(id));
      });
    }, [hasPermission]);

    return(
        <>
            {/* 반투명 배경 */}
            <div
                className={`${styles.sidebarBackdrop} ${isOpen ? styles.sidebarBackdropOpen : ''}`}
                onClick={close}
            />

            <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}>
                <div>
                    {menuItems.map((item, idx) => (
                        // Next.js client-side navigation 대신 하드 네비게이션을 강제한다.
                        // 페이지 이동 시마다 전체 리로드가 발생하여 MJPEG 좀비 연결 등
                        // 브라우저 내부 상태가 완전히 리셋된다.
                        <a key={idx} className={styles.menuItems}
                                href={item.path}
                                onClick={(e) => {
                                    e.preventDefault();
                                    close();
                                    // 같은 경로든 다른 경로든 항상 하드 리로드
                                    window.location.href = item.path;
                                }}>
                            <div className={`${item.icon}-icon ${styles.iconWrap}`}>
                                <img className={styles.iconDefault} src={`/icon/${item.icon}_w.png`} alt={item.label} />
                                <img className={styles.iconHover} src={`/icon/${item.icon}_d.png`} alt="" />
                            </div>
                            {item.label}
                        </a>
                    ))}
                </div>
            </aside>
        </>
    )
}
