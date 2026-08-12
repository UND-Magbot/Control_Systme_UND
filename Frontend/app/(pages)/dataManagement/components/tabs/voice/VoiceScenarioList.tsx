"use client";

import React, { useMemo, useState } from "react";
import Pagination from "@/app/components/common/Pagination";
import styles from "./voice.module.css";
import type { VoiceIntentRow } from "./voiceApi";

type Props = {
  rows: VoiceIntentRow[];
  loading: boolean;
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onEdit: (intentId: number, robotId: number) => void;
};

const PAGE_SIZE = 10;

const ACTION_CLASS: Record<string, string> = {
  navigate: styles.badgeNav,
  stop: styles.badgeStop,
  none: styles.badgeNone,
};

export default function VoiceScenarioList({
  rows,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onEdit,
}: Props) {
  const [page, setPage] = useState(1);

  const paged = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  );
  const allChecked = paged.length > 0 && paged.every((r) => selectedIds.includes(r.id));

  return (
    <div className={styles.listArea}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th style={{ width: 44 }}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
              />
            </th>
            <th className={styles.thLeft}>시나리오명</th>
            <th style={{ width: 70 }}>질문</th>
            <th style={{ width: 70 }}>답변</th>
            <th style={{ width: 100 }}>동작</th>
            <th style={{ width: 90 }}>상태</th>
            <th style={{ width: 150 }}>수정자</th>
            <th style={{ width: 160 }}>최근 적용 일시</th>
            <th style={{ width: 100 }}>편집</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={9}>
                <div className={styles.emptyState}>불러오는 중...</div>
              </td>
            </tr>
          ) : paged.length === 0 ? (
            <tr>
              <td colSpan={9}>
                <div className={styles.emptyState}>등록된 시나리오가 없습니다.</div>
              </td>
            </tr>
          ) : (
            paged.map((r) => (
              // 행 전체가 클릭 가능하다 — hover 가 "누를 수 있다"고 말하는데 안 눌리면 거짓말이다.
              <tr
                key={r.id}
                className={styles.rowClickable}
                onClick={() => onEdit(r.id, r.robotId)}
              >
                {/* 체크박스는 선택이지 편집이 아니다 — 행 클릭으로 번지지 않게 막는다 */}
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(r.id)}
                    onChange={() => onToggleSelect(r.id)}
                  />
                </td>
                {/* 엔진 키(navigate 등)는 보여주지 않는다 — 운영자가 고칠 수 없는 글자다 */}
                <td className={styles.tdLeft}>
                  <span className={styles.nameCell}>{r.displayName}</span>
                </td>
                <td>{r.exampleCount}</td>
                <td>{r.responseCount}</td>
                <td>
                  <span className={`${styles.badge} ${ACTION_CLASS[r.actionType] ?? ""}`}>
                    {r.actionLabel}
                  </span>
                </td>
                <td>
                  <span
                    className={`${styles.badge} ${r.isActive ? styles.badgeOn : styles.badgeOff}`}
                  >
                    {r.isActive ? "활성" : "비활성"}
                  </span>
                </td>
                <td>{r.updatedBy ?? "-"}</td>
                {/* 편집했지만 로봇엔 아직 안 들어간 상태를 드러내는 유일한 신호 */}
                <td className={r.isApplied ? styles.applied : styles.notApplied}>
                  {r.isApplied ? r.appliedAt : "미적용"}
                </td>
                <td>
                  <button
                    className={styles.detailButton}
                    onClick={() => onEdit(r.id, r.robotId)}
                  >
                    편집
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className={styles.paginationArea}>
        <Pagination
          totalItems={rows.length}
          currentPage={page}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          blockSize={5}
        />
        {rows.length > 0 && (
          <div className={styles.totalCount}>
            총 <span>{rows.length}</span> 개
          </div>
        )}
      </div>
    </div>
  );
}
