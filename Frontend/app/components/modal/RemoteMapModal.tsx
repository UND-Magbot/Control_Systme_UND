'use client';

import styles from './Modal.module.css';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { RobotRowData, Video, Camera, PrimaryViewType } from '@/app/type';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { VideoStatus, RemotePad, ModalRobotSelect } from '@/app/components/button';
import { getApiBase } from "@/app/config";
import { CanvasMap } from '@/app/components/map';
import type { CanvasMapHandle } from '@/app/components/map';
import { OCC_GRID_CONFIG } from '@/app/components/map/mapConfigs';
import { useRobotPosition } from '@/app/hooks/useRobotPosition';

type RobotViewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  selectedRobots: RobotRowData | null;
  robots: RobotRowData[];
  video: Video[];
  camera: Camera[];
  initialCam?: Camera | null;
  initialCamIndex?: number;
  primaryView: PrimaryViewType;
};

type BatteryStatus = {
  VoltageLeft?: number;
  VoltageRight?: number;
  BatteryLevelLeft?: number;
  BatteryLevelRight?: number;
  battery_temperatureLeft?: number;
  battery_temperatureRight?: number;
  chargeLeft?: boolean;
  chargeRight?: boolean;
  serialLeft?: string;
  serialRight?: string;
};

type RobotStatus = {
  battery: BatteryStatus;
};

