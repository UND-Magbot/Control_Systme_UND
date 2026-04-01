"use client";

import React, { useState, useMemo } from 'react';
import styles from './RobotList.module.css';
import Pagination from "@/app/components/pagination";
import BusinessDetailModal from './BusinessDetailModal';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { apiFetch } from "@/app/lib/api";

const BUSINESS_PAGE_SIZE = 6;

export type BusinessItem = {
  id: number;
  businessName: string;
  zipCode: string;
  address: string;
  addressDetail: string;
  representName: string;
  contact: string;
  description: string;
  areaCount: number;
  robotCount: number;
  createdAt: string;
};

export type AreaItem = {
  id: number;
  businessId: number;
  floorName: string;
  createdAt: string;
};

const BUSINESS_API = {
  LIST: `/DB/businesses`,
  DELETE: (id: number) => `/DB/businesses/${id}`,
};

export default function BusinessList() {
  const [businessRows, setBusinessRows] = useState<BusinessItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [checkedBusinessIds, setCheckedBusinessIds] = useState<number[]>([]);

  // 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "view">("view");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);

  // 페이지네이션
  const [page, setPage] = useState(1);
  const handlePageChange = (p: number) => {
    setPage(p);
    setCheckedBusinessIds([]);
  };

  const fetchBusinessList = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(BUSINESS_API.LIST);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "사업장 목록 조회 실패");
      }
      const data = await res.json();
      const mapped: BusinessItem[] = (data.items ?? []).map((b: any) => ({
        id: b.id,
        businessName: b.BusinessName ?? "",
        zipCode: b.ZipCode ?? "",
        address: b.Address ?? "",
        addressDetail: b.AddressDetail ?? "",
        representName: b.RepresentName ?? "",
        contact: b.Contact ?? "",
        description: b.Description ?? "",
        areaCount: b.AreaCount ?? 0,
        robotCount: b.RobotCount ?? 0,
        createdAt: b.CreatedAt ? new Date(b.CreatedAt).toLocaleDateString("ko-KR") : "-",
      }));
      setBusinessRows(mapped);
    } catch (err) {
      console.error("사업장 목록 로드 실패:", err);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchBusinessList();
  }, []);

  // 조회
  const handleSearch = () => {
    setAppliedQuery(searchQuery);
    setPage(1);
  };

  const filteredRows = useMemo(() => {
    if (!appliedQuery.trim()) return businessRows;
    const q = appliedQuery.trim().toLowerCase();
    return businessRows.filter(b =>
      b.businessName.toLowerCase().includes(q) ||
      b.address.toLowerCase().includes(q)
    );
  }, [businessRows, appliedQuery]);

  const totalItems = filteredRows.length;
  const startIdx = (page - 1) * BUSINESS_PAGE_SIZE;
  const currentItems = filteredRows.slice(startIdx, startIdx + BUSINESS_PAGE_SIZE);

  // 체크 토글
  const toggleCheck = (id: number, checked: boolean) => {
    setCheckedBusinessIds(prev =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter(bid => bid !== id)
    );
  };

  const toggleAllCheck = (checked: boolean) => {
    const ids = currentItems.map(b => b.id);
    setCheckedBusinessIds(prev =>
      checked ? Array.from(new Set([...prev, ...ids])) : prev.filter(id => !ids.includes(id))
    );
  };

  const isAllChecked = currentItems.length > 0 && currentItems.every(b => checkedBusinessIds.includes(b.id));

  // 행 선택
  const selectRow = (id: number) => {
    if (deleteMode) {
      toggleCheck(id, !checkedBusinessIds.includes(id));
      return;
    }
    setSelectedBusinessId(selectedBusinessId === id ? null : id);
    setCheckedBusinessIds(selectedBusinessId === id ? [] : [id]);
  };

  // 삭제
  const confirmDelete = async () => {
    if (checkedBusinessIds.length === 0) return;
    try {
      await Promise.all(checkedBusinessIds.map(id => apiFetch(BUSINESS_API.DELETE(id), { method: "DELETE" })));
      setBusinessRows(prev => prev.filter(b => !checkedBusinessIds.includes(b.id)));
      setCheckedBusinessIds([]);
      setSelectedBusinessId(null);
      setDeleteConfirmOpen(false);
      setDeleteMode(false);
    } catch (err) {
      console.error("사업장 삭제 실패:", err);
    }
  };

  // 모달
  const [initialEditMode, setInitialEditMode] = useState(false);

  const openCreate = () => { setModalMode("create"); setInitialEditMode(false); setModalOpen(true); };
  const openDetail = (id: number) => {
    setSelectedBusinessId(id);
    setCheckedBusinessIds([id]);
    setModalMode("view");
    setInitialEditMode(false);
    setModalOpen(true);
  };
  const openEdit = () => {
    if (!selectedBusinessId) return;
    setModalMode("view");
    setInitialEditMode(true);
    setModalOpen(true);
  };

  const colCount = (deleteMode ? 1 : 0) + 6;

  return (
    <div className={styles.RobotListTab}>
      <div className={styles.RobotStatusList}>
        {/* 상단 툴바 */}
        <div className={styles.toolbarRow}>
          <div className={styles.filterRow}>
            <div className={styles.searchWrapper}>
              <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="사업장명, 주소 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button type="button" className={styles.primaryActionBtn} onClick={handleSearch}>조회</button>
          </div>

          <div className={styles.topRightGroup}>
            {deleteMode ? (
              <>
                <div
                  className={`${styles.placePrimaryBtn} ${checkedBusinessIds.length === 0 ? styles.btnDisabled : ""}`}
                  onClick={() => { if (checkedBusinessIds.length > 0) setDeleteConfirmOpen(true); }}
                >
                  <img src="/icon/delete_icon.png" alt="" />
                  <span>삭제 확인 ({checkedBusinessIds.length})</span>
                </div>
                <div className={styles.robotWorkCommonBtn} onClick={() => { setDeleteMode(false); setCheckedBusinessIds([]); }}>취소</div>
              </>
            ) : (
              <>
                <button type="button" className={styles.primaryActionBtn} onClick={openCreate}>
                  <img src="/icon/edit_icon.png" alt="" />
                  등록
                </button>
                <div
                  className={`${styles.robotWorkCommonBtn} ${selectedBusinessId == null ? styles.btnDisabled : ""}`}
                  onClick={openEdit}
                >
                  <img src="/icon/edit_icon.png" alt="" />
                  수정
                </div>
                <div className={styles.robotWorkCommonBtn} onClick={() => { setDeleteMode(true); setCheckedBusinessIds([]); setSelectedBusinessId(null); }}>
                  <img src="/icon/delete_icon.png" alt="" />
                  삭제
                </div>
              </>
            )}
          </div>
        </div>

        {/* 테이블 */}
        <div className={styles.statusListBox}>
          <table className={`${styles.status} ${styles.businessTable} ${deleteMode ? styles.businessTableDelete : ''}`}>
            <thead>
              <tr>
                {deleteMode && (
                  <th>
                    <img
                      src={isAllChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                      alt="전체 선택" role="button" tabIndex={0} style={{ cursor: "pointer" }}
                      onClick={() => toggleAllCheck(!isAllChecked)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleAllCheck(!isAllChecked); }}
                    />
                  </th>
                )}
                <th>No</th>
                <th>사업장명</th>
                <th>주소</th>
                <th>영역 수</th>
                <th>로봇 수</th>
                <th>정보</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.length === 0 && (
                <tr><td colSpan={colCount} className={styles.emptyState}>등록된 사업장이 없습니다.</td></tr>
              )}
              {currentItems.map((b, idx) => {
                const rowNum = startIdx + idx + 1;
                const isSelected = selectedBusinessId === b.id;
                const isChecked = checkedBusinessIds.includes(b.id);

                return (
                  <tr
                    key={b.id}
                    className={deleteMode ? (isChecked ? styles.selectedRow : undefined) : (isSelected ? styles.selectedRow : undefined)}
                    style={{ cursor: "pointer" }}
                    onClick={() => selectRow(b.id)}
                  >
                    {deleteMode && (
                      <td><img src={isChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"} alt="" /></td>
                    )}
                    <td>{rowNum}</td>
                    <td>{b.businessName}</td>
                    <td>{b.address || "-"}</td>
                    <td>{b.areaCount}</td>
                    <td>{b.robotCount}</td>
                    <td>
                      <div className={styles.infoBtnGroup}>
                        <div className={styles["info-box"]} onClick={(e) => { e.stopPropagation(); openDetail(b.id); }}>
                          상세보기
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.pagePosition}>
          <Pagination totalItems={totalItems} currentPage={page} onPageChange={handlePageChange} pageSize={BUSINESS_PAGE_SIZE} blockSize={5} />
        </div>
      </div>

      {/* 통합 모달 (등록/조회/수정) */}
      <BusinessDetailModal
        isOpen={modalOpen}
        mode={modalMode}
        businessId={modalMode === "view" ? selectedBusinessId : null}
        initialEditMode={initialEditMode}
        onClose={() => setModalOpen(false)}
        onSaved={fetchBusinessList}
      />

      {deleteConfirmOpen && (
        <CancelConfirmModal
          message={
            checkedBusinessIds.length <= 1
              ? "선택한 사업장을 정말 삭제하시겠습니까?\n하위 영역도 함께 삭제됩니다."
              : `${checkedBusinessIds.length}개의 사업장을 정말 삭제하시겠습니까?\n하위 영역도 함께 삭제됩니다.`
          }
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  );
}
