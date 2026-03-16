"use client";

import React from "react";
import styles from "./pagination.module.css";

type PaginationProps = {
  totalItems: number;                 // 전체 아이템 개수
  currentPage: number;               // 현재 페이지 (1부터 시작)
  onPageChange: (page: number) => void;
  pageSize?: number;                 // 한 페이지당 아이템 수 (기본 11)
  blockSize?: number;                // 한 번에 보이는 페이지 버튼 수 (기본 5)
};

export default function Pagination({
  totalItems,
  currentPage,
  onPageChange,
  pageSize = 11,
  blockSize = 5,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // 현재 페이지가 속한 "5개짜리 블럭" 계산
  const currentBlock = Math.floor((currentPage - 1) / blockSize); // 0,1,2,...
  const startPage = currentBlock * blockSize + 1;
  const endPage = Math.min(startPage + blockSize - 1, totalPages);

  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const goFirst = () => canGoPrev && onPageChange(1);
  const goLast = () => canGoNext && onPageChange(totalPages);
  const goPrev = () => canGoPrev && onPageChange(currentPage - 1);
  const goNext = () => canGoNext && onPageChange(currentPage + 1);

  const pages = [];
  for (let p = startPage; p <= endPage; p++) {
    pages.push(p);
  }

  if (totalPages === 1) return null; // 한 페이지만 있으면 숨김

  return (
    <div className={styles.pagination}>
      {/* 처음으로 */}
      <button
        type="button"
        onClick={goFirst}
        disabled={!canGoPrev}
        aria-label="First page"
      >
        <img src="/icon/initial-page.png" alt="pre" />
      </button>

      {/* 이전 */}
      <button
        type="button"
        onClick={goPrev}
        disabled={!canGoPrev}
        aria-label="Previous page"
      >
        <img src="/icon/arrow-left.png" alt="pre" />
      </button>

      {/* 페이지 번호들 (5개 블럭) */}
      {pages.map((page) => (
        <button
          key={page} type="button" onClick={() => onPageChange(page)}
          aria-current={currentPage === page ? "page" : undefined}
          className={ currentPage === page ? `${styles.page} ${styles.active}` : styles.page} >
          {page}
        </button>
      ))}

      {/* 다음 */}
      <button
        type="button"
        onClick={goNext}
        disabled={!canGoNext}
        aria-label="Next page"
      >
        <img src="/icon/arrow-right.png" alt="next" />
      </button>

      {/* 맨끝으로 */}
      <button
        type="button"
        onClick={goLast}
        disabled={!canGoNext}
        aria-label="Last page"
      >
        <img src="/icon/last-page.png" alt="next" />
      </button>
    </div>
  );
}