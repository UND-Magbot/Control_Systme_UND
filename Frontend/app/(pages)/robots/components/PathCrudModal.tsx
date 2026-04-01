"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PathCrudModal.module.css";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import type { RobotRowData, Floor } from "@/app/type";
import ResetUpdate from "./PathDeleteConfirmModal";
import PathAlertsModal from "./PathAlertsModal";
import PathMapView from "./PathMapView";
import FilterSelectBox, { type FilterOption } from "@/app/components/button/FilterSelectBox";

export type PathWorkType = "task1" | "task2" | "task3";

export type PlaceRow = {
  id: number;
  robotNo: string;
  floor: string;
  placeName: string;
  x: number;
  y: number;
  updatedAt?: string;
};

export type RouteRow = {
  id: number;
  MapId: number;
  StartPlaceName: string;
  EndPlaceName: string;
  Direction: string; // "forward" | "reverse" | "bidirectional"
};

export type PathRow = {
  id: number;
  robotNo: string;
  workType: string;
  pathName: string;
  pathOrder: string;
  updatedAt: string;
};

type Mode = "create" | "edit";

type Props = {
  isOpen: boolean;
  mode: Mode;
  onClose: () => void;

  // ✅ 장소 목록(좌측 리스트에 사용)
  placeRows: PlaceRow[];
  robots: RobotRowData[];
  floors: Floor[];

  // ✅ 도로(연결 가능 구간) 목록 — 경로 필터링용
  routes?: RouteRow[];

  // ✅ 수정 모드일 때 초기값
  initial: PathRow | null;

  // ✅ 기존 경로 목록 (경로명 중복 검증용)
  existingPaths?: PathRow[];

  // ✅ 저장 시 상위로 전달
  onSubmit: (payload: Omit<PathRow, "id" | "updatedAt"> & { id?: number }) => Promise<void>;
};

const WORK_TYPES: PathWorkType[] = ["task1", "task2", "task3"];

function restorePathOrder(initial: PathRow, placeRows: PlaceRow[]) {
  const raw = initial.pathOrder ?? "";
  const names = raw
    .split(" - ")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log("[restorePathOrder] raw pathOrder:", JSON.stringify(raw));
  console.log("[restorePathOrder] parsed names:", names);
  console.log("[restorePathOrder] placeRows count:", placeRows.length);
  console.log("[restorePathOrder] placeRow names:", placeRows.map(p => p.placeName));

  const valid: PlaceRow[] = [];
  const missing: string[] = [];

  for (let i = 0; i < names.length; i++) {
    const found = placeRows.find((p) => p.placeName === names[i]);
    if (found) valid.push(found);
    else missing.push(names[i]);
  }

  console.log("[restorePathOrder] valid:", valid.length, "missing:", missing);
  return { valid, missing };
}

