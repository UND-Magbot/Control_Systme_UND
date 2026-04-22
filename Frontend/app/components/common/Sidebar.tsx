"use client"

import styles from './common.module.css';
import React, { useMemo } from "react";
import { useSidebar } from "@/app/context/SidebarContext";
import { useAuth } from "@/app/context/AuthContext";
import { MENU_ROUTE_MAP } from "@/app/constants/menuRouteMap";
import type { MenuNode } from "@/app/types";

export default function Sidebar() {
    const { isOpen, close } = useSidebar();
    const { hasPermission, menus } = useAuth();

    // DB 트리를 직접 순회 → MENU_ROUTE_MAP에 매핑된 노드만 렌더
    const sidebarItems = useMemo(() => {
      return menus
        .filter((node) => {
          const route = MENU_ROUTE_MAP[node.id];
          if (!route) return false;                        // path/icon 매핑 없으면 제외
          if (node.is_visible === false) return false;     // DB에서 숨김 처리

          // 그룹이면 하위 중 하나라도 권한+가시성이 있어야 표시
          if (node.children && node.children.length > 0) {
            return node.children.some(
              (c) => c.is_visible !== false && hasPermission(c.id)
            );
          }
          // 단독 리프 (예: dashboard)
          return hasPermission(node.id);
        })
        .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
        .map((node: MenuNode) => ({
          menuKey: node.id,
          label: node.label,
          path: MENU_ROUTE_MAP[node.id].path,
          icon: MENU_ROUTE_MAP[node.id].icon,
        }));
    }, [menus, hasPermission]);

    return(
        <>
            {/* 반투명 배경 */}
            <div
                className={`${styles.sidebarBackdrop} ${isOpen ? styles.sidebarBackdropOpen : ''}`}
                onClick={close}
            />

            <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}>
                <div>
                    {sidebarItems.map((item) => (
                        // Next.js client-side navigation 대신 하드 네비게이션을 강제한다.
                        // 페이지 이동 시마다 전체 리로드가 발생하여 MJPEG 좀비 연결 등
                        // 브라우저 내부 상태가 완전히 리셋된다.
                        <a key={item.menuKey} className={styles.menuItems}
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