export default function RemoteModal({
  isOpen,
  onClose,
  selectedRobots,
  robots,
  video,
  camera,
  initialCam,
  initialCamIndex,
  primaryView,
}: RobotViewModalProps) {

  const [retryKey, setRetryKey] = useState(0);

  // 카메라 로딩/에러 상태
  const [isCamLoading, setIsCamLoading] = useState(true);
  const [camError, setCamError] = useState(false);
  const camTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CAM_TIMEOUT_MS = 10000;

  // 선택된 로봇
  const [robotActiveIndex, setRobotActiveIndex] = useState<number>(0);
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);
  const defaultRobotName = selectedRobot?.no || "Robot 1";

  // 활성 카메라
  const [activeCam, setActiveCam] = useState<number>(1);
  const [cameraTabActiveIndex, setCameraTabActiveIndex] = useState<number>(0);

  const [isCamOpen, setIsCamOpen] = useState(false);
  const camWrapperRef = useRef<HTMLDivElement>(null);
  const [selectedCam, setSelectedCam] = useState<number | null>(null);
  const [cameraStream, setCameraStream] = useState(`${getApiBase()}/Video/1`);

  const didInitOnOpenRef = useRef(false);
  const userTouchedCamRef = useRef(false);

  // flash
  const [flashFront, setFlashFront] = useState<"on" | "off">("off");
  const [flashRear, setFlashRear] = useState<"on" | "off">("off");

  // camera/map swap 상태
  const [isSwapped, setIsSwapped] = useState(false);

  const mainView: "camera" | "map" = isSwapped ? (primaryView === "camera" ? "map" : "camera") : primaryView;
  const pipView: "camera" | "map" = mainView === "camera" ? "map" : "camera";
  const isMainMap = mainView === "map";

  // 카메라용 zoom/pan (맵은 CanvasMap 내부에서 처리)
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const cameraImgRef = useRef<HTMLImageElement | null>(null);
  const mainMapRef = useRef<CanvasMapHandle>(null);

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const [thermalUrl, setThermalUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevObjectUrlRef = useRef<string | null>(null);

  // 로봇 위치 (주석처리 상태 유지)
  const { position: robotPos, isReady: robotConnected } = useRobotPosition(isOpen);
  const [robotStatus] = useState<RobotStatus>({ battery: {} });

  const connectThermalWS = () => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket("ws://10.21.41.29:8765");
    wsRef.current = ws;
    ws.onopen = () => console.log("🔥 Thermal WS Connected");
    ws.onerror = (e) => console.error("🔥 Thermal WS Error", e);
    ws.onmessage = (e) => {
      if (e.data instanceof Blob) {
        const nextUrl = URL.createObjectURL(e.data);
        if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
        prevObjectUrlRef.current = nextUrl;
        setThermalUrl(nextUrl);
      }
    };
    ws.onclose = () => console.log("🔥 Thermal WS Closed");
  };

  const handleImgError = () => {
    setTimeout(() => setRetryKey(prev => prev + 1), 1000);
  };

  const clearCamTimeout = () => {
    if (camTimeoutRef.current) {
      clearTimeout(camTimeoutRef.current);
      camTimeoutRef.current = null;
    }
  };

  const startCamTimeout = () => {
    clearCamTimeout();
    camTimeoutRef.current = setTimeout(() => {
      setCamError(true);
      setIsCamLoading(false);
    }, CAM_TIMEOUT_MS);
  };

  const handleCamImgError = () => {
    clearCamTimeout();
    setCamError(true);
    setIsCamLoading(false);
  };

  const handleCamImgLoad = () => {
    clearCamTimeout();
    setIsCamLoading(false);
    setCamError(false);
  };

  const resetCamState = () => {
    clearCamTimeout();
    setIsCamLoading(true);
    setCamError(false);
    startCamTimeout();
  };

  const handleRetryCamera = () => {
    setIsCamLoading(true);
    setCamError(false);
    setRetryKey(prev => prev + 1);
    startCamTimeout();
  };

  // 카메라 영역 위 UI 요소 표시 여부
  const isOverlayReady = !isCamLoading || camError || mainView === "map";

  // 카메라 zoom/pan (맵이 아닌 카메라 메인일 때만)
  const clampTranslate = (nx: number, ny: number) => {
    const wrap = wrapperRef.current;
    const img = cameraImgRef.current;
    if (!wrap || !img) return { x: nx, y: ny };
    const wrapW = wrap.clientWidth;
    const wrapH = wrap.clientHeight;
    const scaledW = img.clientWidth * scale;
    const scaledH = img.clientHeight * scale;
    const maxOffsetX = Math.max(0, (scaledW - wrapW) / 2);
    const maxOffsetY = Math.max(0, (scaledH - wrapH) / 2);
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
    return {
      x: clamp(nx, -maxOffsetX, maxOffsetX),
      y: clamp(ny, -maxOffsetY, maxOffsetY),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (isMainMap || scale <= 1) return; // 맵일 때는 CanvasMap이 처리
    const img = cameraImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !panStartRef.current) return;
    const { x, y, tx, ty } = panStartRef.current;
    setTranslate(clampTranslate(tx + (e.clientX - x), ty + (e.clientY - y)));
  };

  const endPan = () => {
    setIsPanning(false);
    panStartRef.current = null;
  };

  const handleSwapView = () => {
    setIsSwapped(prev => !prev);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setIsPanning(false);
  };

  useEffect(() => {
    setTranslate(prev => clampTranslate(prev.x, prev.y));
  }, [scale]);

  // TODO: 임시 하드코딩 — 실제 배터리 연동 시 제거
  const batteryPercentage = 70;

  /* --- robot selector --- */
  useEffect(() => {
    setSelectedRobot(selectedRobots);
    if (selectedRobots) {
      const idx = robots.findIndex(r => r.id === selectedRobots.id);
      if (idx !== -1) setRobotActiveIndex(idx);
    }
  }, [selectedRobots, robots]);

  /* --- close modal --- */
  const handleClose = () => {
    clearCamTimeout();
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setIsPanning(false);
    setIsSwapped(false);
    setCameraTabActiveIndex(0);
    setSelectedRobot(selectedRobots);
    onClose();
  };

  useModalBehavior({ isOpen, onClose: handleClose });

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (camWrapperRef.current && !camWrapperRef.current.contains(e.target as Node)) {
        setIsCamOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  /* --- robot control API --- */
  const standHandle = () => fetch(`${getApiBase()}/robot/stand`, { method: "POST" });
  const sitHandle = () => fetch(`${getApiBase()}/robot/sit`, { method: "POST" });
  const slowHandle = () => fetch(`${getApiBase()}/robot/slow`, { method: "POST" });
  const normalHandle = () => fetch(`${getApiBase()}/robot/normal`, { method: "POST" });
  const fastHandle = () => fetch(`${getApiBase()}/robot/fast`, { method: "POST" });
  const [isWorking, setIsWorking] = useState(false);
  const [showWorkMenu, setShowWorkMenu] = useState(false);
  const [loopCount, setLoopCount] = useState<number | string>(10);
  const navPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workMenuRef = useRef<HTMLDivElement>(null);

  // 작업 중일 때 nav 상태 폴링 → 완료 시 버튼 전환
  useEffect(() => {
    if (isWorking) {
      navPollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${getApiBase()}/robot/nav`);
          const data = await res.json();
          if (!data.is_navigating) {
            setIsWorking(false);
          }
        } catch {}
      }, 2000);
    } else {
      if (navPollRef.current) {
        clearInterval(navPollRef.current);
        navPollRef.current = null;
      }
    }
    return () => {
      if (navPollRef.current) clearInterval(navPollRef.current);
    };
  }, [isWorking]);

  // 팝오버 외부 클릭 시 닫기
  useEffect(() => {
    if (!showWorkMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (workMenuRef.current && !workMenuRef.current.contains(e.target as Node)) {
        setShowWorkMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showWorkMenu]);

  const handleWorkBtnClick = () => {
    if (isWorking) {
      fetch(`${getApiBase()}/nav/stopmove`, { method: "POST" }).then(() => setIsWorking(false));
    } else {
      setShowWorkMenu((prev) => !prev);
    }
  };

  const handleInitPose = () => fetch(`${getApiBase()}/robot/initpose`, { method: "POST" });

  const startWork = (loop: number) => {
    setShowWorkMenu(false);
    fetch(`${getApiBase()}/nav/startmove?loop=${loop}`, { method: "POST" }).then(() => setIsWorking(true));
  };
  const handlesavePoint = () => fetch(`${getApiBase()}/nav/savepoint`, { method: "POST" });
  const handleClearPoints = () => {
    if (confirm("웨이포인트를 초기화하시겠습니까?")) {
      fetch(`${getApiBase()}/nav/clearpoints`, { method: "POST" });
    }
  };

  // flash
  type FlashTarget = "front" | "rear";
  type FlashValue = "on" | "off";

  const sendFlashCommand = async (target: FlashTarget, value: FlashValue) => {
    if (target === "front") {
      if (value === "on") fetch(`${getApiBase()}/robot/front_on`, { method: "POST" });
      else fetch(`${getApiBase()}/robot/front_off`, { method: "POST" });
    } else {
      if (value === "on") fetch(`${getApiBase()}/robot/rear_on`, { method: "POST" });
      else fetch(`${getApiBase()}/robot/rear_off`, { method: "POST" });
    }
  };

  const handleFlashFront = (value: FlashValue) => {
    if (flashFront === value) return;
    setFlashFront(value);
    sendFlashCommand("front", value);
  };

  const handleFlashRear = (value: FlashValue) => {
    if (flashRear === value) return;
    setFlashRear(value);
    sendFlashCommand("rear", value);
  };

  const selectedCamLabel = useMemo(() => {
    const found = camera.find((c) => c.id === (selectedCam ?? activeCam));
    return found?.label ?? "Cam 1";
  }, [camera, selectedCam, activeCam]);

  /* --- camera tab --- */
  const handleCameraTab = (idx: number, cam: Camera) => {
    resetCamState();
    setSelectedCam(cam.id);
    setActiveCam(cam.id);
    setCameraTabActiveIndex(idx);

    if (cam.id === 3) {
      setThermalUrl(null);
      connectThermalWS();
      setIsCamOpen(false);
      return;
    }

    if (wsRef.current) wsRef.current.close();
    setThermalUrl(null);
    const nextUrl = cam.webrtcUrl || `${getApiBase()}/Video/${cam.id}`;
    setCameraStream(nextUrl);
    setIsCamOpen(false);
  };

  useEffect(() => {
    if (!isOpen) {
      didInitOnOpenRef.current = false;
      userTouchedCamRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (didInitOnOpenRef.current && userTouchedCamRef.current) return;
    if (didInitOnOpenRef.current) return;
    didInitOnOpenRef.current = true;

    const baseCam = initialCam ?? camera.find((c) => c.id === activeCam) ?? camera[0];
    if (!baseCam) return;

    const nextIdx = typeof initialCamIndex === "number"
      ? initialCamIndex
      : Math.max(0, camera.findIndex((c) => c.id === baseCam.id));

    resetCamState();
    setSelectedCam(baseCam.id);
    setActiveCam(baseCam.id);
    setCameraTabActiveIndex(nextIdx);

    const nextUrl = baseCam.webrtcUrl || `${getApiBase()}/Video/${baseCam.id}`;
    setCameraStream(nextUrl);
    setIsCamOpen(false);
  }, [isOpen, initialCam?.id, initialCamIndex, camera, activeCam]);

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.remoteModalContent} onClick={(e) => e.stopPropagation()}>

        {/* TOP */}
        <div className={styles.modalTopDiv}>
          <div className={styles.modalTitle}>
            <img src="/icon/robot_control_w.png" alt="robot_control" key={retryKey} onError={handleImgError} />
            <div>원격 제어 <span>(실시간 카메라 및 위치 맵)</span></div>
          </div>
          <div className={styles.modalTopRight}>
            <button type='button' className={styles.workStart} onClick={handleInitPose}>위치 재조정</button>
            <button type='button' className={styles.workStart} onClick={handleClearPoints}>위치 초기화</button>
            <button type='button' className={styles.workStart} onClick={handlesavePoint}>위치 저장</button>
            <div style={{ position: 'relative' }} ref={workMenuRef}>
              <button type='button' className={isWorking ? styles.workStop : styles.workStart} onClick={handleWorkBtnClick}>
                {isWorking ? '작업 중지' : '작업 시작'}
              </button>
              {showWorkMenu && (
                <div className={styles.workPopover}>
                  <div className={styles.workPopoverItem}>
                    <span>단일 실행</span>
                    <button type='button' className={styles.loopStartBtn} onClick={() => startWork(1)}>
                      시작
                    </button>
                  </div>
                  <div className={styles.workPopoverDivider} />
                  <div className={styles.workPopoverItem}>
                    <span>반복 실행</span>
                    <div className={styles.loopInputRow}>
                      <input
                        type="number"
                        min={2}
                        max={999}
                        value={loopCount}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLoopCount(v === '' ? '' : parseInt(v) || '');
                        }}
                        onBlur={() => {
                          if (loopCount === '' || Number(loopCount) < 2) setLoopCount(2);
                        }}
                        className={styles.loopInput}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span>회</span>
                      <button type='button' className={styles.loopStartBtn} onClick={() => startWork(Number(loopCount) || 2)}>
                        시작
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button type='button' className={styles.closeBtn} onClick={handleClose}>✕</button>
          </div>
        </div>

        {/* MAIN CAMERA / MAP AREA */}
        <div className={styles.cameraView}>

          {/* Robot Select / Status */}
          <div className={`${styles.topPosition} ${isOverlayReady ? styles.overlayVisible : styles.overlayHidden}`}>
            <ModalRobotSelect
              selectedLabel={defaultRobotName}
              robots={robots}
              activeIndex={robotActiveIndex}
              onSelect={(idx, robot) => {
                setRobotActiveIndex(idx);
                setSelectedRobot(robot);
              }}
              primaryView={isMainMap ? "map" : "camera"}
            />

            {/* camera selectBox - 카메라 뷰일 때만 */}
            {!isMainMap && (
              <div ref={camWrapperRef} className={styles.modalCamSeletWrapper}>
                <div className={styles.modalCamSelect} onClick={() => setIsCamOpen((p) => !p)}>
                  <span>{selectedCamLabel}</span>
                  {isCamOpen
                    ? <img src="/icon/arrow_up.png" alt="arrow up" />
                    : <img src="/icon/arrow_down.png" alt="arrow down" />
                  }
                </div>
                {isCamOpen && (
                  <div className={styles.modalCamSeletbox}>
                    {camera.map((cam, idx) => (
                      <div
                        key={cam.id}
                        className={`${styles.camLabel} ${cameraTabActiveIndex === idx ? styles.active : ""}`.trim()}
                        onClick={() => handleCameraTab(idx, cam)}
                      >
                        {cam.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className={styles.topRightPostion}>
              <div className={styles.topRightIcon}>
                {/* AR/MR - 카메라 뷰일 때만 */}
                {!isMainMap && <VideoStatus className={styles.videoStatusCustom} video={video} primaryView="camera" />}
                <div className={styles.robotStatus}>
                  <img src="/icon/online_w.png" alt="online" key={retryKey} onError={handleImgError} />
                  <div>Online</div>
                </div>
                <div className={`${styles.robotStatus} ${batteryPercentage <= 30 ? styles.batteryLow : ''}`}>
                  <img src="/icon/battery_full_w.png" alt="battery" key={retryKey} onError={handleImgError} />
                  <div>{batteryPercentage}%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Swappable Camera/Map View */}
          <div className={styles["video-box"]} style={{ width: "100%", height: "100%", position: "relative", aspectRatio: "16/9" }}>
            <div
              ref={wrapperRef}
              className={`${styles.videoWrapper} ${isMainMap ? styles.videoWrapperMap : ''} ${!isMainMap && scale > 1 ? (isPanning ? styles.videoWrapperCameraPanning : styles.videoWrapperCameraZoomed) : ''}`}
              onMouseDown={!isMainMap ? onMouseDown : undefined}
              onMouseMove={!isMainMap ? onMouseMove : undefined}
              onMouseUp={!isMainMap ? endPan : undefined}
              onMouseLeave={!isMainMap ? endPan : undefined}
            >
              {/* Camera Loading Overlay */}
              {isCamLoading && mainView === "camera" && (
                <div className={styles.cameraLoadingOverlay}>
                  <div className={styles.cameraLoadingSpinner} />
                  <span className={styles.cameraLoadingText}>카메라 연결 중...</span>
                </div>
              )}

              {/* Camera Error Overlay */}
              {camError && mainView === "camera" && (
                <div className={styles.cameraErrorOverlay}>
                  <span className={styles.cameraErrorTitle}>카메라 연결 실패</span>
                  <span className={styles.cameraErrorDesc}>카메라 스트림에 연결할 수 없습니다</span>
                  <button type="button" className={styles.cameraRetryBtn} onClick={handleRetryCamera}>다시 시도</button>
                </div>
              )}

              {/* MAIN CAMERA */}
              {activeCam === 3 && thermalUrl ? (
                <img
                  src={thermalUrl}
                  ref={cameraImgRef}
                  draggable={false}
                  onLoad={handleCamImgLoad}
                  onError={handleCamImgError}
                  style={{
                    width: "100%", height: "100%", objectFit: "cover",
                    position: "absolute", top: 0, left: 0,
                    display: mainView === "camera" ? "block" : "none",
                  }}
                />
              ) : (
                <img
                  ref={cameraImgRef}
                  key={retryKey}
                  src={cameraStream}
                  draggable={false}
                  onLoad={handleCamImgLoad}
                  onError={handleCamImgError}
                  style={{
                    width: "100%", height: "100%", objectFit: "cover",
                    position: "absolute", top: 0, left: 0,
                    display: mainView === "camera" ? "block" : "none",
                  }}
                />
              )}

              {/* MAIN MAP (CanvasMap) */}
              {mainView === "map" && (
                <CanvasMap
                  ref={mainMapRef}
                  config={OCC_GRID_CONFIG}
                  robotPos={robotPos}
                  showRobot={robotConnected}
                  interactive
                />
              )}
            </div>
          </div>
          <div className={`${styles.zoomBtnBox} ${isOverlayReady ? styles.overlayVisible : styles.overlayHidden}`}>
            <div className={styles.zoomBtn} onClick={() => {
              if (isMainMap) mainMapRef.current?.handleZoom("in");
              else setScale(s => Math.min(s + 0.2, 3));
            }}>
              <img src="/icon/zoom_in_w.png" />
            </div>
            <div className={styles.zoomBtn} onClick={() => {
              if (isMainMap) mainMapRef.current?.handleZoom("out");
              else setScale(s => Math.max(s - 0.2, 0.5));
            }}>
              <img src="/icon/zoom_out_w.png" />
            </div>
            <div className={styles.zoomBtn} onClick={() => {
              if (isMainMap) mainMapRef.current?.handleZoom("reset");
              else { setScale(1); setTranslate({ x: 0, y: 0 }); }
            }} title="되돌리기">
              <span style={{ fontSize: 'var(--font-size-lg)', lineHeight: 1 }}>↻</span>
            </div>
          </div>
        </div>

        {/* Bottom Control */}
        <div className={styles.bottomPosition}>
          <div className={styles.bottomFlex}>

            <RemotePad primaryView={isMainMap ? "map" : "camera"} />

            <div className={styles.middleBtnTotal}>
              <div className={styles.middleBtnTop}>
                <div className={styles.modeBtnCommonBox}>
                  <div>모드</div>
                  <div className={styles.standSitBtn}>
                    <div onClick={standHandle}>Stand</div>
                    <div onClick={sitHandle}>Sit</div>
                  </div>
                </div>
                <div className={styles.modeBtnCommonBox}>
                  <div>속도</div>
                  <div className={styles.speedBtn}>
                    <div onClick={slowHandle}>Slow</div>
                    <div onClick={normalHandle}>Normal</div>
                    <div onClick={fastHandle}>Fast</div>
                  </div>
                </div>
              </div>
              <div className={styles.middleBtnBottom}>
                <div className={styles.freshBtnTitle}>조명</div>
                <div className={styles.freshBtnFlex}>
                  <div className={styles.freshBtnSubtitle}>전방</div>
                  <div className={`${styles.freshBtn} ${styles.freshBtnFlex} ${styles.freshBtnFront}`}>
                    <div
                      className={`${styles.freshBtnMr8} ${styles.freshOn} ${flashFront === "on" ? styles.active : ""}`}
                      onClick={() => handleFlashFront("on")}
                    >On</div>
                    <div
                      className={`${styles.freshOff} ${flashFront === "off" ? styles.active : ""}`}
                      onClick={() => handleFlashFront("off")}
                    >Off</div>
                  </div>
                  <div className={styles.freshBtnSubtitle}>후방</div>
                  <div className={`${styles.freshBtn} ${styles.freshBtnFlex}`}>
                    <div
                      className={`${styles.freshBtnMr8} ${styles.freshOn} ${flashRear === "on" ? styles.active : ""}`}
                      onClick={() => handleFlashRear("on")}
                    >On</div>
                    <div
                      className={`${styles.freshOff} ${flashRear === "off" ? styles.active : ""}`}
                      onClick={() => handleFlashRear("off")}
                    >Off</div>
                  </div>
                </div>
              </div>
            </div>

            {/* PIP VIEW */}
            <div className={styles.viewBox} style={{ overflow: "hidden", position: "relative" }}>
              {/* PIP Loading */}
              {isCamLoading && !camError && pipView === "camera" && (
                <div className={styles.pipLoadingOverlay}>
                  <div className={styles.pipLoadingSpinner} />
                </div>
              )}

              {/* PIP Error */}
              {camError && pipView === "camera" && (
                <div className={styles.pipErrorOverlay}>
                  <span className={styles.pipErrorText}>연결 실패</span>
                </div>
              )}

              {/* PIP CAMERA */}
              {activeCam === 3 && thermalUrl ? (
                <img
                  src={thermalUrl}
                  style={{
                    width: "100%", height: "100%", objectFit: "cover",
                    display: pipView === "camera" ? "block" : "none",
                    position: "absolute", top: 0, left: 0,
                  }}
                />
              ) : (
                <img
                  src={cameraStream}
                  style={{
                    width: "100%", height: "100%", objectFit: "cover",
                    display: pipView === "camera" ? "block" : "none",
                    position: "absolute", top: 0, left: 0,
                  }}
                />
              )}

              {/* PIP MAP (CanvasMap - non-interactive) */}
              {pipView === "map" && (
                <CanvasMap
                  config={OCC_GRID_CONFIG}
                  robotPos={robotPos}
                  showRobot={robotConnected}
                  robotMarkerSize={14}
                  interactive={false}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                />
              )}

              <div className={styles.Floors}>1F</div>
              <div className={styles.pipLabel}>{pipView === "camera" ? "카메라" : "맵"}</div>
              <div className={styles.viewExchangeBtn} onClick={handleSwapView} title="화면 전환">
                <img src="/icon/view-change.png" alt="swap" key={retryKey} onError={handleImgError} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
