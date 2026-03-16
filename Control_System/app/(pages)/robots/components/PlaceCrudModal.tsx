"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PlaceCrudModal.module.css";
import type { RobotRowData } from "@/app/type";
import { mockPlaceRows } from "@/app/mock/robotPlace_data";

export type PlaceRowData = {
  id: number;
  robotNo: string; // "Robot 1"
  floor: string;   // "1F"
  name: string;    // 장소명
  x: string;       // 좌표 문자열(입력 UX 우선)
  y: string;
  desc: string;
  updatedAt: string; // "2025.12.12 오전 10:35:47"
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
  floors?: string[]; // 없으면 기본값 사용
  initial?: PlaceRowData | null;
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
  onClose,
  onSubmit,
}: Props) {
  const isEdit = mode === "edit";

  // selectbox open states
  const [robotOpen, setRobotOpen] = useState(false);
  const [floorOpen, setFloorOpen] = useState(false);

  const robotWrapRef = useRef<HTMLDivElement>(null);
  const floorWrapRef = useRef<HTMLDivElement>(null);
  
  const [dbRobots, setDbRobots] = useState<DBRobot[]>([]);

  // form state
  const [robotNo, setRobotNo] = useState<string>("");
  const [floor, setFloor] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [x, setX] = useState<string>("");
  const [y, setY] = useState<string>("");
  const [desc, setDesc] = useState<string>("");
  const [isPinMode, setIsPinMode] = useState(false);
  const [pinHoverPos, setPinHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [pinPlaced, setPinPlaced] = useState(false);

  const nowText = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");

    const hours = d.getHours();
    const ampm = hours < 12 ? "오전" : "오후";
    const hh = String(hours % 12 === 0 ? 12 : hours % 12).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");

    return `${y}.${m}.${dd} ${ampm} ${hh}:${mm}:${ss}`;
  }, []);

  // form state 아래쯤에 추가
  const [floorDirty, setFloorDirty] = useState(false);
  const [xDirty, setXDirty] = useState(false);
  const [yDirty, setYDirty] = useState(false);

  // robotNo가 바뀌면 해당 로봇의 "최근 위치"를 찾는다(목업 기준)
  const latestRobotPose = useMemo(() => {
    if (!robotNo) return null;

    // mockPlaceRows 중 robotNo가 같은 것들 중 마지막(=최신이라고 가정)
    const candidates = mockPlaceRows.filter((r) => r.robotNo === robotNo);
    if (candidates.length === 0) return null;

    return candidates[candidates.length - 1]; // { floor, x, y ... }
  }, [robotNo]);

  // 로봇 선택이 바뀌었을 때 자동 채움 (사용자가 직접 입력한 값은 보호)
  useEffect(() => {
    if (!latestRobotPose) return;

    // 층: 사용자가 직접 고르지 않았다면 로봇 위치층으로 자동 세팅
    if (!floorDirty) setFloor(latestRobotPose.floor);

    // 좌표는 맵에서만 설정
  }, [latestRobotPose, floorDirty, xDirty, yDirty]);

  useEffect(() => {
  if (!isOpen) return;

  fetch("http://localhost:8000/DB/robots")
    .then(res => res.json())
    .then(data => {
      setDbRobots(data);
    })
    .catch(err => {
      console.error("로봇 목록 DB 조회 실패", err);
    });
}, [isOpen]);

  // open/close lifecycle
  useEffect(() => {
    if (!isOpen) return;

    if (initial) {
      setRobotNo(initial.robotNo ?? "");
      setFloor(initial.floor ?? "");
      setName(initial.name ?? "");
      setX(initial.x ?? "");
      setY(initial.y ?? "");
      setDesc(initial.desc ?? "");
      setPinPlaced(false);
    } else {
      setRobotNo("");
      setFloor("");
      setName("");
      setX("");
      setY("");
      setDesc("");
      setPinPlaced(false);
    }
    setIsPinMode(false);
    setPinHoverPos(null);

    // ✅ 핵심: edit로 열릴 때는 initial 값을 보호해야 하므로 dirty=true
    // create로 열릴 때는 자동 채움이 필요하므로 dirty=false
    const isEditOpen = mode === "edit" && !!initial;
    setFloorDirty(isEditOpen);
    setXDirty(isEditOpen);
    setYDirty(isEditOpen);

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, initial, mode, onClose]);

  // outside click closes selectboxes
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;

      if (robotWrapRef.current && !robotWrapRef.current.contains(t)) setRobotOpen(false);
      if (floorWrapRef.current && !floorWrapRef.current.contains(t)) setFloorOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const submit = async () => {
    if (!robotNo) {
      alert("로봇명을 선택해 주세요.");
      return;
    }
    if (!floor) {
      alert("층을 선택해 주세요.");
      return;
    }
    if (!name.trim()) {
      alert("장소명을 입력해 주세요.");
      return;
    }

    const dbPayload = {
      RobotName: robotNo,
      LacationName: name.trim(),
      Floor: floor,
      LocationX: Number(x),
      LocationY: Number(y),
      Imformation: desc || null,
    };

    try {
      const isEditMode = mode === "edit" && initial?.id;

      const url = isEditMode
        ? `http://localhost:8000/DB/places/${initial.id}`   // 🔥 수정
        : `http://localhost:8000/DB/places`;                // 🔥 신규

      const method = isEditMode ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dbPayload),
      });

      if (!res.ok) {
        throw new Error(isEditMode ? "DB 수정 실패" : "DB 저장 실패");
      }

      const saved = await res.json();

      // ✅ UI 반영
      onSubmit({
        id: saved.id ?? initial?.id,
        robotNo,
        name: name.trim(),
        floor,
        x,
        y,
        desc,
        updatedAt: nowText,
      });

      onClose();
    } catch (err) {
      console.error(err);
      alert("장소 저장 중 오류가 발생했습니다.");
    }
  };


  // 줌 인/아웃, 드래그 기능 구현
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  const handleZoomFromChild = (action: string) => {
    setScale(prev => {
      if (action === "in") return Math.min(prev + 0.2, 3);
      if (action === "out") return Math.max(prev - 0.2, 0.5);
      return 1;
    });
  };

  /* -------------------------------------------------
      FastAPI에서 로봇 좌표 받아오기
  -------------------------------------------------- */
  const [robotPos, setRobotPos] = useState({ x: 0, y: 0, yaw: 0 });

  // useEffect(() => {
  //     const loadRobotPos = () => {
  //         fetch("http://localhost:8000/robot/position")
  //             .then(res => res.json())
  //             .then(data => setRobotPos(data))
  //             .catch(() => {});
  //     };

  //     loadRobotPos();
  //     const timer = setInterval(loadRobotPos, 1000);
  //     return () => clearInterval(timer);
  // }, []);

  /* -------------------------------------------------
      mapSize 측정
  -------------------------------------------------- */
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      if (!wrapperRef.current) return;

      setMapSize({
        w: wrapperRef.current.clientWidth,
        h: wrapperRef.current.clientHeight,
      });

      console.log("🗺 mapSize set:", {
        w: wrapperRef.current.clientWidth,
        h: wrapperRef.current.clientHeight,
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [isOpen]);

  /* -------------------------------------------------
      world → pixel
  -------------------------------------------------- */
  const mapResolution = 0.1;
  const mapOriginX = -19.9;
  const mapOriginY = -15.5;
  const mapPixelWidth = 427;
  const mapPixelHeight = 240;

  const worldToPixel = (x: number, y: number) => {
      const px = (x - mapOriginX) / mapResolution;
      const py = (y - mapOriginY) / mapResolution;

      return {
          x: px * (mapSize.w / mapPixelWidth),
          y: mapSize.h - (py * (mapSize.h / mapPixelHeight)),
      };
  };

  const pixelToWorld = (px: number, py: number) => {
      const worldX = mapOriginX + (px / (mapSize.w / mapPixelWidth)) * mapResolution;
      const worldY =
        mapOriginY + ((mapSize.h - py) / (mapSize.h / mapPixelHeight)) * mapResolution;

      return { x: worldX, y: worldY };
  };

  const robotScreenPos = useMemo(() => {
      if (mapSize.w === 0 || mapSize.h === 0) return { x: -9999, y: -9999 };
      return worldToPixel(robotPos.x, robotPos.y);
  }, [robotPos, mapSize]);

  /* ---------------- Drag & Zoom ---------------- */
  const clampTranslate = (nx: number, ny: number) => {
      const wrap = wrapperRef.current;
      const img = imgRef.current;
      if (!wrap || !img) return { x: nx, y: ny };

      const wrapW = wrap.clientWidth;
      const wrapH = wrap.clientHeight;

      const baseW = img.clientWidth;
      const baseH = img.clientHeight;

      const scaledW = baseW * scale;
      const scaledH = baseH * scale;

      const maxOffsetX = Math.max(0, (scaledW - wrapW) / 2);
      const maxOffsetY = Math.max(0, (scaledH - wrapH) / 2);

      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

      return {
          x: clamp(nx, -maxOffsetX, maxOffsetX),
          y: clamp(ny, -maxOffsetY, maxOffsetY),
      };
  };

  const onMouseDown = (e: React.MouseEvent) => {
      if (scale <= 1) return;

      const img = imgRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const inside =
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom;

      if (!inside) return;

      setIsPanning(true);
      panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          tx: translate.x,
          ty: translate.y,
      };
  };

  const onMouseMove = (e: React.MouseEvent) => {
      if (!isPanning || !panStartRef.current) return;
      const { x, y, tx, ty } = panStartRef.current;
      const dx = e.clientX - x;
      const dy = e.clientY - y;

      const next = clampTranslate(tx + dx, ty + dy);
      setTranslate(next);
  };

  const endPan = () => {
      setIsPanning(false);
      panStartRef.current = null;
  };

  useEffect(() => {
      setTranslate(prev => clampTranslate(prev.x, prev.y));
  }, [scale]);

  useEffect(() => {
    if (!latestRobotPose) return;
    setRobotPos({ x: latestRobotPose.x, y: latestRobotPose.y, yaw: 0 });
  }, [latestRobotPose]);

  const pinScreenPos = useMemo(() => {
    const px = Number(x);
    const py = Number(y);
    if (Number.isNaN(px) || Number.isNaN(py)) return null;
    if (mapSize.w === 0 || mapSize.h === 0) return null;

    const pos = worldToPixel(px, py);
    return {
      left: `${pos.x}px`,
      top: `${pos.y}px`,
    } as React.CSSProperties;
  }, [x, y, mapSize]);

  useEffect(() => {
    if (!latestRobotPose) return;

    // edit 모드에서 initial이 있으면(=기존 장소 수정) 자동 덮어쓰기 금지
    if (mode === "edit" && initial) return;

    if (!floorDirty) setFloor(latestRobotPose.floor);
    // 좌표는 맵에서만 설정
  }, [latestRobotPose, mode, initial, floorDirty, xDirty, yDirty]);

  const title = isEdit ? "장소 수정" : "장소 등록";
  const mapCurrentImage = "/map/map_test_6_800x450.png";
  const getMapPixelFromEvent = (e: React.MouseEvent) => {
    const wrap = wrapperRef.current;
    console.log("wrap:", wrap);
    console.log("mapSize:", mapSize);
    if (!wrap || mapSize.w === 0 || mapSize.h === 0) {
      console.warn("❌ mapPixel blocked");
      return null;
    }
    const rect = wrap.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x1 = localX - translate.x;
    const y1 = localY - translate.y;
    const x2 = (x1 - cx) / scale + cx;
    const y2 = (y1 - cy) / scale + cy;

    const clampedX = Math.max(0, Math.min(rect.width, x2));
    const clampedY = Math.max(0, Math.min(rect.height, y2));

    return { x: clampedX, y: clampedY };
  };

  const handleMapClick = (e: React.MouseEvent) => {
    console.log("🟡 map clicked");
    console.log("isPinMode:", isPinMode);

    if (!isPinMode || isPanning) return;
    
    const mapPixel = getMapPixelFromEvent(e);
    console.log("🟢 mapPixel:", mapPixel);

    if (!mapPixel) return;

    const world = pixelToWorld(mapPixel.x, mapPixel.y);
    console.log("🔵 world:", world);

    setXDirty(true);
    setYDirty(true);
    setX(world.x.toFixed(2));
    setY(world.y.toFixed(2));
    setPinHoverPos(null);
    setPinPlaced(true);
  };

  const handleMapMouseMove = (e: React.MouseEvent) => {
    onMouseMove(e);
    if (!isPinMode || isPanning || pinPlaced) return;
    const mapPixel = getMapPixelFromEvent(e);
    if (!mapPixel) return;
    setPinHoverPos(mapPixel);
  };

  const handleMapMouseLeave = () => {
    endPan();
    setPinHoverPos(null);
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="close">
          ✕
        </button>

        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <img src="/icon/robot_place_w.png" alt="" />
            <h2>{title}</h2>
          </div>
        </div>

        <div className={styles.bodyCard}>
          {/* 로봇명 */}
          <div className={styles.row}>
            <div className={styles.label}>로봇명</div>
            <div ref={robotWrapRef} className={styles.selectWrap}>
              <div className={styles.selectBox} onClick={() => setRobotOpen((v) => !v)}>
                <span>{robotNo || "로봇명을 선택하세요"}</span>
                <img
                  src={robotOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
                  alt=""
                />
              </div>

              {robotOpen && (
                <div className={styles.dropdown}>
                  <div className={styles.dropdownInner}>
                    {dbRobots.map((r) => (
                      <div
                        key={r.id}
                        className={styles.option}
                        onClick={() => {
                          setRobotNo(r.RobotName);

                          // 로봇을 새로 선택했으니 로봇 최근 위치 기반 자동채움 허용
                          setFloorDirty(false);
                          setXDirty(false);
                          setYDirty(false);

                          setRobotOpen(false);
                        }}
                      >
                        {r.RobotName}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 층별 */}
          <div className={styles.row}>
            <div className={styles.label}>층별</div>
            <div ref={floorWrapRef} className={styles.selectWrap}>
              <div className={styles.selectBox} onClick={() => setFloorOpen((v) => !v)}>
                <span>{floor || "층을 선택하세요"}</span>
                <img
                  src={floorOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
                  alt=""
                />
              </div>

              {floorOpen && (
                <div className={styles.dropdown}>
                  <div className={styles.dropdownInner}>
                    {floors.map((f) => (
                      <div
                        key={f}
                        className={styles.option}
                        onClick={() => {
                          setFloor(f);
                          setFloorDirty(true);
                          setFloorOpen(false);
                        }}
                      >
                        {f}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 장소명 */}
          <div className={styles.row}>
            <div className={styles.label}>장소명</div>
            <input
              className={`${styles.input} ${styles.edit}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="50자(100byte) 이내로 작성하세요"
              maxLength={50}
            />
          </div>

          {/* 장소좌표 */}
          <div className={`${styles.row} ${styles.rowTall}`}>
            <div className={styles.label}>장소좌표</div>
            <div className={styles.xyBox}>
              <div className={styles.xyRow}>
                <div className={styles.xyLabel}>X 좌표</div>
                <input
                  className={`${styles.input} ${styles.edit}`}
                  value={x}
                  readOnly
                  placeholder="좌표값을 지도에서 선택해 주세요."
                />
              </div>
              <div className={styles.xyRow}>
                <div className={styles.xyLabel}>Y 좌표</div>
                <input
                  className={`${styles.input} ${styles.edit}`}
                  value={y}
                  readOnly
                  placeholder="좌표값을 지도에서 선택해 주세요."
                />
              </div>
            </div>
          </div>

          {/* 맵 프리뷰 */}
          <div className={styles.mapBox}>
            <div className={styles.mapTopLeft}>
              <div className={styles.floorChip}>{floor || "1F"}</div>
            </div>
            <div className={styles.mapTopRight}>
              <div
                className={`${styles.pinBtn} ${isPinMode ? styles.pinBtnActive : ""}`}
                title="pin"
                onClick={() => {
                  setIsPinMode((v) => {
                    const next = !v;
                    if (next) {
                      setPinHoverPos(null);
                      setPinPlaced(false);
                    } else {
                      setPinHoverPos(null);
                      if (isEdit && initial) {
                        setX(initial.x ?? "");
                        setY(initial.y ?? "");
                        setXDirty(true);
                        setYDirty(true);
                      } else {
                        setX("");
                        setY("");
                        setXDirty(false);
                        setYDirty(false);
                      }
                      setPinPlaced(false);
                    }
                    return next;
                  });
                }}
                role="button"
                aria-pressed={isPinMode}
              >
                <img src={"/icon/robot_place_w.png"} alt="" />
              </div>
            </div>

            <div
                ref={wrapperRef}
                style={{
                    width: "100%",
                    height: "100%",
                    userSelect: "none",
                    background: "rgb(128, 128, 128)",
                    touchAction: "none",
                    cursor: isPinMode
                      ? "none"
                      : scale > 1 ? (isPanning ? "grabbing" : "grab") : "default",
                }}
                onMouseDown={onMouseDown}
                onMouseMove={handleMapMouseMove}
                onMouseUp={endPan}
                onMouseLeave={handleMapMouseLeave}
                onClick={handleMapClick}
            >
                <div
                    ref={innerRef}
                    style={{
                    width: "100%",
                    height: "100%",
                    position: "relative",
                    transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                    transformOrigin: "center center",
                    transition: isPanning ? "none" : "transform 120ms ease",
                    }}
                >
                    {/* MAP IMAGE */}
                    <img
                        ref={imgRef}
                        src={mapCurrentImage}
                        draggable={false}
                        style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        pointerEvents: "none",
                        }}
                    />

                    {/* ROBOT MARKER */}
                    {latestRobotPose && (
                      <img
                          src="/icon/robot_location(1).png"
                          style={{
                          position: "absolute",
                          left: `${robotScreenPos.x}px`,
                          top: `${robotScreenPos.y}px`,
                          height: "38px",
                          transform: "translate(-50%, -50%)",
                          pointerEvents: "none",
                          zIndex: 50,
                          }}
                      />
                    )}
                    {isPinMode && !pinPlaced && pinHoverPos && (
                      <img
                        src="/icon/place_point.png"
                        alt=""
                        className={styles.pinMarkerGhost}
                        style={{
                          left: `${pinHoverPos.x}px`,
                          top: `${pinHoverPos.y}px`,
                          transform: "translate(-50%, -100%)",
                        }}
                      />
                    )}
                    {isPinMode && pinPlaced && pinScreenPos && (
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
                </div>
            </div>

            <div className={styles.mapBottomRight}>
              <div className={styles.zoomBtn} onClick={() => handleZoomFromChild("in")}>
                <img src="/icon/zoom-in-w.png" alt="+" />
              </div>
              <div className={styles.zoomBtn} onClick={() => handleZoomFromChild("out")}>
                <img src="/icon/zoom-out-w.png" alt="-" />
              </div>
            </div>
          </div>
          <div className={styles.mapHint}>
            *우측 상단 핀 버튼으로 좌표 선택 모드를 켜거나 끌 수 있습니다.
          </div>

          {/* 장소설명 */}
          <div className={`${styles.row} ${styles.rowTextArea}`}>
            <div className={styles.label}>장소설명</div>
            <textarea
              className={`${styles.textarea} ${styles.edit}`}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="100자(200byte) 이내로 작성하세요"
              maxLength={100}
            />
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

        {/* 하단 버튼(이미지 톤: 취소=Red / 저장=Blue) */}
        <div className={styles.footer}>
          <button className={`${styles.footerBtn} ${styles.btnRed}`} onClick={onClose}>
            <img src="/icon/close_btn.png" alt="" />
            취소
          </button>
          <button className={`${styles.footerBtn} ${styles.btnBlue}`} onClick={submit}>
            <img src="/icon/check.png" alt="" />
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
