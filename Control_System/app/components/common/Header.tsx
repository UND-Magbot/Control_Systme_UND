"use client"

import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import styles from './common.module.css';
import { getFormattedDateTime } from "@/app/utils/headerDateFomat";
import Link from "next/link";
import { alertMockData } from "@/app/mock/alerts_data";
import { useRouter } from "next/navigation";

type HeaderProps = {
  onAlertClick?: () => void;
};

export default function Header({ onAlertClick }: HeaderProps) {

    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const router = useRouter();
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const adminRef = useRef<HTMLDivElement>(null);
    const adminBtnRef = useRef<HTMLButtonElement>(null);

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

    // 당일 날짜 (YYYY-MM-DD)
    const today = useMemo(() => {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }, []);

    // 목업데이터 기반 미읽음 카운트 (당일 기준)
    const { unreadAlarmCount, unreadScheduleCount } = useMemo(() => {
        const unread = alertMockData.filter((a) => !a.isRead && a.date.startsWith(today));

        return {
        // 벨: Notice/Schedule 제외 (Robot만) 당일 미읽음
        unreadAlarmCount: unread.filter((a) => a.type !== "Schedule" && a.type !== "Notice").length,
        // 캘린더: Schedule 당일 미읽음
        unreadScheduleCount: unread.filter((a) => a.type === "Schedule").length,
        };
    }, [today]);

    // outside-click 닫기
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
                setIsAdminOpen(false);
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

    const handleLogout = useCallback(() => {
        document.cookie = "auth=; path=/; max-age=0";
        localStorage.clear();
        router.replace("/login");
    }, [router]);

    return(
        <header className={styles.header}>
            <div className={styles["container-flex"]}>
                <div className={styles.lrDivFlex}>
                    <div className={styles["logo-img"]}>
                        <img src="/images/und_logo.png" alt="로고" />
                    </div>
                    <h2 className={styles.logoTitle}>로봇 관제시스템</h2>
                </div>

                <div className={`${styles.lrDivFlex} ${styles.rAlign}`}>
                    <nav className={styles["alarm-icon"]} aria-label="상단 유틸리티 메뉴">
                        <button type='button' className={styles.alarm} onClick={onAlertClick} aria-label="알림 열기">
                            <img src="/icon/bell_zero.png" alt="알림" />
                            {unreadAlarmCount > 0 && (
                                <div className={styles.alarmBegs}>
                                    <span aria-hidden="true">{unreadAlarmCount}</span>
                                </div>
                            )}
                        </button>
                        <Link className={styles.schedule} href="/schedules">
                            <div>
                                <img src="/icon/calendar.png" alt="스케줄" />
                            </div>
                            {unreadScheduleCount > 0 && (
                                <span aria-hidden="true">{unreadScheduleCount}</span>
                            )}
                        </Link>
                        <Link className={styles.lacation} href="/robots">
                            <div>
                                <img src="/icon/map.png" alt="로봇위치" />
                            </div>
                        </Link>
                    </nav>

                    <div className={styles["new-time"]}>
                        <time>{date}</time>
                        <time>{time}</time>
                    </div>

                    <div className={styles.adminWrapper} ref={adminRef}>
                        <button
                            ref={adminBtnRef}
                            className={styles.admin}
                            onClick={() => setIsAdminOpen(prev => !prev)}
                            aria-expanded={isAdminOpen}
                            aria-haspopup="menu"
                        >
                            <div className={styles["admin-img"]}>
                                <img src="/icon/user.png" alt="" />
                            </div>
                            <span>관리자</span>
                        </button>

                        {isAdminOpen && (
                            <div className={styles.adminDropdown} role="menu">
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
        </header>
    )
}