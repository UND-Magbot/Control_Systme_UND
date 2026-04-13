"use client";

import React, { useState, useEffect, useMemo } from 'react';
import styles from '@/app/(pages)/robots/components/RobotList.module.css';
import Pagination from "@/app/components/pagination";
import { usePaginatedList } from "@/app/hooks/usePaginatedList";
import type { RobotRowData, Floor } from '@/app/type';
import type { PlaceRow } from "@/app/mock/robotPlace_data";
import PlaceCrudModal, { type PlaceRowData } from "@/app/(pages)/robots/components/PlaceCrudModal";
import PlaceDeleteConfirmModal from "@/app/(pages)/robots/components/PlaceDeleteConfirmModal";
import PlaceMapView from "@/app/(pages)/robots/components/PlaceMapView";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import { apiFetch } from "@/app/lib/api";

const PLACE_PAGE_SIZE = 6;

interface PlaceListProps {
  robots: RobotRowData[];
  floors: Floor[];
  hideActions?: boolean;
}

export default function PlaceList({ robots, floors, hideActions }: PlaceListProps) {
  const floorLabels = useMemo(() => floors.map((f) => f.label), [floors]);

  // ── 장소 state ──
  const [placeRows, setPlaceRows] = useState<PlaceRow[]>([]);
  const [selectedPlaceRobot, setSelectedPlaceRobot] = useState<string | null>(null);
  const [selectedPlaceFloor, setSelectedPlaceFloor] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<number | null>(null);
  const [checkedPlaceIds, setCheckedPlaceIds] = useState<number[]>([]);
  const placeCheckedCount = checkedPlaceIds.length;

  const [placeDeleteMode, setPlaceDeleteMode] = useState(false);
  const [placeCreateOpen, setPlaceCreateOpen] = useState(false);
  const [placeEditOpen, setPlaceEditOpen] = useState(false);
  const [placeDeleteConfirmOpen, setPlaceDeleteConfirmOpen] = useState(false);

  // ── 버튼 정책 ──
  const isPlaceCreateEnabled = placeCheckedCount === 0;
  const isPlaceEditEnabled = placeCheckedCount === 1;
  const isPlaceDeleteEnabled = placeCheckedCount >= 1;

  // ── 체크 1개일 때 단일 row ──
  const singleCheckedPlaceRow = useMemo(() => {
    if (checkedPlaceIds.length !== 1) return null;
    const id = checkedPlaceIds[0];
    return placeRows.find((r) => r.id === id) ?? null;
  }, [checkedPlaceIds, placeRows]);

  // ── 필터 옵션 ──
  const placeRobotOptions = useMemo(() => {
    const set = new Set(robots.map((r) => r.no));
    return Array.from(set);
  }, [robots]);

  const placeFloorOptions = useMemo(() => {
    const set = new Set(floors.map((f) => f.label));
    return Array.from(set);
  }, [floors]);

  // ── fetch ──
  const fetchPlaces = async () => {
    try {
      const res = await apiFetch(`/DB/places`);
      const data = await res.json();
      const mapped: PlaceRow[] = data.map((p: any) => ({
        id: p.id,
        robotNo: p.RobotName ?? "",
        floor: p.Floor ?? "",
        placeName: p.LacationName ?? "",
        x: p.LocationX ?? 0,
        y: p.LocationY ?? 0,
        direction: p.LocationDir ?? 0,
        updatedAt: p.UpdatedAt
          ? new Date(p.UpdatedAt).toLocaleString("ko-KR")
          : "",
      }));
      setPlaceRows(mapped);
    } catch (e) {
      console.error("장소 목록 로드 실패", e);
      setPlaceRows([]);
    }
  };

  useEffect(() => {
    fetchPlaces();
  }, []);

  // ── 변환 ──
  const toPlaceRowData = (row: PlaceRow): PlaceRowData => ({
    id: row.id,
    robotNo: row.robotNo,
    floor: row.floor,
    name: row.placeName,
    x: String(row.x),
    y: String(row.y),
    direction: String(row.direction ?? 0),
    desc: "",
    updatedAt: row.updatedAt,
  });

  // ── 필터링 ──
  const filteredPlaceRows = useMemo(() => {
    return placeRows.filter((r) => {
      const robotOk = !selectedPlaceRobot || r.robotNo === selectedPlaceRobot;
      const floorOk = !selectedPlaceFloor || r.floor === selectedPlaceFloor;
      return robotOk && floorOk;
    });
  }, [placeRows, selectedPlaceRobot, selectedPlaceFloor]);

  const selectedPlaceRow = useMemo(() => {
    if (selectedPlaceId == null) return null;
    return filteredPlaceRows.find(r => r.id === selectedPlaceId) ?? null;
  }, [selectedPlaceId, filteredPlaceRows]);

  // ── 페이지네이션 ──
  const { currentPage: placePage, setPage: setPlacePage, pagedItems: currentPlaceItems, totalItems: placeTotalItems } = usePaginatedList(filteredPlaceRows, {
    pageSize: PLACE_PAGE_SIZE,
    resetDeps: [selectedPlaceRobot, selectedPlaceFloor],
  });

  const handlePlacePageChange = (page: number) => {
    setPlacePage(page);
    setCheckedPlaceIds([]);
    setSelectedPlaceId(null);
  };

  // ── 행 선택 ──
  const selectPlace = (placeId: number) => {
    if (selectedPlaceId === placeId) {
      setSelectedPlaceId(null);
      setCheckedPlaceIds([]);
    } else {
      setSelectedPlaceId(placeId);
      setCheckedPlaceIds([placeId]);
    }
  };

  // ── 삭제 모드 체크 ──
  const toggleDeleteCheck = (placeId: number, checked: boolean) => {
    setCheckedPlaceIds((prev) =>
      checked
        ? Array.from(new Set([...prev, placeId]))
        : prev.filter((id) => id !== placeId)
    );
  };

  const toggleDeleteCheckAll = (checked: boolean) => {
    const ids = currentPlaceItems.map((r) => r.id);
    setCheckedPlaceIds((prev) =>
      checked
        ? Array.from(new Set([...prev, ...ids]))
        : prev.filter((id) => !ids.includes(id))
    );
  };

  const isAllDeleteChecked =
    currentPlaceItems.length > 0 &&
    currentPlaceItems.every((r) => checkedPlaceIds.includes(r.id));

  const enterDeleteMode = () => {
    setPlaceDeleteMode(true);
    setCheckedPlaceIds([]);
    setSelectedPlaceId(null);
  };

  const exitDeleteMode = () => {
    setPlaceDeleteMode(false);
    setCheckedPlaceIds([]);
  };

  // ── CRUD 핸들러 ──
  const openPlaceCreate = () => {
    if (!isPlaceCreateEnabled) return;
    setPlaceCreateOpen(true);
  };

  const openPlaceEdit = () => {
    if (!isPlaceEditEnabled) return;
    setPlaceEditOpen(true);
  };

  const openPlaceDelete = () => {
    if (!isPlaceDeleteEnabled) return;
    setPlaceDeleteConfirmOpen(true);
  };

  const upsertPlace = (payload: PlaceRowData) => {
    const nextRow: PlaceRow = {
      id: payload.id,
      robotNo: payload.robotNo,
      floor: payload.floor,
      placeName: payload.name,
      x: Number(payload.x),
      y: Number(payload.y),
      direction: Number(payload.direction ?? 0),
      updatedAt: payload.updatedAt,
    };

    setPlaceRows((prev) => {
      const exists = prev.some((p) => p.id === nextRow.id);
      if (exists) return prev.map((p) => (p.id === nextRow.id ? nextRow : p));
      return [nextRow, ...prev];
    });

    setCheckedPlaceIds([nextRow.id]);
    setPlaceCreateOpen(false);
    setPlaceEditOpen(false);
  };

  const confirmDeletePlace = async () => {
    if (checkedPlaceIds.length === 0) return;

    try {
      await Promise.all(
        checkedPlaceIds.map((id) =>
          apiFetch(`/DB/places/${id}`, { method: "DELETE" })
        )
      );
    } catch (err) {
      console.error("장소 삭제 실패:", err);
    }

    const del = new Set(checkedPlaceIds);
    setPlaceRows((prev) => prev.filter((p) => !del.has(p.id)));
    setCheckedPlaceIds([]);
    setPlaceDeleteConfirmOpen(false);
    setPlaceDeleteMode(false);
  };

  // ── 렌더링 ──
  return (
    <div className={styles.placeWrap}>
      {/* LEFT: 장소 목록 */}
      <div className={styles.placeLeft}>
        <div className={styles.placeTopBar}>
          <h2>장소 목록</h2>

          <div className={styles.placeFilters}>
            {/* 로봇명 선택 */}
            <FilterSelectBox
              items={placeRobotOptions.map((no, i) => ({ id: i, label: no }))}
              selectedLabel={selectedPlaceRobot}
              placeholder="로봇명"
              showTotal={placeRobotOptions.length > 0}
              width={170}
              onSelect={(item) => {
                setSelectedPlaceRobot(item?.label ?? null);
                setSelectedPlaceId(null);
              }}
            />

            {/* 층별 선택 */}
            <FilterSelectBox
              items={placeFloorOptions.map((f, i) => ({ id: i, label: f }))}
              selectedLabel={selectedPlaceFloor}
              placeholder="층"
              width={80}
              onSelect={(item) => {
                setSelectedPlaceFloor(item?.label ?? null);
                setSelectedPlaceId(null);
              }}
            />
          </div>
        </div>

        <div className={styles.placeListBox}>
          <table className={`${styles.status} ${placeDeleteMode ? styles.placeTableDelete : styles.placeTable}`}>
            <thead>
              <tr>
                {placeDeleteMode && (
                  <th>
                    <img
                      src={isAllDeleteChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                      alt=""
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleDeleteCheckAll(!isAllDeleteChecked)}
                    />
                  </th>
                )}
                <th>로봇명</th>
                <th>층별</th>
                <th>장소명</th>
                <th>좌표(X, Y, D)</th>
              </tr>
            </thead>

            <tbody>
              {currentPlaceItems.length === 0 && (
                <tr>
                  <td colSpan={placeDeleteMode ? 5 : 4} className={styles.emptyState}>등록된 장소가 없습니다.</td>
                </tr>
              )}
              {currentPlaceItems.map((row) => {
                const selected = selectedPlaceId === row.id;
                const deleteChecked = checkedPlaceIds.includes(row.id);

                return (
                  <tr
                    key={row.id}
                    className={placeDeleteMode ? (deleteChecked ? styles.selectedRow : undefined) : (selected ? styles.selectedRow : undefined)}
                    style={{ cursor: "pointer" }}
                    onClick={() => placeDeleteMode ? toggleDeleteCheck(row.id, !deleteChecked) : selectPlace(row.id)}
                  >
                    {placeDeleteMode && (
                      <td>
                        <img
                          src={deleteChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                          alt=""
                        />
                      </td>
                    )}
                    <td>{row.robotNo}</td>
                    <td>{row.floor}</td>
                    <td>{row.placeName}</td>
                    <td>
                      X {typeof row.x === "number" ? row.x.toFixed(2) : "-"},
                      Y {typeof row.y === "number" ? row.y.toFixed(2) : "-"},
                      D {typeof row.direction === "number" ? row.direction.toFixed(0) + "\u00B0" : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!hideActions && (
        <div className={`${styles.bottomPosition} ${styles.placeBottomPosition}`}>
          {placeDeleteMode ? (
            <>
              <div
                className={`${styles.placePrimaryBtn} ${checkedPlaceIds.length === 0 ? styles.btnDisabled : ""}`}
                onClick={() => { if (checkedPlaceIds.length > 0) setPlaceDeleteConfirmOpen(true); }}
              >
                <img src="/icon/delete_icon.png" alt="" />
                <span>삭제 확인 ({checkedPlaceIds.length})</span>
              </div>
              <div className={styles.robotWorkBox}>
                <div className={styles.robotWorkCommonBtn} onClick={exitDeleteMode}>
                  취소
                </div>
              </div>
            </>
          ) : (
            <>
              <div
                className={`${styles.placePrimaryBtn} ${!isPlaceCreateEnabled ? styles.btnDisabled : ""}`}
                aria-disabled={!isPlaceCreateEnabled}
                onClick={openPlaceCreate}
              >
                <img src="/icon/check.png" alt="" />
                <span>장소 등록</span>
              </div>
              <div className={styles.robotWorkBox}>
                <div className={styles.robotWorkCommonBtn} onClick={enterDeleteMode}>
                  <img src="/icon/delete_icon.png" alt="" />
                  장소 삭제
                </div>
                <div
                  className={`${styles.robotWorkCommonBtn} ${selectedPlaceId == null ? styles.btnDisabled : ""}`}
                  onClick={openPlaceEdit}
                  aria-disabled={selectedPlaceId == null}
                >
                  <img src="/icon/edit_icon.png" alt="" />
                  장소 수정
                </div>
              </div>
            </>
          )}
        </div>
        )}
        <div className={styles.placePagination}>
          <Pagination totalItems={placeTotalItems} currentPage={placePage} onPageChange={handlePlacePageChange} pageSize={PLACE_PAGE_SIZE} blockSize={5} />
        </div>
      </div>

      <PlaceCrudModal
        isOpen={placeCreateOpen}
        mode="create"
        robots={robots}
        floors={floorLabels}
        initial={null}
        existingPlaces={placeRows}
        onClose={() => setPlaceCreateOpen(false)}
        onSubmit={upsertPlace}
      />

      <PlaceCrudModal
        isOpen={placeEditOpen}
        mode="edit"
        robots={robots}
        floors={floorLabels}
        initial={singleCheckedPlaceRow ? toPlaceRowData(singleCheckedPlaceRow) : null}
        existingPlaces={placeRows}
        onClose={() => setPlaceEditOpen(false)}
        onSubmit={upsertPlace}
      />

      <PlaceDeleteConfirmModal
        isOpen={placeDeleteConfirmOpen}
        message={
          checkedPlaceIds.length <= 1
            ? "선택한 장소를 정말 삭제하시겠습니까?"
            : `${checkedPlaceIds.length}개의 장소를 정말 삭제하시겠습니까?`
        }
        onCancel={() => setPlaceDeleteConfirmOpen(false)}
        onConfirm={confirmDeletePlace}
      />

      {/* RIGHT: 장소 위치 */}
      <div className={styles.placeRight}>
        <div className={styles.robotPlaceBox}>
          <h2>장소 위치</h2>
          <span className={styles.placeHintInline}>해당 장소의 좌표(X, Y, D) 입력은 "장소 등록" 화면에서 작성하실 수 있습니다.</span>
        </div>

        {selectedPlaceId == null ? (
          <div className={styles.monitoringPlaceholder}>
            <span>목록에서 장소를 선택하면 지도가 표시됩니다.</span>
          </div>
        ) : (
          <div className={styles.placeMapCard}>
            <PlaceMapView
              selectedPlaceId={selectedPlaceId}
              selectedPlace={singleCheckedPlaceRow}
              placeRows={placeRows}
            />
          </div>
        )}
      </div>
    </div>
  );
}
