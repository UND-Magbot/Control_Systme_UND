"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import styles from "./PlaceCrudModal.module.css";
import type { RobotRowData } from "@/app/type";
import { CanvasMap } from "@/app/components/map";
import type { CanvasMapHandle } from "@/app/components/map";
import { TEST_MAP_CONFIG } from "@/app/components/map/mapConfigs";
import { useRobotPosition } from "@/app/hooks/useRobotPosition";
import PathAlertsModal from "./PathAlertsModal";
import PlaceDeleteConfirmModal from "./PlaceDeleteConfirmModal";
import type { PlaceRow } from "@/app/mock/robotPlace_data";
import type { POIItem } from "@/app/components/map/types";
import DropdownSelect from "@/app/components/button/DropdownSelect";
import ZoomControl from "@/app/components/button/ZoomControl";
import { getApiBase } from "@/app/config";

export type PlaceRowData = {
  id: number;
  robotNo: string;
  floor: string;
  name: string;
  x: string;
  y: string;
  direction: string;
  desc: string;
  updatedAt: string;
};

type Mode = "create" | "edit";

type DBRobot = {
  id: number;
  RobotName: string;
};

type Props = {
  isOpen: boolean;
  mode: Mode;
  robots: RobotRowData[];
  floors?: string[];
  initial?: PlaceRowData | null;
  existingPlaces?: PlaceRow[];
  onClose: () => void;
  onSubmit: (payload: PlaceRowData) => void;
};

const DEFAULT_FLOORS = ["B1", "1F", "2F", "3F", "4F"];

