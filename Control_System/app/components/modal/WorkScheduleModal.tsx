'use client';

import styles from './Modal.module.css';
import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import type { RobotRowData } from '@/app/type';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import { useModalBehavior } from '@/app/hooks/useModalBehavior';

export type WorkScheduleCase = 'ongoing' | 'recent' | 'none';

type WorkModalProps = {
    isOpen: boolean;
    onClose: () => void;
    selectedRobotIds: number[];

    /** 조건 분기 값 */
    scheduleCase: WorkScheduleCase;
    /** 완료된 작업 경로(조건1/2에서 노출) */
    completedPathText?: string;
    /** 확인 버튼 클릭 시 실제 "복귀" 이벤트(조건1/2) */
    onConfirmReturn?: () => void;
    /** 조건3에서 확인 버튼 클릭 시 동작(예: 작업등록 화면 이동 등) */
    onConfirmWhenNone?: () => void;
    /** 로딩 상태 */
    loading?: boolean;
    /** 에러 메시지 */
    error?: string | null;
    /** 에러 시 재시도 */
    onRetry?: () => void;
}

export default function RobotScheduleModal({
    isOpen,
    onClose,
    selectedRobotIds,
    scheduleCase,
    completedPathText = '',
    onConfirmReturn,
    onConfirmWhenNone,
    loading = false,
    error = null,
    onRetry,
}:WorkModalProps ){

    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const isSubmitting = useRef(false);
    const [shouldShowScroll, setShouldShowScroll] = useState(false);

  // 스크롤 필요 여부 감지
  useEffect(() => {
    if (!isOpen) return;
    const el = scrollRef.current;
    if (!el) { setShouldShowScroll(false); return; }
    const check = () => setShouldShowScroll(el.scrollHeight > el.clientHeight);
    const raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [isOpen, completedPathText]);

  // 경로 텍스트를 칩 배열로 파싱
  const pathChips = useMemo(() => {
    if (!completedPathText) return [];
    return completedPathText.split(' - ').map(s => s.trim()).filter(Boolean);
  }, [completedPathText]);

  useModalBehavior({ isOpen, onClose, disabled: loading });

  // 포커스 트랩
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const modal = modalRef.current;
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableEls = modal.querySelectorAll<HTMLElement>(focusableSelector);
    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];

    firstEl?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl?.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl?.focus();
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen, scheduleCase, loading]);

  const handleCancel = () => {
    if (!loading) onClose();
  };

  const handleOk = useCallback(() => {
    if (isSubmitting.current || loading) return;
    isSubmitting.current = true;

    try {
      if (scheduleCase === 'none') {
        onConfirmWhenNone?.();
      } else {
        onConfirmReturn?.();
      }
      onClose();
    } finally {
      setTimeout(() => { isSubmitting.current = false; }, 300);
    }
  }, [scheduleCase, onConfirmWhenNone, onConfirmReturn, onClose, loading]);

    useCustomScrollbar({
        enabled: isOpen && shouldShowScroll,
        scrollRef,
        trackRef,
        thumbRef,
        minThumbHeight: 50,
        deps: [completedPathText],
    });

      if (!isOpen) return null;

  // 헤더
  const renderHeader = () => (
    <>
      <button className={styles.scheduleCloseBtn} onClick={handleCancel} aria-label="모달 닫기">
        ✕
      </button>
      <div className={styles.scheduleModalHeader}>
        <img src="/icon/robot_schedule_w.png" alt="" />
        <h2>작업일정 복귀</h2>
      </div>
    </>
  );

  // 로딩 상태
  const renderLoading = () => (
    <div className={styles.scheduleLoadingWrap}>
      <span className={styles.scheduleLoadingSpinner} />
      <div className={styles.scheduleLoadingText}>작업일정을 불러오는 중...</div>
    </div>
  );

  // 에러 + retry
  const renderError = () => (
    <div className={styles.scheduleErrorWrap}>
      <div className={styles.scheduleErrorMsg}>{error}</div>
      {onRetry && (
        <button className={styles.scheduleRetryBtn} onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );

  // 경로 칩 렌더링
  const renderPathChips = () => {
    if (pathChips.length === 0) {
      return <span className={styles.schedulePathEmpty}>경로 정보 없음</span>;
    }
    return (
      <div className={styles.scheduleChipWrap}>
        {pathChips.map((place, i) => {
          const isEnd = i === 0 || i === pathChips.length - 1;
          return (
            <React.Fragment key={i}>
              <span className={`${styles.scheduleChip} ${isEnd ? styles.scheduleChipHighlight : ''}`}>
                {place}
              </span>
              {i < pathChips.length - 1 && (
                <span className={styles.scheduleChipArrow}>→</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const renderButtons = (noneMode?: boolean) => (
    <div className={styles.workBtnBox}>
      <button
        className={`${styles.workBtnCommon} ${styles.workBtnBgRed} ${loading ? styles.workBtnDisabled : ''}`}
        onClick={handleCancel}
        disabled={loading}
      >
        <img src="/icon/close_btn.png" alt="cancel" />
        <div>취소</div>
      </button>
      <button
        className={`${styles.workBtnCommon} ${styles.workBtnBgBlue} ${loading ? styles.workBtnDisabled : ''}`}
        onClick={handleOk}
        disabled={loading}
      >
        {loading ? (
          <span className={styles.workBtnSpinner} />
        ) : (
          <img src="/icon/check.png" alt="save" />
        )}
        <div>{loading ? '처리중...' : noneMode ? '작업일정 등록하기' : '확인'}</div>
      </button>
    </div>
  );

  const renderContent = () => {
    // 로딩 중
    if (loading) {
      return (
        <div
          ref={modalRef}
          className={styles.robotScheduleNoneModalContent}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          {renderHeader()}
          {renderLoading()}
        </div>
      );
    }

    // 에러 상태
    if (error) {
      return (
        <div
          ref={modalRef}
          className={styles.robotScheduleNoneModalContent}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          {renderHeader()}
          {renderError()}
          {renderButtons()}
        </div>
      );
    }

    // 조건3: 등록된 작업일정 없음
    if (scheduleCase === 'none') {
      return (
        <div
          ref={modalRef}
          className={styles.robotScheduleNoneModalContent}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-modal-title"
        >
          {renderHeader()}

          <div className={styles.scheduleNoneBody}>
            <div id="schedule-modal-title" className={styles.scheduleNoneTitle}>
              등록된 작업일정이 없습니다.
            </div>
            <div className={styles.scheduleNoneSub}>
              작업일정을 등록하면 경로 복귀 기능을 사용할 수 있습니다.
            </div>
          </div>

          {renderButtons(true)}
        </div>
      );
    }

    // 방어 처리
    if (scheduleCase !== 'ongoing' && scheduleCase !== 'recent') {
      console.warn(`Unexpected scheduleCase: ${scheduleCase}`);
      return null;
    }

    // 조건1/2: ongoing / recent
    const titleNode =
      scheduleCase === 'ongoing' ? (
        <div id="schedule-modal-title" className={styles.scheduleTitle}>
          현재 <span className={styles.scheduleTitleB}>진행중</span>인 작업일정을{' '}
          <span className={styles.scheduleTitleR}>처음</span>으로 복귀 하시겠습니까?
        </div>
      ) : (
        <div id="schedule-modal-title" className={styles.scheduleTitle}>
          최근에 완료된 작업 일정으로 복귀 하시겠습니까?
        </div>
      );

    return (
      <div
        ref={modalRef}
        className={styles.robotScheduleModalContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-modal-title"
      >
        {renderHeader()}

        {titleNode}

        <div className={styles.schedulePathBox}>
          <div className={styles.schedulePathTitle}>완료된 작업 경로 순서</div>
          <div className={styles.schedulePathContents}>
            <div ref={scrollRef} className={styles.scheduleInner} role="region" aria-label="완료된 작업 경로">
                <div className={styles.schedulePathInner}>
                    {renderPathChips()}
                </div>

                {shouldShowScroll && (
                  <div ref={trackRef} className={styles.scheduleScrollTrack}>
                      <div ref={thumbRef} className={styles.scheduleScrollThumb} />
                  </div>
                )}
            </div>

          </div>
        </div>

        {renderButtons()}
      </div>
    );
  };

  return (
    <div className={styles.modalOverlay} onClick={loading ? undefined : onClose}>
      {renderContent()}
    </div>
  );
}
