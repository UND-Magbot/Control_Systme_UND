"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PathCrudModal.module.css";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import type { RobotRowData, Floor } from "@/app/type";
import ResetUpdate from "./PathDeleteConfirmModal";
import PathAlertsModal from "./PathAlertsModal";

export type PathWorkType = "환자 모니터링" | "순찰/보안" | "물품/약품 운반";

export type PlaceRow = {
  id: number;
  robotNo: string;
  floor: string;
  placeName: string;
  x: number;
  y: number;
  updatedAt?: string;
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

  // ✅ 수정 모드일 때 초기값
  initial: PathRow | null;

  // ✅ 저장 시 상위로 전달
  onSubmit: (payload: Omit<PathRow, "id" | "updatedAt"> & { id?: number }) => void;
};

const WORK_TYPES: PathWorkType[] = ["환자 모니터링", "순찰/보안", "물품/약품 운반"];

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

type FixedScrollbarArgs = {
  enabled: boolean;
  scrollRef: React.RefObject<HTMLElement | null>;
  trackRef: React.RefObject<HTMLElement | null>;
  thumbRef: React.RefObject<HTMLElement | null>;
  thumbHeight?: number;
  deps?: any[];
};

const useFixedSelectScrollbar = ({
  enabled,
  scrollRef,
  trackRef,
  thumbRef,
  thumbHeight = 30,
  deps = [],
}: FixedScrollbarArgs) => {
  useEffect(() => {
    if (!enabled) return;

    const scrollEl = scrollRef.current;
    const trackEl = trackRef.current;
    const thumbEl = thumbRef.current;
    if (!scrollEl || !trackEl || !thumbEl) return;

    const resizeThumb = () => {
      const h = Math.min(thumbHeight, trackEl.clientHeight);
      thumbEl.style.height = `${h}px`;
      thumbEl.style.opacity =
        scrollEl.scrollHeight > scrollEl.clientHeight ? "1" : "0";
    };

    const syncThumb = () => {
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      const maxTop = trackEl.clientHeight - thumbEl.clientHeight;
      if (maxScroll <= 0) {
        thumbEl.style.top = "0px";
        return;
      }
      const ratio = scrollEl.scrollTop / maxScroll;
      thumbEl.style.top = `${ratio * maxTop}px`;
    };

    resizeThumb();
    syncThumb();

    scrollEl.addEventListener("scroll", syncThumb);
    window.addEventListener("resize", resizeThumb);

    const ro = new ResizeObserver(() => {
      resizeThumb();
      syncThumb();
    });
    ro.observe(scrollEl);
    ro.observe(trackEl);

    return () => {
      scrollEl.removeEventListener("scroll", syncThumb);
      window.removeEventListener("resize", resizeThumb);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, thumbHeight, ...deps]);
};

export default function PathCrudModal({
  isOpen,
  mode,
  onClose,
  placeRows,
  robots,
  floors,
  initial,
  onSubmit,
}: Props) {
  // ---------- 좌측 필터(로봇/층) ----------
  const [robotOpen, setRobotOpen] = useState(false);
  const [floorOpen, setFloorOpen] = useState(false);
  const robotWrapperRef = useRef<HTMLDivElement>(null);
  const floorWrapperRef = useRef<HTMLDivElement>(null);
  const robotSelectScrollRef = useRef<HTMLDivElement>(null);
  const robotSelectTrackRef = useRef<HTMLDivElement>(null);
  const robotSelectThumbRef = useRef<HTMLDivElement>(null);
  const floorSelectScrollRef = useRef<HTMLDivElement>(null);
  const floorSelectTrackRef = useRef<HTMLDivElement>(null);
  const floorSelectThumbRef = useRef<HTMLDivElement>(null);

  const [selectedRobot, setSelectedRobot] = useState<string | null>(null); // null=Total
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null); // null=Total

  // ---------- 우측 폼 ----------
  const [workTypeOpen, setWorkTypeOpen] = useState(false);
  const workTypeWrapperRef = useRef<HTMLDivElement>(null);

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

  // 초기값(수정 모드)
  useEffect(() => {
    if (!isOpen) return;

    // 필터/드롭다운 닫기
    setRobotOpen(false);
    setFloorOpen(false);
    setWorkTypeOpen(false);
    setActivePlaceId(null);

    if (mode === "edit" && initial) {
      const nextWorkType = (initial.workType as PathWorkType) ?? null;
      const nextPathName = initial.pathName ?? "";
      setWorkType(nextWorkType);
      setPathName(nextPathName);
      setSelectedRobot(initial.robotNo ?? null);

      // initial.pathOrder 문자열을 placeRows와 매칭해 복원(가능한 만큼)
      const names = (initial.pathOrder ?? "")
        .split(" - ")
        .map((s) => s.trim())
        .filter(Boolean);

      const mapped: PlaceRow[] = names.map((nm, idx) => {
        const found = placeRows.find((p) => p.placeName === nm);
        if (found) return found;
        return {
          id: -1 * (idx + 1),
          robotNo: initial.robotNo ?? "",
          floor: "",
          placeName: nm,
          x: 0,
          y: 0,
        };
      });

      setSelectedOrder(mapped);
      setInitialSnapshot({
        workType: nextWorkType,
        pathName: nextPathName,
        selectedOrder: mapped,
      });
    } else {
      // create
      setWorkType(null);
      setPathName("");
      // setSelectedOrder([]);
      setSelectedRobot(null);
      setSelectedFloor(null);
      setActivePlaceId(null);
      setInitialSnapshot(null);
    }
    setHadPlaces(placeRows.length > 0);
  }, [isOpen, mode, initial]);

  // 외부 클릭 닫기(기존 select 패턴 동일)
  useEffect(() => {
    if (!isOpen) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;

      if (robotWrapperRef.current && !robotWrapperRef.current.contains(t)) setRobotOpen(false);
      if (floorWrapperRef.current && !floorWrapperRef.current.contains(t)) setFloorOpen(false);
      if (workTypeWrapperRef.current && !workTypeWrapperRef.current.contains(t))
        setWorkTypeOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen]);

  const robotOptions = useMemo(() => Array.from(new Set(robots.map((r) => r.no))), [robots]);
  const floorOptions = useMemo(() => Array.from(new Set(floors.map((f) => f.label))), [floors]);
  const shouldShowRobotSelectScroll = robotOptions.length + 1 >= 5;
  const shouldShowFloorSelectScroll = floorOptions.length + 1 >= 5;

  const filteredPlaceRows = useMemo(() => {
    return placeRows.filter((p) => {
      const robotOk = !selectedRobot || p.robotNo === selectedRobot;
      const floorOk = !selectedFloor || p.floor === selectedFloor;
      return robotOk && floorOk;
    });
  }, [placeRows, selectedRobot, selectedFloor]);

  const shouldShowPlaceScroll = filteredPlaceRows.length > 8;

  useCustomScrollbar({
    enabled: isOpen && shouldShowPlaceScroll,
    scrollRef: placeScrollRef,
    trackRef: placeTrackRef,
    thumbRef: placeThumbRef,
    minThumbHeight: 50,
    deps: [filteredPlaceRows.length],
  });

  useFixedSelectScrollbar({
    enabled: isOpen && robotOpen && shouldShowRobotSelectScroll,
    scrollRef: robotSelectScrollRef,
    trackRef: robotSelectTrackRef,
    thumbRef: robotSelectThumbRef,
    thumbHeight: 30,
    deps: [robotOptions.length, robotOpen],
  });

  useFixedSelectScrollbar({
    enabled: isOpen && floorOpen && shouldShowFloorSelectScroll,
    scrollRef: floorSelectScrollRef,
    trackRef: floorSelectTrackRef,
    thumbRef: floorSelectThumbRef,
    thumbHeight: 30,
    deps: [floorOptions.length, floorOpen],
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
      const last = prev[prev.length - 1];
      if (last && last.id === row.id) {
        setAlertMessage("같은 장소는 연속으로 선택할 수 없습니다.");
        return prev;
      }
      if (prev.length >= 10) {
        setAlertMessage("경로 순서는 최대 10개까지 추가할 수 있습니다.");
        return prev;
      }
      return [...prev, row]; // ✅ 클릭 시 경로 순서에 “추가(append)”
    });
  };

  const removeOrderItem = (id: number) => {
    setSelectedOrder((prev) => prev.filter((p) => p.id !== id));
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
    // setSelectedOrder([]);
    setSelectedRobot(null);
    setSelectedFloor(null);
    setActivePlaceId(null);
  };

  const canSave =
    !!workType && pathName.trim().length > 0 && selectedOrder.length > 0;

  const handleSave = () => {
    if (!workType) {
      setAlertMessage("작업유형을 선택해 주세요.");
      return;
    }
    if (pathName.trim().length === 0) {
      setAlertMessage("경로명을 입력해 주세요.");
      return;
    }
    if (!canSave) return;

    // ✅ robotNo는 “경로 순서 1번” 기준으로 세팅(필요 시 정책 변경 가능)
    const robotNo = selectedOrder[0]?.robotNo ?? "";

    onSubmit({
      id: mode === "edit" && initial ? initial.id : undefined,
      robotNo,
      workType: workType!,
      pathName: pathName.trim(),
      pathOrder: selectedOrder.map((p) => p.placeName).join(" - "),
    });

    onClose();
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
        // setSelectedOrder([]);
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
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="close">
            <img src="/icon/close_btn.png" alt="" />
          </button>
        </div>

        <div className={styles.body}>
          {/* LEFT */}
          <div ref={leftPanelRef} className={styles.left}>
            <div className={styles.sectionTitle}>
              <span>1. 장소 선택</span>

              <div className={styles.filters}>
                {/* 로봇명 */}
                <div ref={robotWrapperRef} className={styles.selecteWrapper}>
                  {mode === "edit" ? (
                    <div className={`${styles.selecte} ${styles.selecteDisabled}`}>
                      <span>{initial?.robotNo ?? selectedRobot ?? "로봇명 선택"}</span>
                    </div>
                  ) : (
                    <>
                      <div className={styles.selecte} onClick={() => setRobotOpen((v) => !v)}>
                        <span>{selectedRobot ?? "로봇명 선택"}</span>
                        <img src={robotOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                      </div>
                      {robotOpen && (
                        <div className={styles.selectebox}>
                          <div ref={robotSelectScrollRef} className={styles.selecteInner} role="listbox">
                            <div
                              className={!selectedRobot ? styles.active : ""}
                              onClick={() => {
                                setSelectedRobot(null);
                                setRobotOpen(false);
                              }}
                            >
                              Total
                            </div>
                            {robotOptions.map((r) => (
                              <div
                                key={r}
                                className={selectedRobot === r ? styles.active : ""}
                                onClick={() => {
                                  setSelectedRobot(r);
                                  setRobotOpen(false);
                                }}
                              >
                                {r}
                              </div>
                            ))}
                          </div>
                          {shouldShowRobotSelectScroll && (
                            <div ref={robotSelectTrackRef} className={styles.selecteScrollTrack}>
                              <div ref={robotSelectThumbRef} className={styles.selecteScrollThumb} />
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* 층별 */}
                <div ref={floorWrapperRef} className={styles.selecteWrapper}>
                  <div className={styles.selecte} onClick={() => setFloorOpen((v) => !v)}>
                    <span>{selectedFloor ?? "층별 선택"}</span>
                    <img src={floorOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                  </div>
                  {floorOpen && (
                    <div className={styles.selectebox}>
                      <div ref={floorSelectScrollRef} className={styles.selecteInner} role="listbox">
                        <div
                          className={!selectedFloor ? styles.active : ""}
                          onClick={() => {
                            setSelectedFloor(null);
                            setFloorOpen(false);
                          }}
                        >
                          Total
                        </div>
                        {floorOptions.map((f) => (
                          <div
                            key={f}
                            className={selectedFloor === f ? styles.active : ""}
                            onClick={() => {
                              setSelectedFloor(f);
                              setFloorOpen(false);
                            }}
                          >
                            {f}
                          </div>
                        ))}
                      </div>
                      {shouldShowFloorSelectScroll && (
                        <div ref={floorSelectTrackRef} className={styles.selecteScrollTrack}>
                          <div ref={floorSelectThumbRef} className={styles.selecteScrollThumb} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>


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
                    장소 관리 화면에서 “장소 등록”을 먼저 진행해 주세요.
                  </div>
                </div>
              ) : (
                <div className={styles.placeBodyWrap}>
                  <div ref={placeScrollRef} className={styles.placeBody}>
                    {filteredPlaceRows.map((row) => {
                      const picked = activePlaceId === row.id;
                      return (
                        <div
                          key={row.id}
                          className={`${styles.placeRow} ${picked ? styles.placeRowPicked : ""}`}
                          onClick={() => togglePickPlace(row)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className={styles.pickDot}>
                            <span className={`${styles.dot} ${picked ? styles.dotOn : ""}`} />
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

          {/* RIGHT */}
          <div
            className={`${styles.right} ${isPathOrderDisabled ? styles.rightDisabled : ""}`}
            style={rightPanelHeight ? { height: rightPanelHeight } : undefined}
          >
            <div className={styles.sectionTitle}>
              <span>2. 경로 순서</span>
              <button
                type="button"
                className={styles.resetBtn}
                onClick={() => setPathResetConfirmOpen(true)}
                aria-label="reset"
              >
                <img src="/icon/data_update.png" alt="" />
              </button>
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
              <div ref={workTypeWrapperRef} className={styles.selecteWrapperWide}>
                <div className={styles.selecteWide} onClick={() => setWorkTypeOpen((v) => !v)}>
                  <span>{workType ?? "작업유형을 선택하세요"}</span>
                  <img src={workTypeOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                </div>
                {workTypeOpen && (
                  <div className={styles.selecteboxWide}>
                    {WORK_TYPES.map((t) => (
                      <div
                        key={t}
                        className={workType === t ? styles.active : ""}
                        onClick={() => {
                          setWorkType(t);
                          setWorkTypeOpen(false);
                        }}
                      >
                        {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                            onClick={() => removeOrderItem(p.id)}
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
            </div>

            <div className={styles.divider} />

            {/* 하단 버튼 */}
            <div className={styles.insertBtnTotal}>
              <button type="button" className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`} onClick={onClose}>
                <img src="/icon/close_btn.png" alt="cancel"/>
                <div>취소</div>
              </button>

              <button
                type="button"
                className={`${styles.insertConfrimBtn} ${styles.btnBgBlue}`}
                onClick={handleSave}
              >
                <img src="/icon/check.png" alt="save" />
                <div>저장</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
