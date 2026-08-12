"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useModalBehavior } from "@/app/hooks/useModalBehavior";
import styles from "./MapPlaceCreateModal.module.css";
import DropdownSelect from "@/app/components/button/DropdownSelect";

import { API_BASE } from "@/app/config";
import { apiFetch } from "@/app/lib/api";
import { degFromYaw, yawFromDeg } from "@/app/lib/yaw";
import DirectionPicker from "@/app/components/common/DirectionPicker";
import { MapPin } from "lucide-react";

type DBRobot = { id: number; RobotName: string };

const DUPLICATE_NAME_MSG = "이미 사용 중인 장소명입니다. 층이 달라도 이름은 중복될 수 없습니다.";

const CATEGORY_OPTIONS = [
  { value: "waypoint", label: "경유지" },
  { value: "work", label: "작업지" },
  { value: "charge", label: "충전소" },
  { value: "standby", label: "대기소" },
  // 위험구역 기능 비활성화 (요청에 의해 OFF — 에러 상황 방지)
  // { value: "danger", label: "위험구역" },
];

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
  category?: string;
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
  /** 카테고리 기본값 (충전소 생성 등) */
  defaultCategory?: string;
  /** 층 목록 (floor_info) */
  floors?: { id: number; FloorName: string }[];
  /** 이미 쓰이고 있는 장소명(사업장 전체 + 미저장분). 서버가 409 로 막기 전에 미리 걸러낸다. */
  usedNames?: string[];
  onClose: () => void;
  onConfirm: (place: PendingPlace, oldName?: string) => void;
  /** create 모드에서 카테고리 "위험구역" 선택 시 호출 — 점 등록 대신 폴리곤 그리기로 전환 */
  onSelectDanger?: () => void;
};

