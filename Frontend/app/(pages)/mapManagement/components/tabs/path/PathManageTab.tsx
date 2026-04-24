"use client";

import React, { useState, useEffect, useMemo } from 'react';
import styles from '../../PlacePathList.module.css';
import Pagination from "@/app/components/common/Pagination";
import { usePaginatedList } from "@/app/hooks/usePaginatedList";
import type { RobotRowData, Floor } from '@/app/types';
import type { PlaceRow } from "@/app/types";
import PathCrudModal from "@/app/(pages)/mapManagement/components/tabs/path/PathCrudModal";
import PathDeleteConfirmModal from "@/app/(pages)/mapManagement/components/tabs/path/PathDeleteConfirmModal";
import PathMapView from "@/app/(pages)/mapManagement/components/tabs/path/PathMapView";
import PathAlertsModal from "@/app/(pages)/mapManagement/components/tabs/path/PathAlertsModal";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import { apiFetch } from "@/app/lib/api";
import type { FloorMapRow } from "@/app/(pages)/mapManagement/hooks/useFloorMapConfig";

const PATH_PAGE_SIZE = 6;
const robotTypes = ["task1", "task2", "task3"];

const PATH_API = {
  LIST: `/DB/getpath`,
  CREATE: `/DB/path`,
  UPDATE: (id: number) => `/DB/path/${id}`,
  DELETE: (id: number) => `/DB/path/${id}`,
};

export type PathRow = {
  id: number;
  robotNo: string;
  workType: string;
  pathName: string;
  pathOrder: string;
  updatedAt: string;
};

interface PathListProps {
  robots: RobotRowData[];
  floors: Floor[];
  hideActions?: boolean;
}