function nowKSTString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}:${ss}`;
}


export default function PathCrudModal({
  isOpen,
  mode,
  onClose,
  placeRows,
  robots,
  floors,
  routes = [],
  initial,
  existingPaths = [],
  onSubmit,
}: Props) {
  // 저장 중 상태 (중복 클릭 방지)
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 미저장 변경사항 닫기 확인 모달
  const [isCloseConfirmOpen, setCloseConfirmOpen] = useState(false);
  // ---------- 좌측 필터(로봇/층) ----------
  const [selectedRobot, setSelectedRobot] = useState<string | null>(null); // null=Total
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null); // null=Total
  const [placeSearch, setPlaceSearch] = useState(""); // 장소명 검색

  // ---------- 우측 폼 ----------

  const [workType, setWorkType] = useState<PathWorkType | null>(null);
  const [pathName, setPathName] = useState("");
  const [initialSnapshot, setInitialSnapshot] = useState<{
    workType: PathWorkType | null;
    pathName: string;
    selectedOrder: PlaceRow[];
  } | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);



  // ---------- 경로 순서(선택된 장소들) ----------
  const [selectedOrder, setSelectedOrder] = useState<PlaceRow[]>([]);
  const [activePlaceId, setActivePlaceId] = useState<number | null>(null);
  const placeScrollRef = useRef<HTMLDivElement>(null);
  const placeTrackRef = useRef<HTMLDivElement>(null);
  const placeThumbRef = useRef<HTMLDivElement>(null);
  const orderScrollRef = useRef<HTMLDivElement>(null);
  const orderTrackRef = useRef<HTMLDivElement>(null);
  const orderThumbRef = useRef<HTMLDivElement>(null);
  const [shouldShowOrderScroll, setShouldShowOrderScroll] = useState(false);
  const [rightPanelHeight, setRightPanelHeight] = useState<number | null>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const [hadPlaces, setHadPlaces] = useState(placeRows.length > 0);

  // 경로 초기화 확인 모달
  const [isPathResetConfirmOpen, setPathResetConfirmOpen] = useState(false);

  // 편집 모드에서 경로 순서 복원이 완료되었는지 추적
  const [editRestored, setEditRestored] = useState(false);

  // 초기값(수정 모드) — isOpen/mode/initial 변경 시 전체 초기화
  useEffect(() => {
    if (!isOpen) {
      setEditRestored(false);
      return;
    }

    setActivePlaceId(null);
    setEditRestored(false);

    if (mode === "edit" && initial) {
      const nextWorkType = (initial.workType as PathWorkType) ?? null;
      const nextPathName = initial.pathName ?? "";
      setWorkType(nextWorkType);
      setPathName(nextPathName);
      setSelectedRobot(initial.robotNo ?? null);

      // placeRows가 아직 비어있으면 빈 순서로 시작 (placeRows 로드 후 재복원)
      if (placeRows.length === 0) {
        setSelectedOrder([]);
        setInitialSnapshot({
          workType: nextWorkType,
          pathName: nextPathName,
          selectedOrder: [],
        });
      } else {
        const restored = restorePathOrder(initial, placeRows);
        setSelectedOrder(restored.valid);
        setInitialSnapshot({
          workType: nextWorkType,
          pathName: nextPathName,
          selectedOrder: restored.valid,
        });
        if (restored.missing.length > 0) {
          setAlertMessage(`일부 장소가 삭제되어 경로에서 제외되었습니다: ${restored.missing.join(", ")}`);
        }
        setEditRestored(true);
      }
    } else {
      // create
      setWorkType(null);
      setPathName("");
      setSelectedOrder([]);
      setSelectedRobot(null);
      setSelectedFloor(null);
      setPlaceSearch("");
      setActivePlaceId(null);
      setInitialSnapshot(null);
    }
    setHadPlaces(placeRows.length > 0);
  }, [isOpen, mode, initial]);

  // placeRows가 뒤늦게 로드되었을 때 편집 모드 경로 순서 재복원
  useEffect(() => {
    if (!isOpen || mode !== "edit" || !initial) return;
    if (editRestored || placeRows.length === 0) return;

    const nextWorkType = (initial.workType as PathWorkType) ?? null;
    const nextPathName = initial.pathName ?? "";
    const restored = restorePathOrder(initial, placeRows);

    setWorkType(nextWorkType);
    setPathName(nextPathName);
    setSelectedRobot(initial.robotNo ?? null);
    setSelectedOrder(restored.valid);
    setInitialSnapshot({
      workType: nextWorkType,
      pathName: nextPathName,
      selectedOrder: restored.valid,
    });
    if (restored.missing.length > 0) {
      setAlertMessage(`일부 장소가 삭제되어 경로에서 제외되었습니다: ${restored.missing.join(", ")}`);
    }
    setEditRestored(true);
  }, [isOpen, mode, initial, placeRows, editRestored]);


  const robotFilterItems: FilterOption[] = useMemo(
    () => Array.from(new Set(robots.map((r) => r.no))).map((no) => ({ id: no, label: no })),
    [robots]
  );
  const floorFilterItems: FilterOption[] = useMemo(
    () => Array.from(new Set(floors.map((f) => f.label))).map((label) => ({ id: label, label })),
    [floors]
  );
  const workTypeFilterItems: FilterOption[] = useMemo(
    () => WORK_TYPES.map((t) => ({ id: t, label: t })),
    []
  );

  // 현재 마지막 장소에서 도로로 연결 가능한 장소 이름 Set
  const reachablePlaceNames = useMemo(() => {
    if (selectedOrder.length === 0 || routes.length === 0) return null; // null = 제한 없음 (시작점 선택)
    const lastPlace = selectedOrder[selectedOrder.length - 1];
    const names = new Set<string>();
    for (const r of routes) {
      // forward: start → end 방향만
      if (r.Direction === "forward" && r.StartPlaceName === lastPlace.placeName) {
        names.add(r.EndPlaceName);
      }
      // reverse: end → start 방향만
      if (r.Direction === "reverse" && r.EndPlaceName === lastPlace.placeName) {
        names.add(r.StartPlaceName);
      }
      // bidirectional: 양쪽 다
      if (r.Direction === "bidirectional") {
        if (r.StartPlaceName === lastPlace.placeName) names.add(r.EndPlaceName);
        if (r.EndPlaceName === lastPlace.placeName) names.add(r.StartPlaceName);
      }
    }
    return names;
  }, [selectedOrder, routes]);

  const filteredPlaceRows = useMemo(() => {
    const keyword = placeSearch.trim().toLowerCase();
    return placeRows.filter((p) => {
      const robotOk = !selectedRobot || p.robotNo === selectedRobot;
      const floorOk = !selectedFloor || p.floor === selectedFloor;
      const searchOk = !keyword || p.placeName.toLowerCase().includes(keyword);
      // 도로 필터: routes가 있고 시작점이 선택됐으면, 연결 가능한 장소만 표시
      const routeOk = !reachablePlaceNames || reachablePlaceNames.has(p.placeName);
      return robotOk && floorOk && searchOk && routeOk;
    });
  }, [placeRows, selectedRobot, selectedFloor, placeSearch, reachablePlaceNames]);

  const shouldShowPlaceScroll = filteredPlaceRows.length > 0;

  useCustomScrollbar({
    enabled: isOpen && shouldShowPlaceScroll,
    scrollRef: placeScrollRef,
    trackRef: placeTrackRef,
    thumbRef: placeThumbRef,
    minThumbHeight: 50,
    deps: [filteredPlaceRows.length],
  });


  useEffect(() => {
    if (!isOpen) return;

    const updateOrderScroll = () => {
      const scrollEl = orderScrollRef.current;
      if (!scrollEl) return;
      setShouldShowOrderScroll(scrollEl.scrollHeight > scrollEl.clientHeight);
    };

    const raf = requestAnimationFrame(updateOrderScroll);
    return () => cancelAnimationFrame(raf);
  }, [isOpen, selectedOrder.length]);

  useCustomScrollbar({
    enabled: isOpen && shouldShowOrderScroll,
    scrollRef: orderScrollRef,
    trackRef: orderTrackRef,
    thumbRef: orderThumbRef,
    minThumbHeight: 50,
    deps: [selectedOrder.length],
  });

  useEffect(() => {
    if (!isOpen) return;

    const leftEl = leftPanelRef.current;
    if (!leftEl) return;

    const syncRightHeight = () => setRightPanelHeight(leftEl.clientHeight);
    syncRightHeight();

    const ro = new ResizeObserver(syncRightHeight);
    ro.observe(leftEl);

    return () => ro.disconnect();
  }, [isOpen]);

  const togglePickPlace = (row: PlaceRow) => {
    setActivePlaceId(row.id);
    setSelectedOrder((prev) => {
      // 로봇 혼합 방지: 첫 장소의 로봇과 다른 로봇의 장소 선택 차단
      if (prev.length > 0 && prev[0].robotNo !== row.robotNo) {
        setAlertMessage("하나의 경로에는 같은 로봇의 장소만 추가할 수 있습니다.");
        return prev;
      }
      const last = prev[prev.length - 1];
      if (last && last.id === row.id) {
        setAlertMessage("같은 장소는 연속으로 선택할 수 없습니다.");
        return prev;
      }
      if (prev.length >= 10) {
        setAlertMessage("경로 순서는 최대 10개까지 추가할 수 있습니다.");
        return prev;
      }
      // 첫 장소 추가 시 로봇 필터 자동 설정
      if (prev.length === 0 && mode === "create") {
        setSelectedRobot(row.robotNo);
      }
      return [...prev, row]; // ✅ 클릭 시 경로 순서에 "추가(append)"
    });
  };

  const removeOrderItem = (index: number) => {
    setSelectedOrder((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setActivePlaceId(null);
      return next;
    });
  };

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    setSelectedOrder((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    setSelectedOrder((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return next;
    });
  };

  const resetOrderOnly = () => {
    if (mode === "edit" && initialSnapshot) {
      setWorkType(initialSnapshot.workType);
      setPathName(initialSnapshot.pathName);
      setSelectedOrder(initialSnapshot.selectedOrder);
      setActivePlaceId(null);
      return;
    }
    setWorkType(null);
    setPathName("");
    setSelectedOrder([]);
    setSelectedRobot(null);
    setSelectedFloor(null);
    setActivePlaceId(null);
  };

  // 미저장 변경사항 감지
  const hasUnsavedChanges = useMemo(() => {
    if (mode === "create") {
      return workType != null || pathName.trim().length > 0 || selectedOrder.length > 0;
    }
    if (!initialSnapshot) return false;
    return (
      workType !== initialSnapshot.workType ||
      pathName !== initialSnapshot.pathName ||
      selectedOrder.length !== initialSnapshot.selectedOrder.length ||
      selectedOrder.some((p, i) => p.id !== initialSnapshot.selectedOrder[i]?.id)
    );
  }, [mode, workType, pathName, selectedOrder, initialSnapshot]);

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  };

  const canSave =
    !!workType && pathName.trim().length > 0 && selectedOrder.length > 0;

  const handleSave = async () => {
    if (isSubmitting) return;

    if (!workType) {
      setAlertMessage("작업유형을 선택해 주세요.");
      return;
    }
    if (pathName.trim().length === 0) {
      setAlertMessage("경로명을 입력해 주세요.");
      return;
    }
    // 경로명 특수문자 검증 (한글/영문/숫자/공백/하이픈/언더스코어만 허용)
    if (!/^[\uAC00-\uD7A3a-zA-Z0-9\s\-_]+$/.test(pathName.trim())) {
      setAlertMessage("경로명에 특수문자를 사용할 수 없습니다.");
      return;
    }
    if (selectedOrder.length === 0) {
      setAlertMessage("장소를 1개 이상 선택해 주세요.");
      return;
    }

    // 경로명 중복 검증 (수정 시 자기 자신 제외)
    const isDuplicate = existingPaths.some(
      (p) => p.pathName === pathName.trim() && p.id !== initial?.id
    );
    if (isDuplicate) {
      setAlertMessage("이미 동일한 경로명이 존재합니다.");
      return;
    }

    // 저장 전 장소 존재 여부 재검증
    const missingPlaces = selectedOrder.filter(
      (p) => !placeRows.some((pr) => pr.id === p.id)
    );
    if (missingPlaces.length > 0) {
      setAlertMessage("일부 장소가 삭제되었습니다. 경로를 다시 확인해 주세요.");
      return;
    }

    if (!canSave) return;

    // ✅ robotNo는 "경로 순서 1번" 기준으로 세팅(필요 시 정책 변경 가능)
    const robotNo = selectedOrder[0]?.robotNo ?? "";

    setIsSubmitting(true);
    try {
      await onSubmit({
        id: mode === "edit" && initial ? initial.id : undefined,
        robotNo,
        workType: workType!,
        pathName: pathName.trim(),
        pathOrder: selectedOrder.map((p) => p.placeName).join(" - "),
      });
      onClose();
    } catch {
      setAlertMessage("경로 저장에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const hasPlaces = placeRows.length > 0;
    if (!hadPlaces && hasPlaces) {
      if (mode === "edit" && initialSnapshot) {
        setWorkType(initialSnapshot.workType);
        setPathName(initialSnapshot.pathName);
        setSelectedOrder(initialSnapshot.selectedOrder);
        setActivePlaceId(null);
      } else {
        setWorkType(null);
        setPathName("");
        setSelectedOrder([]);
        setActivePlaceId(null);
      }
    }
    setHadPlaces(hasPlaces);
  }, [isOpen, placeRows.length, hadPlaces, mode, initialSnapshot]);

  if (!isOpen) return null;

  const isPathOrderDisabled = mode === "create" && selectedOrder.length === 0;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        {/* 헤더 */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <img src="/icon/path_w.png" alt="" className={styles.headerIcon} />
            <div className={styles.headerTitle}>{mode === "edit" ? "경로 수정" : "경로 등록"}</div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={handleClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {/* LEFT */}
          <div ref={leftPanelRef} className={styles.left}>
            <div className={styles.sectionTitle}>
              <span>1. 장소 선택</span>

              <div className={styles.filters}>
                {/* 로봇명 */}
                <FilterSelectBox
                  items={robotFilterItems}
                  selectedLabel={mode === "edit" ? (initial?.robotNo ?? selectedRobot) : selectedRobot}
                  placeholder="로봇명"
                  onSelect={(item) => setSelectedRobot(item?.label ?? null)}
                  width={140}
                  className={mode === "edit" ? styles.selecteDisabled : undefined}
                />

                {/* 층별 */}
                <FilterSelectBox
                  items={floorFilterItems}
                  selectedLabel={selectedFloor}
                  placeholder="층"
                  showTotal
                  onSelect={(item) => setSelectedFloor(item?.label ?? null)}
                  width={80}
                  className={mode === "edit" ? styles.selecteDisabled : undefined}
                />
              </div>
            </div>


            {/* 장소명 검색 */}
            <input
              className={styles.searchInput}
              value={placeSearch}
              onChange={(e) => setPlaceSearch(e.target.value)}
              placeholder="장소명 검색"
            />

            {/* 테이블 */}
            <div className={styles.placeTableWrap}>
              <div className={styles.placeHead}>
                <div></div>
                <div>로봇명</div>
                <div>층별</div>
                <div>장소명</div>
              </div>

              {placeRows.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <div className={styles.emptyIcon}>!</div>
                  <div className={styles.emptyTitle}>현재 등록된 장소가 없습니다.</div>
                  <div className={styles.emptyDesc}>
                    장소 관리 화면에서 "장소 등록"을 먼저 진행해 주세요.
                  </div>
                </div>
              ) : (
                <div className={styles.placeBodyWrap}>
                  <div ref={placeScrollRef} className={styles.placeBody}>
                    {filteredPlaceRows.map((row) => {
                      const picked = activePlaceId === row.id;
                      const orderCount = selectedOrder.filter((p) => p.id === row.id).length;
                      return (
                        <div
                          key={row.id}
                          className={`${styles.placeRow} ${picked ? styles.placeRowPicked : ""}`}
                          onClick={() => togglePickPlace(row)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              togglePickPlace(row);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className={styles.pickDot}>
                            {orderCount > 0 ? (
                              <span className={styles.placeCountBadge}>{orderCount}</span>
                            ) : (
                              <span className={`${styles.dot} ${picked ? styles.dotOn : ""}`} />
                            )}
                          </div>
                          <div className={styles.placeCol}>{row.robotNo}</div>
                          <div className={styles.placeCol}>{row.floor}</div>
                          <div className={styles.placeCol}>{row.placeName}</div>
                        </div>
                      );
                    })}
                  </div>
                  {shouldShowPlaceScroll && (
                    <div ref={placeTrackRef} className={styles.placeScrollTrack}>
                      <div ref={placeThumbRef} className={styles.placeScrollThumb} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <PathAlertsModal
            isOpen={!!alertMessage}
            message={alertMessage ?? ""}
            onCancel={() => setAlertMessage(null)}
            onConfirm={() => setAlertMessage(null)}
          />

          {/* 미저장 변경사항 닫기 확인 */}
          <ResetUpdate
            isOpen={isCloseConfirmOpen}
            message="변경사항이 저장되지 않습니다. 닫으시겠습니까?"
            onCancel={() => setCloseConfirmOpen(false)}
            onConfirm={() => {
              setCloseConfirmOpen(false);
              onClose();
            }}
          />

          {/* RIGHT */}
          <div
            className={styles.right}
            style={{ ...(rightPanelHeight ? { height: rightPanelHeight } : {}), position: "relative" }}
          >
            {isPathOrderDisabled && (
              <div className={styles.rightDisabledOverlay}>
                <div className={styles.rightDisabledText}>
                  좌측에서 장소를 먼저 선택해 주세요
                </div>
              </div>
            )}
            <div className={styles.sectionTitle}>
              <span>2. 경로 순서{selectedOrder.length > 0 && ` (${selectedOrder.length}/10)`}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {selectedOrder.length > 0 && (
                  <button
                    type="button"
                    className={styles.clearAllBtn}
                    onClick={() => { setSelectedOrder([]); setActivePlaceId(null); }}
                  >
                    전체삭제
                  </button>
                )}
                <button
                  type="button"
                  className={styles.resetBtn}
                  onClick={() => setPathResetConfirmOpen(true)}
                  aria-label="reset"
                  title="경로 초기화"
                >
                  <img src="/icon/data_update.png" alt="" />
                </button>
              </div>
            </div>
            <ResetUpdate 
              isOpen={isPathResetConfirmOpen}
              message={"경로 등록을 정말로 초기화하시겠습니까?"}
              onCancel={() => setPathResetConfirmOpen(false)}
              onConfirm={() => {
                setPathResetConfirmOpen(false);
                resetOrderOnly();
              }}
            />

            {/* 작업유형 */}
            <div className={`${styles.formRow} ${styles.mb8}`}>
              <div className={styles.formLabel}>작업유형</div>
              <FilterSelectBox
                items={workTypeFilterItems}
                selectedLabel={workType}
                placeholder="작업유형을 선택하세요"
                showTotal={false}
                onSelect={(item) => setWorkType((item?.label as PathWorkType) ?? null)}
                width="100%"
              />
            </div>

            {/* 경로명 */}
            <div className={styles.formRow}>
              <div className={styles.formLabel}>경로명</div>
              <input
                className={styles.textInput}
                value={pathName}
                onChange={(e) => setPathName(e.target.value)}
                placeholder="8자(16byte) 이내로 작성하세요"
                maxLength={8}
              />
            </div>

            <div className={styles.divider} />

            {/* 선택된 순서 */}
            <div className={styles.orderListWrap}>
              {selectedOrder.length === 0 ? (
                <div className={styles.orderEmptyWrap}>
                  <div className={styles.orderEmptyIcon}>&#8592;</div>
                  <div className={styles.orderEmptyText}>
                    좌측에서 장소를 클릭하여<br />경로를 구성하세요
                  </div>
                </div>
              ) : (
              <>
              <div ref={orderScrollRef} className={styles.orderList}>
                {selectedOrder.map((p, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === selectedOrder.length - 1;

                  return (
                    <React.Fragment key={`${p.id}-${idx}`}>
                      <div className={styles.orderCard}>
                        <div className={styles.orderTop}>
                          <div className={styles.orderIndex}>{idx + 1}</div>
                          <div className={styles.orderTitle}>{p.placeName}</div>

                          <button
                            type="button"
                            className={styles.orderDelete}
                            onClick={() => removeOrderItem(idx)}
                            aria-label="delete"
                          >
                            <img src="/icon/close_btn.png" alt="" />
                          </button>
                        </div>

                        <div className={styles.orderBottom}>
                          <div className={styles.orderMeta}>
                            <div>{p.robotNo}</div>
                            <div className={styles.metaSep} />
                            <div>{p.floor}</div>
                          </div>

                          <div className={styles.orderMoves}>
                            <button
                              type="button"
                              className={`${styles.moveBtn} ${isFirst ? styles.moveDisabled : ""}`}
                              onClick={() => moveUp(idx)}
                              aria-disabled={isFirst}
                            >
                              <img src="/icon/path_up.png" alt="" />
                            </button>
                            <button
                              type="button"
                              className={`${styles.moveBtn} ${isLast ? styles.moveDisabled : ""}`}
                              onClick={() => moveDown(idx)}
                              aria-disabled={isLast}
                            >
                              <img src="/icon/path_down.png" alt="" />
                            </button>
                          </div>
                        </div>
                      </div>
                      {!isLast && (
                        <div className={styles.orderWay}>
                          <img src="/icon/path_way.png" alt="" />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              {shouldShowOrderScroll && (
                <div ref={orderTrackRef} className={styles.orderScrollTrack}>
                  <div ref={orderThumbRef} className={styles.orderScrollThumb} />
                </div>
              )}
              </>
              )}
            </div>

            <div className={styles.divider} />

            {/* 하단 버튼 */}
            <div className={styles.insertBtnTotal}>
              <button type="button" className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`} onClick={handleClose}>
                <img src="/icon/close_btn.png" alt="cancel"/>
                <div>취소</div>
              </button>

              <button
                type="button"
                className={`${styles.insertConfrimBtn} ${styles.btnBgBlue} ${!canSave || isSubmitting ? styles.btnDisabled : ""}`}
                onClick={handleSave}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className={styles.btnSpinner} />
                ) : (
                  <img src="/icon/check.png" alt="save" />
                )}
                <div>{isSubmitting ? "저장 중..." : "저장"}</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
