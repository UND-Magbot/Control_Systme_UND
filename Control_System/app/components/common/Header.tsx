"use client"

import React, { useMemo } from 'react';
import styles from './common.module.css';
import { getFormattedDateTime } from "@/app/utils/headerDateFomat";
import Link from "next/link";
import { alertMockData } from "@/app/mock/alerts_data";

type HeaderProps = {
  onAlertClick?: () => void;
};

export default function Header({ onAlertClick }: HeaderProps) {

    const { date, time } = getFormattedDateTime();

    // 목업데이터 기반 미읽음 카운트
    const { unreadAlarmCount, unreadScheduleCount } = useMemo(() => {
        const unread = alertMockData.filter((a) => !a.isRead);

        return {
        // 벨: Schedule 제외 미읽음
        unreadAlarmCount: unread.filter((a) => a.type !== "Schedule").length,
        // 캘린더: Schedule 미읽음
        unreadScheduleCount: unread.filter((a) => a.type === "Schedule").length,
        };
    }, []);

    return(
        <header className={styles.header}>
            <div className={styles["container-flex"]}>
                <div className={styles.lrDivFlex}>
                    <div className={styles["logo-img"]}>
                        <img src="/icon/logo.png" alt="로고" />
                    </div>
                    <h2 className={styles.logoTitle}>HOSPITAL CONTROL SYSTEM</h2>
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

                    <div className={styles.admin}>
                        <div className={styles["admin-img"]}>
                            <img src="/icon/user.png" alt="사용자" />
                        </div>
                        <span>Administrator</span>
                    </div>
                </div>
            </div>
        </header>
    )
}