export default function PathManageTab({ robots, floors, hideActions }: PathListProps) {
  // ── 경로 state ──
  const [pathRows, setPathRows] = useState<PathRow[]>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathAlertMessage, setPathAlertMessage] = useState<string | null>(null);
  const [selectedPathId, setSelectedPathId] = useState<number | null>(null);

  const [selectedPathRobot, setSelectedPathRobot] = useState<string | null>(null);
  const [selectedPathWorkType, setSelectedPathWorkType] = useState<string | null>(null);
  const [selectedPathFloor, setSelectedPathFloor] = useState<string | null>(null);
  const [mapRows, setMapRows] = useState<FloorMapRow[]>([]);

  const [checkedPathIds, setCheckedPathIds] = useState<number[]>([]);
  const pathCheckedCount = checkedPathIds.length;
  const [pathDeleteMode, setPathDeleteMode] = useState(false);

  const [pathCreateOpen, setPathCreateOpen] = useState(false);
  const [pathEditOpen, setPathEditOpen] = useState(false);
  const [pathDeleteConfirmOpen, setPathDeleteConfirmOpen] = useState(false);

  // ── 장소 데이터 (PathCrudModal 에서 필요) ──
  const [placeRows, setPlaceRows] = useState<PlaceRow[]>([]);

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
        floorId: p.FloorId ?? null,
        mapId: p.MapId ?? null,
      }));
      setPlaceRows(mapped);
    } catch (e) {
      console.error("장소 목록 로드 실패", e);
      setPlaceRows([]);
    }
  };

  const fetchMaps = async () => {
    try {
      const res = await apiFetch(`/map/maps`);
      const data = await res.json();
      setMapRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("맵 목록 로드 실패", e);
      setMapRows([]);
    }
  };

  // ── 버튼 정책 ──
  const isPathCreateEnabled = true;
  const isPathEditEnabled = !!selectedPathId;
  const isPathDeleteEnabled = pathDeleteMode && pathCheckedCount >= 1;

  // ── 필터 옵션 ──
  const pathRobotOptions = useMemo(() => {
    const set = new Set(robots.map(r => r.no));
    return Array.from(set);
  }, [robots]);

  const pathWorkTypeOptions = useMemo(() => {
    const set = new Set(robotTypes);
    return Array.from(set);
  }, []);

  const pathFloorOptions = useMemo(
    () => Array.from(new Set(floors.map((f) => f.label))),
    [floors]
  );

  // 경로의 첫 번째 장소 기준으로 층 추출
  const getPathFloor = (row: PathRow): string | null => {
    const firstName = (row.pathOrder ?? "").split(" - ")[0]?.trim();
    if (!firstName) return null;
    return placeRows.find((p) => p.placeName === firstName)?.floor ?? null;
  };

  // ── 필터 + 정렬 ──
  const filteredPathRows = useMemo(() => {
    return pathRows
      .filter((r) => {
        const robotOk = !selectedPathRobot || r.robotNo === selectedPathRobot;
        const typeOk = !selectedPathWorkType || r.workType === selectedPathWorkType;
        const floorOk = !selectedPathFloor || getPathFloor(r) === selectedPathFloor;
        return robotOk && typeOk && floorOk;
      })
      .sort((a, b) => {
        const ta = new Date(a.updatedAt).getTime() || 0;
        const tb = new Date(b.updatedAt).getTime() || 0;
        return tb - ta;
      });
  }, [pathRows, placeRows, selectedPathRobot, selectedPathWorkType, selectedPathFloor]);

  // ── 페이지네이션 ──
  const { currentPage: pathPage, setPage: setPathPage, resetPage: resetPathPage, pagedItems: currentPathItems, totalItems: pathTotalItems } = usePaginatedList(filteredPathRows, {
    pageSize: PATH_PAGE_SIZE,
    resetDeps: [selectedPathRobot, selectedPathWorkType, selectedPathFloor],
  });

  const handlePathPageChange = (page: number) => {
    setPathPage(page);
    setCheckedPathIds([]);
  };

  // ── 선택된 경로 row ──
  const selectedPathRow = useMemo(() => {
    if (selectedPathId == null) return null;
    return pathRows.find((r) => r.id === selectedPathId) ?? null;
  }, [selectedPathId, pathRows]);

  const singleCheckedPathRow = useMemo(() => {
    if (selectedPathId == null) return null;
    return pathRows.find((r) => r.id === selectedPathId) ?? null;
  }, [selectedPathId, pathRows]);

  // ── 체크 토글 ──
  const togglePathChecked = (pathId: number, checked: boolean) => {
    setCheckedPathIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, pathId]))
        : prev.filter((id) => id !== pathId);
      return next;
    });
  };

  const toggleAllCurrentPathItems = (checked: boolean) => {
    const currentPageIds = currentPathItems.map((r) => r.id);
    setCheckedPathIds((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, ...currentPageIds]))
        : prev.filter((id) => !currentPageIds.includes(id));
      return next;
    });
  };

  const isAllCurrentPathItemsChecked =
    currentPathItems.length > 0 && currentPathItems.every((r) => checkedPathIds.includes(r.id));

  // ── 필터 리셋 ──
  const resetPathSelection = () => {
    setCheckedPathIds([]);
    setSelectedPathId(null);
  };

  // ── DB fetch ──
  const fetchPathsFromDB = async () => {
    setPathLoading(true);
    try {
      const res = await apiFetch(PATH_API.LIST);
      if (!res.ok) throw new Error("경로 목록 조회 실패");

      const data = await res.json();
      const mapped: PathRow[] = data.map((p: any) => ({
        id: p.id,
        robotNo: p.RobotName,
        workType: p.TaskType,
        pathName: p.WayName,
        pathOrder: p.WayPoints,
        updatedAt: p.UpdateTime
          ? new Date(p.UpdateTime).toLocaleString("ko-KR")
          : "-",
      }));
      setPathRows(mapped);
    } catch (err) {
      console.error("경로 목록 로드 실패", err);
    } finally {
      setPathLoading(false);
    }
  };

  useEffect(() => {
    fetchPathsFromDB();
    fetchPlaces();
    fetchMaps();
  }, []);

  // ── 등록/수정 저장 ──
  const savePathToDB = async (payload: {
    id?: number;
    robotNo: string;
    workType: string;
    pathName: string;
    pathOrder: string;
  }) => {
    setPathLoading(true);
    try {
      const isEdit = payload.id != null;
      const url = isEdit ? PATH_API.UPDATE(payload.id!) : PATH_API.CREATE;
      const method = isEdit ? "PUT" : "POST";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RobotName: payload.robotNo,
          TaskType: payload.workType,
          WayName: payload.pathName,
          WayPoints: payload.pathOrder,
        }),
      });

      if (!res.ok) throw new Error("경로 저장 실패");

      await fetchPathsFromDB();

      setCheckedPathIds([]);
      setSelectedPathId(null);
      setPathPage(1);
    } catch (err) {
      console.error("경로 DB 저장 실패", err);
      throw err;
    } finally {
      setPathLoading(false);
    }
  };

  // ── 삭제 ──
  const confirmDeletePath = async () => {
    if (checkedPathIds.length === 0) return;
    setPathLoading(true);
    try {
      await Promise.all(
        checkedPathIds.map((id) =>
          apiFetch(PATH_API.DELETE(id), { method: "DELETE" })
        )
      );

      const del = new Set(checkedPathIds);
      setPathRows((prev) => prev.filter((p) => !del.has(p.id)));

      setCheckedPathIds([]);
      setSelectedPathId(null);
      setPathDeleteConfirmOpen(false);

      await fetchPathsFromDB();
    } catch (err) {
      console.error("경로 삭제 실패", err);
      setPathAlertMessage("경로 삭제에 실패했습니다.");
    } finally {
      setPathLoading(false);
    }
  };

  // ── 버튼 핸들러 ──
  const openPathCreate = () => {
    if (!isPathCreateEnabled) return;
    if (placeRows.length === 0) fetchPlaces();
    setPathCreateOpen(true);
  };

  const openPathEdit = () => {
    if (!isPathEditEnabled) return;
    if (placeRows.length === 0) fetchPlaces();
    setPathEditOpen(true);
  };

  const openPathDelete = () => {
    if (!isPathDeleteEnabled) return;
    setPathDeleteConfirmOpen(true);
  };

  // ── 렌더링 ──
  return (
    <>
      <div className={styles.pathWrap}>
        {/* LEFT: 경로 목록 */}
        <div className={styles.pathLeft}>
          <div className={styles.pathTopBar}>
            <h2>경로 목록</h2>

            <div className={styles.pathFilters}>
              <FilterSelectBox
                items={pathRobotOptions.map((no, i) => ({ id: i, label: no }))}
                selectedLabel={selectedPathRobot}
                placeholder="로봇명"
                showTotal={pathRobotOptions.length > 0}
                width={170}
                onSelect={(item) => {
                  setSelectedPathRobot(item?.label ?? null);
                  resetPathSelection();
                }}
              />

              <FilterSelectBox
                items={pathWorkTypeOptions.map((t, i) => ({ id: i, label: t }))}
                selectedLabel={selectedPathWorkType}
                placeholder="작업유형"
                width={130}
                onSelect={(item) => {
                  setSelectedPathWorkType(item?.label ?? null);
                  resetPathSelection();
                }}
              />

              <FilterSelectBox
                items={pathFloorOptions.map((f, i) => ({ id: i, label: f }))}
                selectedLabel={selectedPathFloor}
                placeholder="층"
                width={80}
                onSelect={(item) => {
                  setSelectedPathFloor(item?.label ?? null);
                  resetPathSelection();
                }}
              />
            </div>
          </div>

          {/* table + 로딩 오버레이 */}
          <div className={styles.pathListBoxWrap}>
            {pathLoading && (
              <div className={styles.pathLoadingOverlay}>
                <div className={styles.pathSpinner} />
              </div>
            )}
            <div className={styles.pathListBox}>
              <table className={`${styles.status} ${pathDeleteMode ? styles.pathTableDelete : styles.pathTable}`}>
                <thead>
                  <tr>
                    {pathDeleteMode && (
                      <th>
                        <img
                          src={isAllCurrentPathItemsChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                          alt="현재 페이지 경로 전체 선택"
                          style={{ cursor: "pointer" }}
                          onClick={() => toggleAllCurrentPathItems(!isAllCurrentPathItemsChecked)}
                        />
                      </th>
                    )}
                    <th>로봇명</th>
                    <th>작업유형</th>
                    <th>경로명</th>
                    <th>경로순서</th>
                  </tr>
                </thead>

                <tbody>
                  {currentPathItems.length === 0 && !pathLoading && (
                    <tr>
                      <td colSpan={pathDeleteMode ? 5 : 4}>
                        <div className={styles.pathEmptyWrap}>
                          <div className={styles.pathEmptyIcon}>!</div>
                          <div className={styles.pathEmptyTitle}>등록된 경로가 없습니다.</div>
                          <div className={styles.pathEmptyDesc}>경로 등록 버튼을 클릭하여 새 경로를 등록해 주세요.</div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {currentPathItems.map((row) => {
                    const deleteChecked = checkedPathIds.includes(row.id);
                    const isRowSelected = selectedPathId === row.id;

                    return (
                      <tr
                        key={row.id}
                        className={pathDeleteMode ? (deleteChecked ? styles.selectedRow : undefined) : (isRowSelected ? styles.selectedRow : undefined)}
                        style={{ cursor: "pointer" }}
                        onClick={() => pathDeleteMode ? togglePathChecked(row.id, !deleteChecked) : setSelectedPathId(isRowSelected ? null : row.id)}
                      >
                        {pathDeleteMode && (
                          <td>
                            <img
                              src={deleteChecked ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                              alt=""
                            />
                          </td>
                        )}
                        <td>{row.robotNo}</td>
                        <td>{row.workType}</td>
                        <td>{row.pathName}</td>
                        <td className={styles.pathOrderCell}>
                          <div className={styles.pathOrderText} title={row.pathOrder}>{row.pathOrder}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* bottom buttons */}
          {!hideActions && (
          <div className={styles.pathBottomBar}>
            {pathDeleteMode ? (
              <>
                <div
                  className={`${styles.pathPrimaryBtn} ${!isPathDeleteEnabled ? styles.btnDisabled : ""}`}
                  onClick={() => { if (isPathDeleteEnabled) openPathDelete(); }}
                >
                  <img src="/icon/delete_icon.png" alt="" />
                  <span>삭제 확인 ({pathCheckedCount})</span>
                </div>
                <div className={styles.robotWorkBox}>
                  <div
                    className={styles.robotWorkCommonBtn}
                    onClick={() => { setPathDeleteMode(false); setCheckedPathIds([]); }}
                  >
                    <img src="/icon/close_btn.png" alt="" />
                    취소
                  </div>
                </div>
              </>
            ) : (
              <>
                <div
                  className={styles.pathPrimaryBtn}
                  onClick={openPathCreate}
                >
                  <img src="/icon/check.png" alt="check" />
                  <span>경로 등록</span>
                </div>

                <div className={styles.robotWorkBox}>
                  <div
                    className={styles.robotWorkCommonBtn}
                    onClick={() => { setPathDeleteMode(true); setCheckedPathIds([]); setSelectedPathId(null); }}
                  >
                    <img src="/icon/delete_icon.png" alt="" />
                    경로 삭제
                  </div>

                  <div
                    className={styles.robotWorkCommonBtn}
                    onClick={openPathEdit}
                    aria-disabled={!isPathEditEnabled}
                  >
                    <img src="/icon/edit_icon.png" alt="" />
                    경로 수정
                  </div>
                </div>
              </>
            )}
          </div>
          )}
          <div className={styles.pathPagination}>
            <Pagination
              totalItems={pathTotalItems}
              currentPage={pathPage}
              onPageChange={handlePathPageChange}
              pageSize={PATH_PAGE_SIZE}
              blockSize={5}
            />
          </div>
        </div>

        {/* RIGHT: 경로 미리보기 */}
        <div className={styles.pathRight}>
          <div className={styles.robotPlaceBox}>
            <h2>경로 미리보기</h2>
            <span className={styles.pathHintInline}>목록에서 경로를 클릭하면 경로가 지도에 표시됩니다.</span>
            {hideActions && (
              <div className={styles.rightHeaderActions}>
                {pathDeleteMode ? (
                  <>
                    <div
                      className={`${styles.robotWorkCommonBtn} ${!isPathDeleteEnabled ? styles.btnDisabled : ""}`}
                      onClick={() => { if (isPathDeleteEnabled) openPathDelete(); }}
                      aria-disabled={!isPathDeleteEnabled}
                    >
                      <img src="/icon/delete_icon.png" alt="" />
                      삭제 확인 ({pathCheckedCount})
                    </div>
                    <div
                      className={styles.robotWorkCommonBtn}
                      onClick={() => { setPathDeleteMode(false); setCheckedPathIds([]); }}
                    >
                      <img src="/icon/close_btn.png" alt="" />
                      취소
                    </div>
                  </>
                ) : (
                  <div
                    className={styles.robotWorkCommonBtn}
                    onClick={() => { setPathDeleteMode(true); setCheckedPathIds([]); setSelectedPathId(null); }}
                  >
                    <img src="/icon/delete_icon.png" alt="" />
                    경로 삭제
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedPathRow == null ? (
            <div className={styles.monitoringPlaceholder}>
              <span>목록에서 경로를 선택하면 경로가 표시됩니다.</span>
            </div>
          ) : (
            <div className={styles.pathMapCard}>
              <PathMapView
                selectedPath={selectedPathRow}
                placeRows={placeRows}
                mapRows={mapRows}
              />
            </div>
          )}
        </div>
      </div>

      <PathCrudModal
        isOpen={pathCreateOpen}
        mode="create"
        placeRows={placeRows}
        existingPaths={pathRows}
        initial={null}
        onClose={() => setPathCreateOpen(false)}
        onSubmit={savePathToDB}
        robots={robots}
        floors={floors}
      />

      <PathCrudModal
        isOpen={pathEditOpen}
        mode="edit"
        placeRows={placeRows}
        existingPaths={pathRows}
        robots={robots}
        floors={floors}
        initial={singleCheckedPathRow}
        onClose={() => setPathEditOpen(false)}
        onSubmit={savePathToDB}
      />

      <PathDeleteConfirmModal
        isOpen={pathDeleteConfirmOpen}
        message={
          checkedPathIds.length <= 1
            ? "선택한 경로를 정말 삭제하시겠습니까?"
            : `${checkedPathIds.length}개의 경로를 정말 삭제하시겠습니까?`
        }
        onCancel={() => setPathDeleteConfirmOpen(false)}
        onConfirm={confirmDeletePath}
      />

      {/* 경로 관리 알림 모달 */}
      <PathAlertsModal
        isOpen={!!pathAlertMessage}
        message={pathAlertMessage ?? ""}
        onCancel={() => setPathAlertMessage(null)}
        onConfirm={() => setPathAlertMessage(null)}
      />
    </>
  );
}
