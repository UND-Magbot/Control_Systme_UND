"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalBehavior } from "@/app/hooks/useModalBehavior";
import styles from "./MapPlaceCreateModal.module.css";
import DropdownSelect from "@/app/components/button/DropdownSelect";

import { API_BASE } from "@/app/config";

type DBRobot = { id: number; RobotName: string };

export type PlaceEditData = {
  key: string;
  name: string;
  robotName: string;
  floor: string;
  x: number;
  y: number;
  yaw: number;
  desc: string;
  mapId: number | null;
};

type Props = {
  isOpen: boolean;
  mode: "create" | "edit";
  /** 맵 클릭으로 얻은 월드 좌표 (create 모드) */
  worldX: number;
  worldY: number;
  /** 맵 이미지 상의 픽셀 좌표 */
  pixelX: number;
  pixelY: number;
  /** 연결된 robot_map_info.id */
  mapId?: number;
  /** 자동 선택할 로봇 이름 (연결된 로봇) */
  defaultRobotName?: string;
  /** 자동 선택할 층 이름 */
  defaultFloor?: string;
  /** 수정 모드 시 기존 데이터 */
  editData?: PlaceEditData | null;
  /** 로봇 현 위치에서 생성 시 좌표/방향 고정 */
  lockCoords?: boolean;
  /** 로봇 yaw (라디안) — lockCoords=true 시 방향 자동 세팅 */
  defaultYaw?: number;
  onClose: () => void;
  onConfirm: (place: PendingPlace, oldName?: string) => void;
};

export type PendingPlace = {
  tempId: string;
  RobotName: string;
  LacationName: string;
  Floor: string;
  LocationX: number;
  LocationY: number;
  Yaw: number;
  MapId: number | null;
  Imformation: string | null;
};

