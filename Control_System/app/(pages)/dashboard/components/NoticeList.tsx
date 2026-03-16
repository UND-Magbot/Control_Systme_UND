"use client";

import React, { useState } from 'react';
import TabMenu from "@/app/components/button/TabMenu";
import styles from './NoticeList.module.css';
import type { Tab } from '@/app/type';

// 상단 타입 선언
type NoticeType = 'Notice' | 'Schedule' | 'Emergency' | 'Emerg' | 'Robot';
type TabKey = 'total' | 'schedule' | 'emergency' | 'robot' | 'notice';

interface Notice {
  no: number;
  type: NoticeType;
  content: string;
  date: string;
}

type NoticesMap = Record<TabKey, Notice[]>;

export default function NoticeList() {

  // 🔹 탭 정의
  const tabs: Tab[] = [
    { id: 'total',     label: '전체' },
    { id: 'schedule',  label: '작업일정' },
    { id: 'emergency', label: '긴급사항' },
    { id: 'robot',     label: '로봇상태' },
    { id: 'notice',    label: '공지사항' },
  ];

  // 탭별 공지 데이터
  const notices: NoticesMap = {
    total: [
      { no: 1, type: 'Notice',   content: '병원 경영시스템에서 받아는 시스템결함 전파 공지입니다.', date:"2025-11-01 13:08" },
      { no: 2, type: 'Schedule', content: '병원 방역 일정 공지 - 11,27일 병원 1동, 2동 전체 방역 예정입니다.', date:"2025-10-01 08:20" },
      { no: 3, type: 'Emerg',    content: '병원 2022 병원 A23 환자(홍길동) 환자에 투약 긴급 차량', date:"2025-06-07 18:15" },
      { no: 4, type: 'Robot',    content: 'Robot 1 로봇에서 이상 점검, Robot 2 2F 병원 환자에게 분실 중', date:"2025-03-01 09:36" },
    ],
    schedule: [
      { no: 2, type: 'Schedule', content: '병원 방역 일정 공지 - 11,27일 병원 1동, 2동 전체 방역 예정입니다.', date:"2025-10-01 08:20" },
    ],
    emergency: [
      { no: 3, type: 'Emerg', content: '병원 2022 병원 A23 환자(홍길동) 환자에 투약 긴급 차량', date:"2025-06-07 18:15" },
    ],
    robot: [
      { no: 4, type: 'Robot', content: 'Robot 1 로봇에서 이상 점검, Robot 2 2F 병원 환자에게 분실 중', date:"2025-03-01 09:36" },
    ],
    notice: [
      { no: 1, type: 'Notice',   content: '병원 경영시스템에서 받아는 시스템결함 전파 공지입니다.', date:"2025-11-01 13:08" },
    ],
  };

  // 부모가 관리하는 탭 상태
  const [activeTab, setActiveTab] = useState<TabKey>('total');

  // 타입을 CSS 클래스 슬러그로 변환
  const toTypeSlug = (t?: string) => {
    const v = (t ?? '').toLowerCase();
    if (v.startsWith('emerg')) return 'emerg';   // Emergency / Emerg 모두 매칭
    return v; // notice, schedule, robot
  };

  return (
    <div>
      {/* 자식(TabMenu)에게 상태/이벤트 내려줌 */}
      <TabMenu
        tabs={tabs}
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as TabKey)}
      />

      {/* 탭에 따라 리스트 바뀜 */}
      <div className={styles["notice-list"]}>
        {notices[activeTab].map((notice: Notice, index: number) => {
          const slug = toTypeSlug(notice.type);

          return (
            <div
              key={index}
              className={styles["notice-item"]}
            >
              <div>
                <span className={`${styles.badge} ${styles[`badge--${slug}`]}`}>{notice.type}</span>
                {index === 0 && <span className={styles.new}>new</span>}
                <p className={styles.content}>{notice.content}</p>
              </div>
              <span>{notice.date}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
