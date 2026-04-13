"use client"

import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './common.module.css';
import { getFormattedDateTime } from "@/app/utils/headerDateFomat";
import { useRouter } from "next/navigation";
import { useSidebar } from "@/app/context/SidebarContext";
import { useAlertContext } from "@/app/context/AlertContext";
import { useAuth } from "@/app/context/AuthContext";
import PasswordChangeModal from "@/app/components/modal/PasswordChangeModal";
import AlertsConfirmModal from "@/app/components/modal/AlertsConfirmModal";

export default function Header() {

    const { toggle, close, isOpen } = useSidebar();
    const { unreadCounts } = useAlertContext();
    const { user, logout } = useAuth();
    const unreadAlarmCount = unreadCounts.total;
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const router = useRouter();
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const [alertsOpen, setAlertsOpen] = useState(false);
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const adminRef = useRef<HTMLDivElement>(null);
    const adminBtnRef = useRef<HTMLButtonElement>(null);
    const alertRef = useRef<HTMLDivElement>(null);

    // 클라이언트에서만 시간 갱신 (hydration mismatch 방지)
    useEffect(() => {
        const update = () => {
            const { date, time } = getFormattedDateTime();
            setDate(date);
            setTime(time);
        };
        update();
        const id = setInterval(update, 1000);
        return () => clearInterval(id);
    }, []);

    // outside-click 닫기
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
                setIsAdminOpen(false);
            }
            if (alertRef.current && !alertRef.current.contains(e.target as Node)) {
                setAlertsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, []);

    // Escape 키 닫기
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isAdminOpen) {
                setIsAdminOpen(false);
                adminBtnRef.current?.focus();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isAdminOpen]);

    const handleLogout = useCallback(async () => {
        await logout();
        router.replace("/login");
    }, [logout, router]);

    return(
        <header className={styles.header} onClick={() => isOpen && close()}>
            <div className={styles["container-flex"]}>
                <div className={styles.lrDivFlex}>
                    <button
                        type="button"
                        className={styles.hamburgerBtn}
                        onClick={(e) => { e.stopPropagation(); toggle(); }}
                        aria-label="메뉴 토글"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                    </button>
                    <div className={styles["logo-img"]}>
                        <img src="/images/und_logo.png" alt="로고" />
                    </div>
                    <h2 className={styles.logoTitle}>로봇 관제시스템</h2>
                </div>

                <div className={`${styles.lrDivFlex} ${styles.rAlign}`}>
                    <div className={`${styles["alarm-icon"]} ${styles.alertWrapper}`} ref={alertRef}>
                        <button
                            type='button'
                            className={styles.alarm}
                            onClick={() => { setAlertsOpen(prev => !prev); setIsAdminOpen(false); }}
                            aria-expanded={alertsOpen}
                            aria-haspopup="dialog"
                            aria-label="알림 열기"
                        >
                            <img src="/icon/bell_zero.png" alt="알림" />
                            {unreadAlarmCount > 0 && (
                                <div className={styles.alarmBegs}>
                                    <span aria-hidden="true">{unreadAlarmCount}</span>
                                </div>
                            )}
                        </button>
                        <AlertsConfirmModal
                            isOpen={alertsOpen}
                            onClose={() => setAlertsOpen(false)}
                        />
                    </div>

                    <div className={styles["new-time"]}>
                        <time>{date}</time>
                        <time>{time}</time>
                    </div>

                    <div className={styles.adminWrapper} ref={adminRef}>
                        <button
                            ref={adminBtnRef}
                            className={styles.admin}
                            onClick={() => { setIsAdminOpen(prev => !prev); setAlertsOpen(false); }}
                            aria-expanded={isAdminOpen}
                            aria-haspopup="menu"
                        >
                            <div className={styles["admin-img"]}>
                                <img src="/icon/user.png" alt="" />
                            </div>
                            <span>{user?.user_name ?? "사용자"}</span>
                        </button>

                        {isAdminOpen && (
                            <div className={styles.adminDropdown} role="menu">
                                <button
                                    role="menuitem"
                                    className={styles.adminMenuItem}
                                    onClick={() => {
                                        setIsAdminOpen(false);
                                        setIsPasswordModalOpen(true);
                                    }}
                                >
                                    <img src="/icon/setting_w.png" alt="" className={styles.adminMenuIcon} />
                                    <span>비밀번호 변경</span>
                                </button>
                                <button
                                    role="menuitem"
                                    className={styles.adminMenuItem}
                                    onClick={handleLogout}
                                >
                                    <img src="/icon/log_out_w.png" alt="" className={styles.adminMenuIcon} />
                                    <span>로그아웃</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isPasswordModalOpen && (
                <PasswordChangeModal onClose={() => setIsPasswordModalOpen(false)} />
            )}
        </header>
    )
}