export default function MapPlaceCreateModal({
  isOpen,
  mode = "create",
  worldX,
  worldY,
  pixelX,
  pixelY,
  mapId,
  defaultRobotName = "",
  defaultFloor = "",
  editData = null,
  lockCoords = false,
  defaultYaw,
  onClose,
  onConfirm,
}: Props) {
  const isEdit = mode === "edit";
  const dirWheelRef = useRef<HTMLDivElement>(null);

  const [dbRobots, setDbRobots] = useState<DBRobot[]>([]);
  const [robotFetchError, setRobotFetchError] = useState(false);

  // form state
  const [robotNo, setRobotNo] = useState("");
  const [floor, setFloor] = useState("");
  const [name, setName] = useState("");
  const [direction, setDirection] = useState("");
  const [desc, setDesc] = useState("");
  const isSubmitting = false; // 즉시 반환이므로 항상 false
  const [fieldErrors, setFieldErrors] = useState<{
    robotNo?: string;
    floor?: string;
    name?: string;
    direction?: string;
  }>({});

  const DEFAULT_FLOORS = ["B1", "1F", "2F", "3F", "4F"];

  // DB 로봇 목록 fetch
  const fetchRobots = useCallback(() => {
    setRobotFetchError(false);
    fetch(`${API_BASE}/DB/robots`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setDbRobots(data))
      .catch((err) => {
        console.error("로봇 목록 DB 조회 실패", err);
        setRobotFetchError(true);
      });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchRobots();
  }, [isOpen, fetchRobots]);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && editData) {
      setRobotNo(editData.robotName);
      setFloor(editData.floor);
      setName(editData.name);
      // yaw(라디안) → 도 변환
      setDirection(String(Math.round(editData.yaw * 180 / Math.PI)));
      setDesc(editData.desc);
    } else {
      setRobotNo(defaultRobotName);
      setFloor(defaultFloor);
      setName("");
      if (lockCoords && defaultYaw !== undefined) {
        let deg = Math.round(defaultYaw * 180 / Math.PI);
        if (deg < 0) deg += 360;
        setDirection(String(deg));
      } else {
        setDirection("");
      }
      setDesc("");
    }
    setFieldErrors({});
  }, [isOpen, defaultRobotName, defaultFloor, isEdit, editData]);

  // ESC / 오버레이 클릭 닫기
  useModalBehavior({ isOpen, onClose, disabled: isSubmitting });

  // 필수 필드 검증
  const canSave = !!(robotNo && floor && name.trim() && (direction || direction === "0"));

  // Enter 키 저장
  useEffect(() => {
    if (!isOpen) return;
    const onEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "textarea") return;
      if (isSubmitting || !canSave) return;
      e.preventDefault();
      submit();
    };
    document.addEventListener("keydown", onEnter);
    return () => document.removeEventListener("keydown", onEnter);
  }, [isOpen, isSubmitting, canSave, robotNo, floor, name, direction]);

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

  const handleDirectionWheelClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    setDirection(String(Math.round(angle)));
    setFieldErrors((prev) => ({ ...prev, direction: undefined }));
  };

  const submit = async () => {
    const errors: typeof fieldErrors = {};
    if (!robotNo) errors.robotNo = "로봇명을 선택해 주세요.";
    if (!floor) errors.floor = "층을 선택해 주세요.";
    if (!name.trim()) errors.name = "장소명을 입력해 주세요.";
    if (!direction && direction !== "0") errors.direction = "방향을 입력해 주세요.";
    else {
      const dirNum = Number(direction);
      if (!Number.isFinite(dirNum) || dirNum < 0 || dirNum > 360)
        errors.direction = "방향은 0~360 범위여야 합니다.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const place: PendingPlace = {
      tempId: isEdit && editData ? editData.key : `pending_${Date.now()}`,
      RobotName: robotNo,
      LacationName: name.trim(),
      Floor: floor,
      LocationX: isEdit && editData ? editData.x : Number(worldX.toFixed(3)),
      LocationY: isEdit && editData ? editData.y : Number(worldY.toFixed(3)),
      Yaw: Number((Number(direction) * Math.PI / 180).toFixed(4)),
      MapId: mapId ?? editData?.mapId ?? null,
      Imformation: desc || null,
    };
    const oldName = isEdit && editData && editData.name !== name.trim() ? editData.name : undefined;
    onConfirm(place, oldName);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* ─── 헤더 ─── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <img src="/icon/robot_place_w.png" alt="" />
            <h2>{isEdit ? "장소 수정" : lockCoords ? "현 위치에서 장소 등록" : "장소 등록"}</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="close">
            &#10005;
          </button>
        </div>

        {/* ─── 본문 ─── */}
        <div className={styles.body}>
          {/* 기본 정보 */}
          <div className={styles.sectionGroup}>
            <div className={styles.sectionTitle}>
              기본 정보<span className={styles.sectionTitleLine} />
            </div>

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
                    setFieldErrors((prev) => ({ ...prev, robotNo: undefined }));
                  }}
                  emptyMessage={
                    robotFetchError
                      ? "불러오기 실패"
                      : "등록된 로봇이 없습니다"
                  }
                  className={styles.modalSelect}
                />
                {fieldErrors.robotNo && <div className={styles.fieldError}>{fieldErrors.robotNo}</div>}
              </div>
            </div>

            {/* 층 */}
            <div className={styles.row}>
              <div className={`${styles.label} ${styles.required}`}>층</div>
              <div className={styles.selectWrap}>
                <DropdownSelect<string>
                  placeholder="층을 선택하세요"
                  value={floor || null}
                  options={DEFAULT_FLOORS}
                  getLabel={(f) => f}
                  getKey={(f) => f}
                  onChange={(f) => {
                    setFloor(f);
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
                  className={`${styles.input} ${styles.edit} ${fieldErrors.name ? styles.inputError : ""}`}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                  placeholder="50자 이내로 작성하세요"
                  maxLength={50}
                  autoFocus
                />
                <div className={`${styles.charCounter} ${name.length >= 40 ? styles.charCounterWarn : ""}`}>
                  {name.length}/50
                </div>
                {fieldErrors.name && <div className={styles.fieldError}>{fieldErrors.name}</div>}
              </div>
            </div>
          </div>

          {/* 위치 정보 */}
          <div className={styles.sectionGroup}>
            <div className={styles.sectionTitle}>
              위치 정보<span className={styles.sectionTitleLine} />
            </div>

            {/* 좌표 표시 (월드 + 픽셀) */}
            <div className={`${styles.row} ${styles.rowAlignTop}`}>
              <div className={styles.label}>좌표</div>
              <div className={styles.coordInfo}>
                {/* 월드 좌표 */}
                <div className={styles.coordRow}>
                  <span className={styles.coordTag}>World</span>
                  <div className={styles.coordValues}>
                    <div className={styles.xyInlineItem}>
                      <div className={styles.xyLabel}>X</div>
                      <input
                        className={`${styles.xyInput} ${styles.xyInputFilled}`}
                        value={worldX.toFixed(3)}
                        readOnly
                        tabIndex={-1}
                      />
                    </div>
                    <div className={styles.xyInlineItem}>
                      <div className={styles.xyLabel}>Y</div>
                      <input
                        className={`${styles.xyInput} ${styles.xyInputFilled}`}
                        value={worldY.toFixed(3)}
                        readOnly
                        tabIndex={-1}
                      />
                    </div>
                  </div>
                </div>
                {/* 픽셀 좌표 */}
                <div className={styles.coordRow}>
                  <span className={styles.coordTag}>Pixel</span>
                  <div className={styles.coordValues}>
                    <div className={styles.xyInlineItem}>
                      <div className={styles.xyLabel}>X</div>
                      <input
                        className={`${styles.xyInput} ${styles.xyInputEmpty}`}
                        value={Math.round(pixelX)}
                        readOnly
                        tabIndex={-1}
                      />
                    </div>
                    <div className={styles.xyInlineItem}>
                      <div className={styles.xyLabel}>Y</div>
                      <input
                        className={`${styles.xyInput} ${styles.xyInputEmpty}`}
                        value={Math.round(pixelY)}
                        readOnly
                        tabIndex={-1}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 방향 */}
            <div className={styles.directionRow}>
              <div className={`${styles.label} ${styles.required}`}>방향(°)</div>
              <div className={styles.directionInputWrap}>
                <input
                  className={`${styles.xyInput} ${lockCoords ? "" : styles.edit} ${direction ? styles.xyInputFilled : styles.xyInputEmpty}`}
                  value={direction}
                  onChange={lockCoords ? undefined : handleDirectionChange}
                  onBlur={lockCoords ? undefined : handleDirectionBlur}
                  placeholder="0~360"
                  type="number"
                  min={0}
                  max={360}
                  readOnly={lockCoords}
                />
                <div
                  ref={dirWheelRef}
                  className={styles.directionIndicator}
                  onClick={lockCoords ? undefined : handleDirectionWheelClick}
                  title={lockCoords ? "로봇 현재 방향" : "클릭하여 방향 설정"}
                  role="button"
                  aria-label="방향 설정 휠"
                  style={lockCoords ? { opacity: 0.6, cursor: "default" } : undefined}
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
                  placeholder="100자 이내로 작성하세요"
                  maxLength={100}
                />
                <div className={`${styles.charCounter} ${desc.length >= 90 ? styles.charCounterWarn : ""}`}>
                  {desc.length}/100
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── 하단 버튼 ─── */}
        <div className={styles.footer}>
          <button
            className={`${styles.footerBtn} ${styles.btnRed}`}
            onClick={onClose}
          >
            <img src="/icon/close_btn.png" alt="" />
            취소
          </button>
          <button
            className={`${styles.footerBtn} ${styles.btnBlue}`}
            onClick={submit}
            disabled={!canSave}
            title={!canSave ? "모든 필수 항목을 입력해 주세요." : undefined}
          >
            <img src="/icon/check.png" alt="" />
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
