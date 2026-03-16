'use client';

import styles from './Modal.module.css';
import React, { useEffect, useRef } from 'react';
import type { RobotRowData } from '@/app/type';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";

export type WorkScheduleCase = 'ongoing' | 'recent' | 'none';

type WorkModalProps = {
    isOpen: boolean;
    onClose: () => void;
    selectedRobotIds: number[];  

    /** 조건 분기 값 */
    scheduleCase: WorkScheduleCase;
    /** 완료된 작업 경로(조건1/2에서 노출) */
    completedPathText?: string;
    /** 확인 버튼 클릭 시 실제 “복귀” 이벤트(조건1/2) */
    onConfirmReturn?: () => void;
    /** 조건3에서 확인 버튼 클릭 시 동작(예: 작업등록 화면 이동 등) */
    onConfirmWhenNone?: () => void;
}

export default function RobotScheduleModal({
    isOpen,
    onClose,
    scheduleCase,
    completedPathText = '',
    onConfirmReturn,
    onConfirmWhenNone,
}:WorkModalProps ){

    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);

  // ESC 키로 모달 닫기
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleCancel = () => onClose();

  const handleOk = () => {
    if (scheduleCase === 'none') {
      onConfirmWhenNone?.();
      onClose();
      return;
    }

    // ongoing / recent
    onConfirmReturn?.();
    onClose();
  };

    useCustomScrollbar({
        enabled: isOpen,
        scrollRef,
        trackRef,
        thumbRef,
        minThumbHeight: 50,
        deps: [completedPathText],
    });

      if (!isOpen) return null;

  const renderContent = () => {
    // 조건3: 진행중도 없고 당일 작업도 없는 경우
    if (scheduleCase === 'none') {
      return (
        <div
          className={styles.robotScheduleNoneModalContent}
          onClick={(e) => e.stopPropagation()}
        >
          <button className={styles.scheduleCloseBtn} onClick={onClose}>
            ✕
          </button>

          <div className={styles.scheduleNoneTitle}>등록된 작업일정이 없습니다.</div>

          <div className={styles.workBtnBox}>
            <button
              className={`${styles.workBtnCommon} ${styles.workBtnBgRed}`}
              onClick={handleCancel}
            >
              <img src="/icon/close_btn.png" alt="cancel" />
              <div>취소</div>
            </button>
            <button
              className={`${styles.workBtnCommon} ${styles.workBtnBgBlue}`}
              onClick={handleOk}
            >
              <img src="/icon/check.png" alt="save" />
              <div>확인</div>
            </button>
          </div>
        </div>
      );
    }

    // 조건1/2: 동일 컨테이너(robotScheduleModalContent)에서 타이틀만 분기
    const titleNode =
      scheduleCase === 'ongoing' ? (
        <div className={styles.scheduleTitle}>
          현재 <span className={styles.scheduleTitleB}>진행중</span>인 작업일정을{' '}
          <span className={styles.scheduleTitleR}>처음</span>으로 복귀 하시겠습니까?
        </div>
      ) : (
        <div className={styles.scheduleTitle}>최근에 완료된 작업 일정으로 복귀 하시겠습니까?</div>
      );

    return (
      <div
        className={styles.robotScheduleModalContent}
        onClick={(e) => e.stopPropagation()}
      >
        <button className={styles.scheduleCloseBtn} onClick={onClose}>
          ✕
        </button>

        {titleNode}

        <div className={styles.schedulePathBox}>
          <div className={styles.schedulePathTitle}>완료된 작업 경로 순서</div>
          <div className={styles.schedulePathContents}>
            <div ref={scrollRef} className={styles.scheduleInner} role="listbox">
                <div className={styles.schedulePathInner}>
                    {completedPathText || '-'}
                </div>

                <div ref={trackRef} className={styles.scheduleScrollTrack}>
                    <div ref={thumbRef} className={styles.scheduleScrollThumb} />
                </div>
            </div>

          </div>
        </div>

        <div className={styles.workBtnBox}>
          <button
            className={`${styles.workBtnCommon} ${styles.workBtnBgRed}`}
            onClick={handleCancel}
          >
            <img src="/icon/close_btn.png" alt="cancel" />
            <div>취소</div>
          </button>
          <button
            className={`${styles.workBtnCommon} ${styles.workBtnBgBlue}`}
            onClick={handleOk}
          >
            <img src="/icon/check.png" alt="save" />
            <div>확인</div>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      {renderContent()}
    </div>
  );
}