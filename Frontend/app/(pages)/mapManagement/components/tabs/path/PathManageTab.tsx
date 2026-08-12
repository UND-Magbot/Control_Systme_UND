"use client";

import React, { useState, useEffect, useMemo } from 'react';
import styles from '../../PlacePathList.module.css';
import Pagination from "@/app/components/common/Pagination";
import { usePaginatedList } from "@/app/hooks/usePaginatedList";
import type { RobotRowData, Floor } from '@/app/types';
import type { PlaceRow } from "@/app/types";
import PathCrudModal from "@/app/(pages)/mapManagement/components/tabs/path/PathCrudModal";
import type { StopAction } from "@/app/(pages)/mapManagement/components/tabs/path/PathStopOptionsModal";
import PathDeleteConfirmModal from "@/app/(pages)/mapManagement/components/tabs/path/PathDeleteConfirmModal";
import PathMapView from "@/app/(pages)/mapManagement/components/tabs/path/PathMapView";
import PathAlertsModal from "@/app/(pages)/mapManagement/components/tabs/path/PathAlertsModal";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import { apiFetch } from "@/app/lib/api";
import { formatPathOrderWithWaits } from "@/app/lib/pathOrder";
import { WORK_TYPES, resolveTaskTypeLabel } from "@/app/lib/taskType";
import type { FloorMapRow } from "@/app/(pages)/mapManagement/hooks/useFloorMapConfig";