export type PendingPlace = {
  tempId: string;
  RobotName: string;
  LacationName: string;
  FloorId: number | null;
  LocationX: number;
  LocationY: number;
  Yaw: number;
  MapId: number | null;
  Category: string;
  Imformation: string | null;
  /** 위험구역(Category="danger") 폴리곤 꼭짓점 [[x,y],...] (월드 좌표). 일반 장소는 생략/null. */
  Polygon?: number[][] | null;
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
  defaultCategory,
  floors = [],
  usedNames = [],
  onClose,
  onConfirm,
  onSelectDanger,
}: Props) {
  const isEdit = mode === "edit";

  const [dbRobots, setDbRobots] = useState<DBRobot[]>([]);
  const [robotFetchError, setRobotFetchError] = useState(false);

  // form state
  const [robotNo, setRobotNo] = useState("");
  const [floor, setFloor] = useState("");
  const [name, setName] = useState("");
  const [direction, setDirection] = useState("");
  const [category, setCategory] = useState("waypoint");
  const [desc, setDesc] = useState("");
  const isSubmitting = false; // 즉시 반환이므로 항상 false
  const [fieldErrors, setFieldErrors] = useState<{
    robotNo?: string;
    floor?: string;
    name?: string;
    direction?: string;
  }>({});

  const DEFAULT_FLOORS = ["B1", "1F", "2F", "3F", "4F"];
  const floorOptions = floors.length > 0
    ? floors.map((a) => a.FloorName)
    : DEFAULT_FLOORS;

  // DB 로봇 목록 fetch
  const fetchRobots = useCallback(() => {
    setRobotFetchError(false);
    apiFetch("/DB/robots")
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
      // ROS yaw(라디안) → 방향 도(로봇 yaw 와 동일: 0=동·반시계)
      setDirection(String(degFromYaw(editData.yaw)));
      setCategory(editData.category || "waypoint");
      setDesc(editData.desc);
    } else {
      setRobotNo(defaultRobotName);
      setFloor(defaultFloor);
      setName("");
      if (lockCoords && defaultYaw !== undefined) {
        setDirection(String(degFromYaw(defaultYaw)));
      } else {
        setDirection("");
      }
      setCategory(defaultCategory ?? "waypoint");
      setDesc("");
    }
    setFieldErrors({});
  }, [isOpen, defaultRobotName, defaultFloor, defaultCategory, isEdit, editData]);

  // ESC / 오버레이 클릭 닫기
  useModalBehavior({ isOpen, onClose, disabled: isSubmitting });

  // 장소명 중복 검사 — 서버는 경로가 장소를 '이름'으로 찾는 탓에 사업장 내 중복을 409 로 막는다.
  // 층·맵이 달라도 막히므로 저장 전에 여기서 알린다. 위험구역은 서버도 검사하지 않는다.
  const takenNames = useMemo(() => {
    const own = isEdit && editData ? editData.name.trim() : null;
    return new Set(usedNames.map((n) => n.trim()).filter((n) => n && n !== own));
  }, [usedNames, isEdit, editData]);
  const isDuplicateName = category !== "danger" && !!name.trim() && takenNames.has(name.trim());

  // 필수 필드 검증
  const canSave = !!(robotNo && floor && name.trim() && (direction || direction === "0")) && !isDuplicateName;

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


  const submit = async () => {
    const errors: typeof fieldErrors = {};
    if (!robotNo) errors.robotNo = "로봇명을 선택해 주세요.";
    if (!floor) errors.floor = "층을 선택해 주세요.";
    if (!name.trim()) errors.name = "장소명을 입력해 주세요.";
    else if (isDuplicateName) errors.name = DUPLICATE_NAME_MSG;
    if (!direction && direction !== "0") errors.direction = "방향을 입력해 주세요.";
    else {
      const dirNum = Number(direction);
      if (!Number.isFinite(dirNum) || dirNum < 0 || dirNum > 360)
        errors.direction = "방향은 0~360 범위여야 합니다.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const matchedFloor = floors.find((a) => a.FloorName === floor);
    const place: PendingPlace = {
      tempId: isEdit && editData ? editData.key : `pending_${Date.now()}`,
      RobotName: robotNo,
      LacationName: name.trim(),
      FloorId: matchedFloor?.id ?? null,
      LocationX: isEdit && editData ? editData.x : Number(worldX.toFixed(3)),
      LocationY: isEdit && editData ? editData.y : Number(worldY.toFixed(3)),
      Yaw: yawFromDeg(Number(direction)),
      MapId: mapId ?? editData?.mapId ?? null,
      Category: category,
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
            <MapPin size={20} />
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
                  options={floorOptions}
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
                  className={`${styles.input} ${styles.edit} ${fieldErrors.name || isDuplicateName ? styles.inputError : ""}`}
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
                {(fieldErrors.name || isDuplicateName) && (
                  <div className={styles.fieldError}>{fieldErrors.name ?? DUPLICATE_NAME_MSG}</div>
                )}
              </div>
            </div>

            {/* 장소 타입 */}
            <div className={styles.row}>
              <div className={styles.label}>장소 타입</div>
              <div className={styles.selectWrap}>
                <DropdownSelect<typeof CATEGORY_OPTIONS[number]>
                  placeholder="장소 타입을 선택하세요"
                  value={CATEGORY_OPTIONS.find((o) => o.value === category) ?? null}
                  options={CATEGORY_OPTIONS}
                  getLabel={(o) => o.label}
                  getKey={(o) => o.value}
                  onChange={(o) => {
                    // 위험구역은 폴리곤(영역)이라 점 등록 대신 그리기 모드로 전환한다.
                    if (o.value === "danger" && !isEdit && onSelectDanger) {
                      onSelectDanger();
                      return;
                    }
                    setCategory(o.value);
                  }}
                  className={styles.modalSelect}
                />
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

            {/* 방향 — DirectionPicker 공통(다이얼 포인팅 + 현재 로봇 방향, 숫자 부차) */}
            <DirectionPicker
              value={direction}
              onChange={(d) => {
                setDirection(d);
                setFieldErrors((prev) => ({ ...prev, direction: undefined }));
              }}
              liveRobotYawRad={defaultYaw ?? null}
              disabled={lockCoords}
              error={fieldErrors.direction}
            />
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
