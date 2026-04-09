import { useState, useMemo, useEffect, useRef } from "react";

/**
 * 클라이언트 사이드 페이지네이션 공통 훅
 *
 * @param items - 필터링/정렬이 완료된 전체 목록
 * @param options.pageSize - 페이지당 항목 수
 * @param options.resetDeps - 이 값들이 바뀌면 1페이지로 자동 리셋
 */
export function usePaginatedList<T>(
  items: T[],
  options: { pageSize: number; resetDeps?: React.DependencyList }
) {
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize, resetDeps = [] } = options;
  const isInitial = useRef(true);

  // resetDeps 변경 시 1페이지로 리셋 (초기 마운트 제외)
  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  const totalItems = items.length;
  const maxPage = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = currentPage > maxPage ? maxPage : currentPage;

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return {
    currentPage: safePage,
    setPage: setCurrentPage,
    resetPage: () => setCurrentPage(1),
    pagedItems,
    totalItems,
  };
}