const PATH_PAGE_SIZE = 9;
const robotTypes = WORK_TYPES.map((t) => t.label);

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
  waitSeconds?: number[];
  stopActions?: (StopAction | null)[]; // 경유지 도착 상호작용
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
  const [pathSearch, setPathSearch] = useState(""); // G-02: 경로명 검색
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
      // 장소 로드 실패 시 경로 수정 모달의 '경로순서'가 조용히 비게 되므로 사용자에게 알린다.
      setPathAlertMessage("장소 목록을 불러오지 못해 경로 순서를 복원할 수 없습니다. 네트워크 확인 후 다시 시도해 주세요.");
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
    // G-02: 경로명 검색 — 대소문자·띄어쓰기 무시 + 단어(토큰) 단위 AND 매칭.
    // "약품 배송" 입력 시 "약품배송_3층"처럼 공백이 다르거나 순서만 나뉜 경우도 매칭.
    const searchTokens = pathSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return pathRows
      .filter((r) => {
        const robotOk = !selectedPathRobot || r.robotNo === selectedPathRobot;
        const typeOk = !selectedPathWorkType || r.workType === selectedPathWorkType;
        const pathFloor = getPathFloor(r);
        // E-09: 층을 알 수 없는 경로(장소 미로드/삭제)는 필터에서 조용히 제외하지 않고 표시.
        const floorOk = !selectedPathFloor || pathFloor === null || pathFloor === selectedPathFloor;
        // 대상도 소문자+공백 제거 후, 모든 검색 토큰이 포함되면 통과.
        const target = r.pathName.toLowerCase().replace(/\s+/g, "");
        const searchOk = searchTokens.length === 0 || searchTokens.every((t) => target.includes(t));
        return robotOk && typeOk && floorOk && searchOk;
      })
      .sort((a, b) => {
        const ta = new Date(a.updatedAt).getTime() || 0;
        const tb = new Date(b.updatedAt).getTime() || 0;
        return tb - ta;
      });
  }, [pathRows, placeRows, selectedPathRobot, selectedPathWorkType, selectedPathFloor, pathSearch]);

  // ── 페이지네이션 ──
  const { currentPage: pathPage, setPage: setPathPage, resetPage: resetPathPage, pagedItems: currentPathItems, totalItems: pathTotalItems } = usePaginatedList(filteredPathRows, {
    pageSize: PATH_PAGE_SIZE,
    resetDeps: [selectedPathRobot, selectedPathWorkType, selectedPathFloor, pathSearch],
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
      const mapped: PathRow[] = data.map((p: any) => {
        let waitSeconds: number[] | undefined;
        if (p.WaitSeconds) {
          try {
            const parsed = JSON.parse(p.WaitSeconds);
            if (Array.isArray(parsed)) {
              waitSeconds = parsed.map((n: any) => {
                const v = Number(n);
                return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
              });
            }
          } catch {
            waitSeconds = undefined;
          }
        }
        let stopActions: PathRow["stopActions"];
        if (p.StopActions) {
          try {
            const parsed = JSON.parse(p.StopActions);
            if (Array.isArray(parsed)) stopActions = parsed;
          } catch {
            stopActions = undefined;
          }
        }
        return {
          id: p.id,
          robotNo: p.RobotName,
          workType: resolveTaskTypeLabel(p.TaskType),
          pathName: p.WayName,
          pathOrder: p.WayPoints,
          waitSeconds,
          stopActions,
          updatedAt: p.UpdateTime
            ? new Date(p.UpdateTime).toLocaleString("ko-KR")
            : "-",
        };
      });
      setPathRows(mapped);
    } catch (err) {
      console.error("경로 목록 로드 실패", err);
      setPathAlertMessage("경로 목록을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
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
    waitSeconds?: number[];
    stopActions?: PathRow["stopActions"];
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
          WaitSeconds: payload.waitSeconds && payload.waitSeconds.length > 0
            ? JSON.stringify(payload.waitSeconds)
            : null,
          // 상호작용이 하나라도 설정된 경우에만 저장 (전부 null 이면 기존 동작 유지)
          StopActions:
            payload.stopActions && payload.stopActions.some((s) => s != null)
              ? JSON.stringify(payload.stopActions)
              : null,
        }),
      });

      if (!res.ok) throw new Error("경로 저장 실패");

      await fetchPathsFromDB();

      setCheckedPathIds([]);
      setSelectedPathId(null);
      setPathPage(1);
      // E-06: 저장/수정한 경로가 현재 필터에 걸려 안 보이면 '실패'로 오인하므로 필터 초기화.
      setSelectedPathRobot(null);
      setSelectedPathWorkType(null);
      setSelectedPathFloor(null);
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
    if (pathLoading) return; // E-05: 진행 중 재진입(더블클릭) 방지
    setPathLoading(true);
    try {
      const ids = [...checkedPathIds];
      // E-02: allSettled로 부분 실패를 집계하고, 성공/실패 무관하게 재조회로 화면·DB를 동기화한다.
      const results = await Promise.allSettled(
        ids.map((id) =>
          apiFetch(PATH_API.DELETE(id), { method: "DELETE" }).then((r) => {
            if (!r.ok) throw new Error(`삭제 실패 id=${id}`);
            return id;
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;

      setCheckedPathIds([]);
      setSelectedPathId(null);
      setPathDeleteConfirmOpen(false);

      await fetchPathsFromDB();
      setPathPage(1); // E-07: 삭제 후 페이지 경계 초과로 인한 빈 화면 방지

      if (failed > 0) {
        setPathAlertMessage(`${ids.length}개 중 ${failed}개 삭제에 실패했습니다. 목록을 다시 확인해 주세요.`);
      }
    } catch (err) {
      console.error("경로 삭제 실패", err);
      setPathAlertMessage("경로 삭제에 실패했습니다.");
      await fetchPathsFromDB();
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

              {/* G-02: 경로명 검색 + 새로고침 */}
              <input
                className={styles.pathSearchInput}
                value={pathSearch}
                onChange={(e) => { setPathSearch(e.target.value); resetPathSelection(); }}
                placeholder="경로명 검색"
                aria-label="경로명 검색"
              />
              <button
                type="button"
                className={styles.pathRefreshBtn}
                onClick={() => fetchPathsFromDB()}
                title="새로고침"
                aria-label="경로 목록 새로고침"
              >
                <img src="/icon/data_update.png" alt="" />
              </button>
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
                        tabIndex={0}
                        aria-selected={pathDeleteMode ? deleteChecked : isRowSelected}
                        onClick={() => pathDeleteMode ? togglePathChecked(row.id, !deleteChecked) : setSelectedPathId(isRowSelected ? null : row.id)}
                        onKeyDown={(e) => {
                          // A-02: Enter/Space로 행 선택·체크(키보드 조작)
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (pathDeleteMode) togglePathChecked(row.id, !deleteChecked);
                            else setSelectedPathId(isRowSelected ? null : row.id);
                          }
                        }}
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
                          {(() => {
                            const display = formatPathOrderWithWaits(row.pathOrder, row.waitSeconds);
                            return (
                              <div className={styles.pathOrderText} title={display}>{display}</div>
                            );
                          })()}
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
                    className={`${styles.robotWorkCommonBtn} ${!isPathEditEnabled ? styles.btnDisabled : ""}`}
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