export default function PlaceCrudModal({
  isOpen,
  mode,
  robots,
  floors = DEFAULT_FLOORS,
  initial = null,
  existingPlaces = [],
  onClose,
  onSubmit,
}: Props) {
  const isEdit = mode === "edit";

  const mapRef = useRef<CanvasMapHandle>(null);
  const dirWheelRef = useRef<HTMLDivElement>(null);

  const [dbRobots, setDbRobots] = useState<DBRobot[]>([]);

  // form state
  const [robotNo, setRobotNo] = useState<string>("");
  const [floor, setFloor] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [x, setX] = useState<string>("");
  const [y, setY] = useState<string>("");
  const [direction, setDirection] = useState<string>("");
  const [desc, setDesc] = useState<string>("");
  const [isPinMode, setIsPinMode] = useState(false);
  const [pinPlaced, setPinPlaced] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCloseConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [saveSuccessOpen, setSaveSuccessOpen] = useState(false);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    robotNo?: string;
    floor?: string;
    name?: string;
    coordinates?: string;
    direction?: string;
  }>({});

  const nowText = useMemo(() => {
    const d = new Date();
    const yr = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hours = d.getHours();
    const ampm = hours < 12 ? "오전" : "오후";
    const hh = String(hours % 12 === 0 ? 12 : hours % 12).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yr}.${m}.${dd} ${ampm} ${hh}:${mm}:${ss}`;
  }, []);

  const [floorDirty, setFloorDirty] = useState(false);
  const [xDirty, setXDirty] = useState(false);
  const [yDirty, setYDirty] = useState(false);

  // 실시간 로봇 위치
  const { position: liveRobotPos, isReady: robotPosReady } = useRobotPosition(isOpen);

  // create 모드: 로봇+층 선택 완료 시 핀 모드 자동 활성화
  useEffect(() => {
    if (mode !== "create") return;
    if (!robotNo || !floor) return;
    if (pinPlaced || x || y) return; // 이미 좌표 설정됨
    setIsPinMode(true);
  }, [robotNo, floor, mode, pinPlaced, x, y]);

  // DB 로봇 목록 fetch
  const [robotFetchError, setRobotFetchError] = useState(false);
  const fetchRobots = useCallback(() => {
    setRobotFetchError(false);
    fetch(`${getApiBase()}/DB/robots`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setDbRobots(data))
      .catch((err) => {
        console.error("로봇 목록 DB 조회 실패", err);
        setRobotFetchError(true);
        setAlertMessage("로봇 목록을 불러오지 못했습니다.");
      });
  }, []);
  useEffect(() => {
    if (!isOpen) return;
    fetchRobots();
  }, [isOpen, fetchRobots]);

  // open/close lifecycle
  useEffect(() => {
    if (!isOpen) return;

    if (initial) {
      setRobotNo(initial.robotNo ?? "");
      setFloor(initial.floor ?? "");
      setName(initial.name ?? "");
      setX(initial.x ?? "");
      setY(initial.y ?? "");
      setDirection(initial.direction ?? "");
      setDesc(initial.desc ?? "");
      setPinPlaced(!!(initial.x && initial.y));
    } else {
      setRobotNo("");
      setFloor("");
      setName("");
      setX("");
      setY("");
      setDirection("");
      setDesc("");
      setPinPlaced(false);
    }
    setIsPinMode(false);
    setFieldErrors({});
    setSaveSuccessOpen(false);

    const isEditOpen = mode === "edit" && !!initial;
    setFloorDirty(isEditOpen);
    setXDirty(isEditOpen);
    setYDirty(isEditOpen);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initial, mode]);

  // Enter 키 저장 단축키
  useEffect(() => {
    if (!isOpen) return;
    const onEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "textarea") return; // textarea에서는 줄바꿈
      if (isSubmitting) return;
      if (!canSave) return;
      e.preventDefault();
      submit();
    };
    document.addEventListener("keydown", onEnter);
    return () => document.removeEventListener("keydown", onEnter);
  }, [isOpen, isSubmitting, robotNo, floor, name, x, y, direction]);

  // 미저장 변경사항 감지
  const hasUnsavedChanges = useMemo(() => {
    if (isEdit && initial) {
      return (
        robotNo !== (initial.robotNo ?? "") ||
        floor !== (initial.floor ?? "") ||
        name !== (initial.name ?? "") ||
        x !== (initial.x ?? "") ||
        y !== (initial.y ?? "") ||
        direction !== (initial.direction ?? "") ||
        desc !== (initial.desc ?? "")
      );
    }
    return !!(robotNo || floor || name || x || y || direction || desc);
  }, [isEdit, initial, robotNo, floor, name, x, y, direction, desc]);

  const handleClose = () => {
    if (isSubmitting) return;
    if (hasUnsavedChanges) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  };

  useModalBehavior({ isOpen, onClose: handleClose, disabled: isSubmitting });

  // 필수 필드 실시간 검증
  const canSave = !!(robotNo && floor && name.trim() && x && y && (direction || direction === "0"));

  // 장소명 실시간 중복 검사
  const nameDuplicateMsg = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed || !robotNo || !floor) return "";
    const isDuplicate = existingPlaces.some(
      (p) =>
        p.robotNo === robotNo &&
        p.floor === floor &&
        p.placeName.toLowerCase() === trimmed.toLowerCase() &&
        p.id !== initial?.id
    );
    return isDuplicate ? "동일한 로봇/층에 같은 장소명이 이미 존재합니다." : "";
  }, [name, robotNo, floor, existingPlaces, initial?.id]);

  // blur 검증 핸들러
  const validateFieldOnBlur = (field: string) => {
    switch (field) {
      case "name":
        if (!name.trim()) {
          setFieldErrors((prev) => ({ ...prev, name: "장소명을 입력해 주세요." }));
        } else if (nameDuplicateMsg) {
          setFieldErrors((prev) => ({ ...prev, name: nameDuplicateMsg }));
        }
        break;
    }
  };

  const submit = async () => {
    // 필드별 에러 수집
    const errors: typeof fieldErrors = {};
    if (!robotNo) errors.robotNo = "로봇명을 선택해 주세요.";
    if (!floor) errors.floor = "층을 선택해 주세요.";
    if (!name.trim()) errors.name = "장소명을 입력해 주세요.";
    else if (nameDuplicateMsg) errors.name = nameDuplicateMsg;
    if (!x || !y) errors.coordinates = "지도에서 장소 좌표를 선택해 주세요.";
    else if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) errors.coordinates = "좌표값이 올바르지 않습니다.";
    if (!direction && direction !== "0") errors.direction = "방향을 입력해 주세요.";
    else {
      const dirNum = Number(direction);
      if (!Number.isFinite(dirNum) || dirNum < 0 || dirNum > 360) errors.direction = "방향은 0~360 범위여야 합니다.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const dbPayload = {
      RobotName: robotNo,
      LacationName: name.trim(),
      Floor: floor,
      LocationX: Number(x),
      LocationY: Number(y),
      LocationDir: Number(direction),
      Imformation: desc || null,
    };

    setIsSubmitting(true);
    try {
      const isEditMode = mode === "edit" && initial?.id;
      const url = isEditMode
        ? `${getApiBase()}/DB/places/${initial.id}`
        : `${getApiBase()}/DB/places`;
      const method = isEditMode ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dbPayload),
      });

      if (!res.ok) {
        const status = res.status;
        if (status === 400) throw new Error("입력값이 올바르지 않습니다.");
        if (status === 409) throw new Error("동일한 장소가 이미 존재합니다.");
        if (status === 401 || status === 403) throw new Error("권한이 없습니다. 관리자에게 문의하세요.");
        if (status >= 500) throw new Error("서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        throw new Error(isEditMode ? "DB 수정 실패" : "DB 저장 실패");
      }

      const saved = await res.json();

      onSubmit({
        id: saved.id ?? initial?.id,
        robotNo,
        name: name.trim(),
        floor,
        x,
        y,
        direction,
        desc,
        updatedAt: nowText,
      });

      setSaveSuccessOpen(true);
    } catch (err) {
      console.error(err);
      const message = err instanceof TypeError
        ? "네트워크 연결을 확인해 주세요."
        : err instanceof Error
          ? err.message
          : "장소 저장 중 오류가 발생했습니다.";
      setAlertMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // CanvasMap의 worldToPixelScreen으로 핀 위치 계산
  const pinScreenPos = useMemo(() => {
    const px = Number(x);
    const py = Number(y);
    if (Number.isNaN(px) || Number.isNaN(py)) return null;
    if (!mapRef.current) return null;

    const pos = mapRef.current.worldToPixelScreen(px, py);
    return {
      left: `${pos.x}px`,
      top: `${pos.y}px`,
    } as React.CSSProperties;
  }, [x, y]);

  // 맵 클릭 → world 좌표로 핀 배치
  const handleMapClick = (worldCoords: { x: number; y: number }) => {
    if (!isPinMode || isSubmitting) return;
    setXDirty(true);
    setYDirty(true);
    setX(worldCoords.x.toFixed(3));
    setY(worldCoords.y.toFixed(3));
    setPinPlaced(true);
    setIsPinMode(false); // 핀 배치 후 자동 해제
    setFieldErrors((prev) => ({ ...prev, coordinates: undefined }));
  };

  // 좌표 초기화
  const handleCoordReset = () => {
    setX("");
    setY("");
    setPinPlaced(false);
    setXDirty(false);
    setYDirty(false);
    setIsPinMode(true); // 핀 모드 자동 활성화
    setFieldErrors((prev) => ({ ...prev, coordinates: undefined }));
  };

  const handleDirectionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "" || val === "-") { setDirection(val); return; }
    const num = Number(val);
    if (num < 0) setDirection("0");
    else if (num > 360) setDirection("360");
    else setDirection(val);
  };

  const handleDirectionBlur = () => {
    if (direction === "" || direction === "-") {
      if (direction === "-") setDirection("");
      if (!direction) {
        setFieldErrors((prev) => ({ ...prev, direction: "방향을 입력해 주세요." }));
      }
      return;
    }
    const num = Number(direction);
    if (isNaN(num)) { setDirection(""); return; }
    const clamped = Math.max(0, Math.min(360, Math.round(num)));
    setDirection(String(clamped));
    setFieldErrors((prev) => ({ ...prev, direction: undefined }));
  };

  // 방향 인디케이터 클릭으로 방향 설정
  const handleDirectionWheelClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    const rounded = Math.round(angle);
    setDirection(String(rounded));
    setFieldErrors((prev) => ({ ...prev, direction: undefined }));
  };

  const title = isEdit ? "장소 수정" : "장소 등록";

  // 로봇 위치 (latestRobotPose 기반)
  const robotPosForMap = robotPosReady ? liveRobotPos : null;

  // 지도 위 기존 장소 POI 표시 (동일 로봇+층)
  const mapPois: POIItem[] = useMemo(() => {
    if (!robotNo || !floor) return [];
    return existingPlaces
      .filter((p) => p.robotNo === robotNo && p.floor === floor && p.id !== initial?.id)
      .map((p) => ({ id: p.id, name: p.placeName, x: p.x, y: p.y, floor: p.floor }));
  }, [robotNo, floor, existingPlaces, initial?.id]);

  // 마우스 호버 좌표 핸들러
  const handleMapMouseMove = useCallback((coords: { x: number; y: number }) => {
    setHoverCoords(coords);
  }, []);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <img src="/icon/robot_place_w.png" alt="" />
            <h2>{title}</h2>
          </div>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="close">
            ✕
          </button>
        </div>

        {/* ─── 2패널 본문 ─── */}
        <div className={styles.modalBody}>
          {/* ─── 좌측: 폼 패널 ─── */}
          <div className={styles.formPanel}>
            {/* 기본 정보 섹션 */}
            <div className={styles.sectionGroup}>
              <div className={styles.sectionTitle}>기본 정보<span className={styles.sectionTitleLine} /></div>

              {/* 로봇명 */}
              <div className={styles.row}>
                <div className={`${styles.label} ${styles.required}`}>로봇명</div>
                <div className={styles.selectWrap}>
                  <DropdownSelect<DBRobot>
                    placeholder="로봇명을 선택하세요"
                    value={dbRobots.find((r) => r.RobotName === robotNo) ?? null}
                    options={dbRobots}
                    getLabel={(r) => r.RobotName}
                    getKey={(r) => r.id}
                    onChange={(r) => {
                      setRobotNo(r.RobotName);
                      setFloorDirty(false);
                      setXDirty(false);
                      setYDirty(false);
                      setFieldErrors((prev) => ({ ...prev, robotNo: undefined }));
                    }}
                    disabled={isEdit}
                    emptyMessage={
                      robotFetchError ? (
                        <>불러오기 실패 <span className={styles.retryLink} onClick={fetchRobots}>다시 시도</span></>
                      ) : "등록된 로봇이 없습니다"
                    }
                    className={styles.modalSelect}
                  />
                  {isEdit && <div className={styles.fieldHint}>수정 모드에서는 변경할 수 없습니다</div>}
                  {fieldErrors.robotNo && <div className={styles.fieldError}>{fieldErrors.robotNo}</div>}
                </div>
              </div>

              {/* 층별 */}
              <div className={styles.row}>
                <div className={`${styles.label} ${styles.required}`}>층</div>
                <div className={styles.selectWrap}>
                  <DropdownSelect<string>
                    placeholder="층을 선택하세요"
                    value={floor || null}
                    options={floors}
                    getLabel={(f) => f}
                    getKey={(f) => f}
                    onChange={(f) => {
                      setFloor(f);
                      setFloorDirty(true);
                      setFieldErrors((prev) => ({ ...prev, floor: undefined }));
                    }}
                    className={styles.modalSelect}
                  />
                  {fieldErrors.floor && <div className={styles.fieldError}>{fieldErrors.floor}</div>}
                </div>
              </div>

              {/* 장소명 */}
              <div className={styles.row}>
                <div className={`${styles.label} ${styles.required}`}>장소명</div>
                <div className={styles.inputWrap}>
                  <input
                    className={`${styles.input} ${styles.edit} ${fieldErrors.name || nameDuplicateMsg ? styles.inputError : ""}`}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                    onBlur={() => validateFieldOnBlur("name")}
                    placeholder="50자(100byte) 이내로 작성하세요"
                    maxLength={50}
                  />
                  <div className={`${styles.charCounter} ${name.length >= 40 ? styles.charCounterWarn : ""}`}>
                    {name.length}/50
                  </div>
                  {fieldErrors.name && <div className={styles.fieldError}>{fieldErrors.name}</div>}
                  {!fieldErrors.name && nameDuplicateMsg && <div className={styles.fieldError}>{nameDuplicateMsg}</div>}
                </div>
              </div>
            </div>

            {/* 위치 정보 섹션 */}
            <div className={styles.sectionGroup}>
              <div className={styles.sectionTitle}>
                위치 정보
                <span className={styles.sectionTitleLine} />
                {(x && y) && (
                  <button
                    type="button"
                    className={styles.coordResetBtn}
                    onClick={handleCoordReset}
                  >
                    좌표 초기화
                  </button>
                )}
              </div>

              {/* 장소좌표 X, Y */}
              <div className={`${styles.row} ${styles.rowAlignTop}`}>
                <div className={`${styles.label} ${styles.required}`}>좌표</div>
                <div className={styles.xyBoxInline}>
                  <div className={styles.xyInlineItem}>
                    <div className={styles.xyLabel}>X</div>
                    <input
                      className={`${styles.xyInput} ${styles.edit} ${x ? styles.xyInputFilled : styles.xyInputEmpty}`}
                      value={x}
                      readOnly
                      tabIndex={-1}
                      placeholder="지도에서 선택"
                    />
                  </div>
                  <div className={styles.xyInlineItem}>
                    <div className={styles.xyLabel}>Y</div>
                    <input
                      className={`${styles.xyInput} ${styles.edit} ${y ? styles.xyInputFilled : styles.xyInputEmpty}`}
                      value={y}
                      readOnly
                      tabIndex={-1}
                      placeholder="지도에서 선택"
                    />
                  </div>
                </div>
              </div>
              {(fieldErrors.coordinates) && (
                <div className={styles.xyErrorRow}>
                  <div className={styles.fieldError}>{fieldErrors.coordinates}</div>
                </div>
              )}

              {/* 방향 */}
              <div className={styles.directionRow}>
                <div className={`${styles.label} ${styles.required}`}>방향(°)</div>
                <div className={styles.directionInputWrap}>
                  <input
                    className={`${styles.xyInput} ${styles.edit} ${direction ? styles.xyInputFilled : styles.xyInputEmpty}`}
                    value={direction}
                    onChange={handleDirectionChange}
                    onBlur={handleDirectionBlur}
                    placeholder="0~360"
                    type="number"
                    min={0}
                    max={360}
                  />
                  <div
                    ref={dirWheelRef}
                    className={styles.directionIndicator}
                    onClick={handleDirectionWheelClick}
                    title="클릭하여 방향 설정"
                    role="button"
                    aria-label="방향 설정 휠"
                  >
                    {(direction || direction === "0") && (
                      <div
                        className={styles.directionArrow}
                        style={{ transform: `rotate(${Number(direction)}deg)` }}
                      />
                    )}
                  </div>
                </div>
              </div>
              {fieldErrors.direction && (
                <div className={styles.xyErrorRow}>
                  <div className={styles.fieldError}>{fieldErrors.direction}</div>
                </div>
              )}
            </div>

            {/* 장소설명 */}
            <div className={styles.sectionGroup}>
              <div className={`${styles.row} ${styles.rowTextArea}`} style={{ marginBottom: 0 }}>
                <div className={styles.label}>장소설명</div>
                <div className={styles.textareaWrap}>
                  <textarea
                    className={`${styles.textarea} ${styles.edit}`}
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="100자(200byte) 이내로 작성하세요"
                    maxLength={100}
                  />
                  <div className={`${styles.charCounter} ${desc.length >= 90 ? styles.charCounterWarn : ""}`}>
                    {desc.length}/100
                  </div>
                </div>
              </div>

              {isEdit && (
                <div className={styles.updateRow}>
                  <div className={styles.label}>수정일시</div>
                  <div className={styles.updatedAtValue}>
                    {initial?.updatedAt ?? nowText}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ─── 우측: 맵 패널 ─── */}
          <div className={styles.mapPanel}>
            {/* 맵 툴바 */}
            <div className={styles.mapToolbar}>
              <div className={styles.mapToolbarLeft}>
                <span className={styles.mapToolbarLabel}>지도</span>
                <div className={styles.floorChip}>{floor || "1F"}</div>
              </div>
              <div className={styles.mapToolbarRight}>
                <div
                  className={`${styles.pinBtn} ${isPinMode ? styles.pinBtnActive : ""}`}
                  title="좌표 선택"
                  onClick={() => setIsPinMode((v) => !v)}
                  role="button"
                  aria-pressed={isPinMode}
                >
                  <img src="/icon/place_point.png" alt="" />
                </div>
              </div>
            </div>

            {/* 맵 캔버스 */}
            <div className={`${styles.mapContainer} ${isPinMode ? styles.mapBoxPinActive : ""}`}>
              <div className={styles.mapBox}>
                {isPinMode && (
                  <div className={styles.pinBanner}>지도를 클릭하여 장소 좌표를 선택하세요</div>
                )}

                <CanvasMap
                  ref={mapRef}
                  config={TEST_MAP_CONFIG}
                  robotPos={robotPosForMap}
                  showRobot={robotPosReady}
                  pois={mapPois}
                  showPois={mapPois.length > 0}
                  selectedPoiId={isEdit ? initial?.id : undefined}
                  onMapClick={isPinMode ? handleMapClick : undefined}
                  onMapMouseMove={isPinMode ? handleMapMouseMove : undefined}
                  style={{ cursor: isPinMode ? "crosshair" : undefined }}
                >
                  {pinPlaced && pinScreenPos && (
                    <img
                      src="/icon/place_point.png"
                      alt=""
                      className={styles.pinMarker}
                      style={{
                        ...pinScreenPos,
                        transform: "translate(-50%, -100%)",
                      }}
                    />
                  )}
                </CanvasMap>

                {isPinMode && hoverCoords && (
                  <div className={styles.coordPreview}>
                    X: {hoverCoords.x.toFixed(3)}, Y: {hoverCoords.y.toFixed(3)}
                  </div>
                )}

                <div className={styles.mapBottomRight}>
                  <ZoomControl onClick={(action) => mapRef.current?.handleZoom(action)} />
                </div>
              </div>
            </div>

            {/* 좌표 상태바 */}
            <div className={styles.coordStatusBar}>
              <div className={styles.coordStatusItem}>
                <span className={styles.coordStatusLabel}>X</span>
                <span className={x ? styles.coordStatusValue : styles.coordStatusEmpty}>
                  {x || "미선택"}
                </span>
              </div>
              <div className={styles.coordStatusItem}>
                <span className={styles.coordStatusLabel}>Y</span>
                <span className={y ? styles.coordStatusValue : styles.coordStatusEmpty}>
                  {y || "미선택"}
                </span>
              </div>
              <div className={styles.coordStatusItem}>
                <span className={styles.coordStatusLabel}>D</span>
                <span className={(direction || direction === "0") ? styles.coordStatusValue : styles.coordStatusEmpty}>
                  {(direction || direction === "0") ? `${direction}°` : "미입력"}
                </span>
              </div>
            </div>

            <div className={styles.mapHint}>
              *우측 상단 핀 버튼으로 좌표 선택 모드를 켜거나 끌 수 있습니다.
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className={styles.footer}>
          <button className={`${styles.footerBtn} ${styles.btnRed}`} onClick={handleClose} disabled={isSubmitting}>
            <img src="/icon/close_btn.png" alt="" />
            취소
          </button>
          <button
            className={`${styles.footerBtn} ${styles.btnBlue}`}
            onClick={submit}
            disabled={!canSave || isSubmitting}
            title={!canSave ? "모든 필수 항목을 입력해 주세요." : undefined}
          >
            {isSubmitting ? (
              <>
                <div className={styles.btnSpinner} />
                저장 중...
              </>
            ) : (
              <>
                <img src="/icon/check.png" alt="" />
                저장
              </>
            )}
          </button>
        </div>
      </div>

      {alertMessage && (
        <PathAlertsModal
          isOpen={!!alertMessage}
          message={alertMessage}
          onCancel={() => setAlertMessage(null)}
          onConfirm={() => setAlertMessage(null)}
        />
      )}

      <PlaceDeleteConfirmModal
        isOpen={isCloseConfirmOpen}
        message="변경사항이 저장되지 않습니다. 닫으시겠습니까?"
        onCancel={() => setCloseConfirmOpen(false)}
        onConfirm={() => {
          setCloseConfirmOpen(false);
          onClose();
        }}
      />

      {saveSuccessOpen && (
        <PathAlertsModal
          isOpen={saveSuccessOpen}
          message={isEdit ? "장소가 수정되었습니다." : "장소가 등록되었습니다."}
          onCancel={() => { setSaveSuccessOpen(false); onClose(); }}
          onConfirm={() => { setSaveSuccessOpen(false); onClose(); }}
        />
      )}
    </div>
  );
}
