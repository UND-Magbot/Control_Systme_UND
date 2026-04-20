// 흐름: 경로 리스트 클릭 → selectedPathId state 저장 → img 경로 자동 변경 → 확인 버튼 클릭 → 선택값 검증 → 로봇 경로 이동 이벤트 실행
'use client';

import styles from '@/app/components/modal/Modal.module.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import type { PathRow } from "@/app/types";
import { useModalBehavior } from '@/app/hooks/useModalBehavior';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  robotName: string;
  pathRows: PathRow[];
  onConfirm: (path: PathRow) => void;
};

export default function PathMoveModal({
  isOpen,
  onClose,
  robotName,
  pathRows,
  onConfirm,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const [selectedPathId, setSelectedPathId] = useState<number | null>(null);

  const filteredPaths = useMemo(
    () => pathRows.filter((p) => p.robotNo === robotName),
    [pathRows, robotName],
  );

  useModalBehavior({ isOpen, onClose });

  // 모달 열릴 때 선택 초기화
  useEffect(() => {
    if (isOpen) {
      setSelectedPathId(null);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [isOpen]);

  useCustomScrollbar({
    enabled: isOpen,
    scrollRef,
    trackRef,
    thumbRef,
    minThumbHeight: 50,
    deps: [filteredPaths.length],
  });

  const handleOk = () => {
    if (selectedPathId === null) return;
    const selected = filteredPaths.find((p) => p.id === selectedPathId);
    if (!selected) return;
    onConfirm(selected);
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.placePathModalContent} onClick={(e) => e.stopPropagation()}>
        <button className={styles.placeCloseBtn} onClick={onClose}>✕</button>
        <div className={styles.placeModalHeader}>
          <img src="/icon/path_w.png" alt="" />
          <h2>경로 이동</h2>
        </div>
        <div className={styles.placeTitle}>
          아래 이동할 경로를 선택해 주세요.
        </div>

        <div className={styles.placePathBox}>
          {filteredPaths.length === 0 ? (
            <div className={styles.placeEmpty}>등록된 경로가 없습니다.</div>
          ) : (
            <div ref={scrollRef} className={styles.placeInner} role="listbox">
              {filteredPaths.map((path) => {
                const isSelected = selectedPathId === path.id;
                return (
                  <div
                    key={path.id}
                    className={`${styles.placePathItem} ${styles.pathMoveItem} ${isSelected ? styles.active : ""}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => setSelectedPathId(path.id)}
                  >
                    <img
                      src={isSelected ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                      alt=""
                    />
                    <div className={styles.pathMoveInfo}>
                      <div className={styles.pathMoveNameRow}>
                        <span className={styles.pathMoveName}>{path.pathName}</span>
                        <span className={`${styles.pathMoveBadge} ${
                          path.workType === "task1" ? styles.pathMoveBadge1
                          : path.workType === "task2" ? styles.pathMoveBadge2
                          : styles.pathMoveBadge3
                        }`}>{path.workType}</span>
                      </div>
                      <div className={styles.pathMoveOrder}>{path.pathOrder}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div ref={trackRef} className={styles.placeScrollTrack}>
            <div ref={thumbRef} className={styles.placeScrollThumb} />
          </div>
        </div>

        <div className={styles.workBtnBox}>
          <button className={`${styles.workBtnCommon} ${styles.workBtnBgRed}`} onClick={onClose}>
            <img src="/icon/close_btn.png" alt="" />
            취소
          </button>
          <button
            className={`${styles.workBtnCommon} ${styles.workBtnBgBlue} ${selectedPathId === null ? styles.workBtnDisabled : ""}`}
            onClick={handleOk}
          >
            <img src="/icon/check.png" alt="" />
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
