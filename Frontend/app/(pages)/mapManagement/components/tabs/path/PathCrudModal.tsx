"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PathCrudModal.module.css";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import type { RobotRowData, Floor } from "@/app/types";
import ResetUpdate from "./PathDeleteConfirmModal";
import PathAlertsModal from "./PathAlertsModal";
import PathStopOptionsModal, {
  type StopAction,
  type AnnouncementOption,
} from "./PathStopOptionsModal";
import { apiFetch } from "@/app/lib/api";
import PathMapView from "./PathMapView";
import FilterSelectBox, { type FilterOption } from "@/app/components/button/FilterSelectBox";
import { Route, Waypoints } from "lucide-react";
import { WORK_TYPES, resolveTaskTypeLabel } from "@/app/lib/taskType";

// 작업 유형 값은 표준 라벨 문자열(길 안내/물품 운반/순찰·점검). @/app/lib/taskType 참조.
export type PathWorkType = string;

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
  waitSeconds?: number[];
  stopActions?: (StopAction | null)[]; // 경유지 도착 상호작용 (정차 지점과 병렬)
  updatedAt: string;
};

type SelectedStop = PlaceRow & { waitSeconds?: number; stopAction?: StopAction | null };

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

function restorePathOrder(initial: PathRow, placeRows: PlaceRow[]) {
  const raw = initial.pathOrder ?? "";
  const names = raw
    .split(" - ")
    .map((s) => s.trim())
    .filter(Boolean);
  const waits = initial.waitSeconds ?? [];
  const actions = initial.stopActions ?? [];

  const valid: SelectedStop[] = [];
  const missing: string[] = [];

  for (let i = 0; i < names.length; i++) {
    const found = placeRows.find((p) => p.placeName === names[i]);
    if (found) {
      const w = waits[i];
      valid.push({
        ...found,
        waitSeconds: typeof w === "number" && w >= 0 ? Math.floor(w) : 0,
        stopAction: actions[i] ?? null,
      });
    } else {
      missing.push(names[i]);
    }
  }

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
    selectedOrder: SelectedStop[];
  } | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);



  // ---------- 경로 순서(선택된 장소들) ----------
  const [selectedOrder, setSelectedOrder] = useState<SelectedStop[]>([]);
  const [activePlaceId, setActivePlaceId] = useState<number | null>(null);
  const [optionsModalIdx, setOptionsModalIdx] = useState<number | null>(null);
  // 도착 발화 후보 — 선택된 로봇의 안내 멘트(사용 중인 것)
  const [announcements, setAnnouncements] = useState<AnnouncementOption[]>([]);
  // 확인 인식어 — 멘트를 쓰는 화면에서 '무슨 말이 통과인지'를 보여줘야
  // '이동하자고 말씀해주세요' 같은 어긋남이 안 생긴다.
  const [confirmWords, setConfirmWords] = useState<string[]>([]);
  const [voiceRobotId, setVoiceRobotId] = useState<number | null>(null);
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
      const nextWorkType = resolveTaskTypeLabel(initial.workType) || null;
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

    const nextWorkType = resolveTaskTypeLabel(initial.workType) || null;
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
    () => WORK_TYPES.map((t) => ({ id: t.label, label: t.label })),
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
      return [...prev, { ...row, waitSeconds: 0 }]; // ✅ 클릭 시 경로 순서에 "추가(append)"
    });
  };

  // 선택된 로봇(robotNo)의 안내 멘트를 가져온다. 로봇이 없거나 목록이 없어도 경로 편집은 정상.
  useEffect(() => {
    const rid = robots.find((r) => r.no === selectedRobot)?.id;
    setVoiceRobotId(rid ?? null);
    if (!rid) {
      setAnnouncements([]);
      setConfirmWords([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch(`/DB/robots/${rid}/voice-announcements`);
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        setAnnouncements(
          (data.items ?? [])
            .filter((a: { isActive: boolean }) => a.isActive)
            .map((a: { id: number; label: string; text: string }) => ({
              id: a.id,
              label: a.label,
              text: a.text,
            }))
        );
      } catch {
        /* 안내 멘트를 못 불러와도 정지 옵션은 '없음'으로 쓸 수 있다 */
      }
      try {
        const res = await apiFetch(`/DB/robots/${rid}/voice-confirm-words`);
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        // 등록이 없으면 서버가 기본으로 판정한다 → 화면도 기본을 보여준다
        const items = (data.items ?? []).filter((w: { isActive: boolean }) => w.isActive);
        setConfirmWords(items.length ? items.map((w: { word: string }) => w.word) : (data.defaults ?? []));
      } catch {
        /* 인식어를 못 불러와도 설정은 저장할 수 있다 — 안내만 비워진다 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedRobot, robots]);

  const applyStopOptions = (waitSeconds: number, stopAction: StopAction) => {
    setSelectedOrder((prev) => {
      if (optionsModalIdx == null) return prev;
      const next = [...prev];
      next[optionsModalIdx] = { ...next[optionsModalIdx], waitSeconds, stopAction };
      return next;
    });
    setOptionsModalIdx(null);
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
      selectedOrder.some(
        (p, i) =>
          p.id !== initialSnapshot.selectedOrder[i]?.id ||
          (p.waitSeconds ?? 0) !== (initialSnapshot.selectedOrder[i]?.waitSeconds ?? 0)
      )
    );
  }, [mode, workType, pathName, selectedOrder, initialSnapshot]);

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  };

  // A-01: Esc로 닫기. 하위 다이얼로그(정차옵션·초기화·닫기확인·알림)가 열려 있으면 그쪽이 우선이라 무시.
  // 미저장 변경은 handleClose가 확인 모달로 방어. ref로 최신 handleClose 참조(스테일 방지).
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (optionsModalIdx != null || isCloseConfirmOpen || isPathResetConfirmOpen || alertMessage) return;
      handleCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, optionsModalIdx, isCloseConfirmOpen, isPathResetConfirmOpen, alertMessage]);

  const canSave =
    !!workType && pathName.trim().length > 0 && selectedOrder.length >= 2;

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
    if (selectedOrder.length < 2) {
      // E-03: 이동 구간이 없는 1개짜리 경로는 무의미(미리보기 navPath=null)하므로 2개 이상 요구.
      setAlertMessage("경로는 출발/도착을 포함해 2개 이상의 경유지가 필요합니다.");
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
      const waitSeconds = selectedOrder.map((p) => Math.max(0, Math.floor(p.waitSeconds ?? 0)));
      const stopActions = selectedOrder.map((p) => p.stopAction ?? null);
      await onSubmit({
        id: mode === "edit" && initial ? initial.id : undefined,
        robotNo,
        workType: workType!,
        pathName: pathName.trim(),
        pathOrder: selectedOrder.map((p) => p.placeName).join(" - "),
        waitSeconds,
        stopActions,
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
        // 장소가 늦게 로드된 경우 스냅샷으로 재적용.
        setWorkType(initialSnapshot.workType);
        setPathName(initialSnapshot.pathName);
        setSelectedOrder(initialSnapshot.selectedOrder);
        setActivePlaceId(null);
      } else if (mode === "create") {
        // create 모드에서만 초기화. edit 모드는 Effect 1/2가 복원을 담당하므로
        // 여기서 비우면(같은 커밋에서 initialSnapshot이 아직 null이라) 복원된 순서를 지워버림.
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
    <div className={styles.backdrop} role="dialog" aria-modal="true" onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Route size={20} className={styles.headerIcon} />
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
                  width={170}
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

          <PathStopOptionsModal
            isOpen={optionsModalIdx != null}
            placeName={
              optionsModalIdx != null ? selectedOrder[optionsModalIdx]?.placeName ?? "" : ""
            }
            initialWaitSeconds={
              optionsModalIdx != null ? selectedOrder[optionsModalIdx]?.waitSeconds ?? 0 : 0
            }
            enableInteraction
            initialStopAction={
              optionsModalIdx != null ? selectedOrder[optionsModalIdx]?.stopAction ?? null : null
            }
            announcements={announcements}
            confirmWords={confirmWords}
            voiceRobotId={voiceRobotId}
            onCancel={() => setOptionsModalIdx(null)}
            onConfirm={applyStopOptions}
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
                placeholder="경로명 (최대 8자)"
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
                            className={styles.orderOptions}
                            onClick={() => setOptionsModalIdx(idx)}
                            aria-label="옵션"
                            title="도착 지점 정지·안내 설정"
                          >
                            <span className={styles.optionsCircle}>+</span>
                          </button>

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
                            {p.waitSeconds != null && p.waitSeconds > 0 && (
                              <>
                                <div className={styles.metaSep} />
                                <div className={styles.waitBadge}>대기 {p.waitSeconds}s</div>
                              </>
                            )}
                            {p.stopAction?.announceId != null && (
                              <>
                                <div className={styles.metaSep} />
                                <div className={styles.sayBadge}>안내</div>
                              </>
                            )}
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
                          <Waypoints size={12} />
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
