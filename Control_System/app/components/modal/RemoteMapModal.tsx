'use client';

import styles from './Modal.module.css';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { RobotRowData, Video, Camera, PrimaryViewType } from '@/app/type';
import { VideoStatus, RemotePad, ModalRobotSelect } from '@/app/components/button';

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

/* --- map.yaml load --- */
type MapInfo = {
  resolution: number;
  origin: number[];
  width: number;
  height: number;
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
  const [cameraStream, setCameraStream] = useState("http://localhost:8000/Video/1");

  //"open 시 1회 초기화” + “모달 내 변경은 유지” 적용
  const didInitOnOpenRef = useRef(false);
  const userTouchedCamRef = useRef(false);

  //fresh
  const [flashFront, setFlashFront] = useState<"on" | "off">("off");
  const [flashRear, setFlashRear] = useState<"on" | "off">("off");

  
  // camera/map swap 상태
  const [isSwapped, setIsSwapped] = useState(false);

  
  // swap 전환 시 mainView 타입에 다르게 적용
  const mainView: "camera" | "map" = isSwapped ? (primaryView === "camera" ? "map" : "camera") : primaryView;
  const pipView: "camera" | "map" = mainView === "camera" ? "map" : "camera";
  const isMainMap = mainView === "map";
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLImageElement | null>(null);
  // const mapImage = "/map/occ_grid.png";
  const mapImage = "/map/occ_grid.png";

  const [thermalUrl, setThermalUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevObjectUrlRef = useRef<string | null>(null);

  // map.yaml 정보
  const [mapInfo, setMapInfo] = useState<MapInfo | null>(null);

  const connectThermalWS = () => {
    if (wsRef.current) wsRef.current.close();

    const ws = new WebSocket("ws://10.21.41.29:8765");
    wsRef.current = ws;

    ws.onopen = () => console.log("🔥 Thermal WS Connected");
    ws.onerror = (e) => console.error("🔥 Thermal WS Error", e);

    ws.onmessage = (e) => {
      if (e.data instanceof Blob) {
        const nextUrl = URL.createObjectURL(e.data);

        if (prevObjectUrlRef.current)
          URL.revokeObjectURL(prevObjectUrlRef.current);

        prevObjectUrlRef.current = nextUrl;
        setThermalUrl(nextUrl);
      }
    };

    ws.onclose = () => {
      console.log("🔥 Thermal WS Closed");
    };
  };

  // zoom & pan 상태
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const handleImgError = () => {
    setTimeout(() => {
      setRetryKey(prev => prev + 1);
    }, 1000); // 1초 뒤 재시도
  };

   
  /* --- FastAPI robot position --- */
  const [robotPos, setRobotPos] = useState({ x: 0, y: 0, yaw: 0 });
  const [robotStatus, setRobotStatus] = useState<RobotStatus>({
    battery: {}
  });

  // 로봇 위치 주기적 갱신
  // useEffect(() => {
  //   const fetchRobotPos = () => {
  //     fetch("http://localhost:8000/robot/position")
  //       .then(res => res.json())
  //       .then(data => setRobotPos(data))
  //       .catch(() => {});
  //   };

  //   fetchRobotPos();
  //   const interval = setInterval(fetchRobotPos, 1000);
  //   return () => clearInterval(interval);
  // }, []);

  // map.yaml 파일 로드
  // useEffect(() => {
  //   fetch("/map/occ_grid.yaml")
  //     .then(res => res.text())
  //     .then(text => {
  //       const obj: Record<string, string> = {};
  //       text.split("\n").forEach(line => {
  //         const [key, value] = line.split(":");
  //         if (!key || !value) return;
  //         obj[key.trim()] = value.trim();
  //       });

  //       const origin = obj["origin"]
  //         .replace("[", "")
  //         .replace("]", "")
  //         .split(",")
  //         .map(Number);

  //       setMapInfo({
  //         resolution: parseFloat(obj["resolution"]),
  //         origin,
  //         width: parseInt(obj["width"]),
  //         height: parseInt(obj["height"])
  //       });
  //     });
  // }, []);


  /* --- map render size --- */
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 });

  // 최초 렌더 + 리사이즈
  useEffect(() => {
    if (!mapRef.current) return;

    const updateSize = () => {
      setMapSize({
        w: mapRef.current!.clientWidth,
        h: mapRef.current!.clientHeight
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // PIP → Main 전환 시 mapSize 재계산
  useEffect(() => {
    if (!mapRef.current) return;

    const timer = setTimeout(() => {
      setMapSize({
        w: mapRef.current!.clientWidth,
        h: mapRef.current!.clientHeight
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen, isSwapped, primaryView]);

  /* --- world → pixel --- */
  const mapResolution = 0.1;
  const mapOriginX = -19.9;
  const mapOriginY = -18.4;
  const mapPixelWidth = 427;
  const mapPixelHeight = 319;

  const offsetX = 0;
  const offsetY = 0;

  const worldToPixel = (x: number, y: number) => {
    const pixelX = (x - mapOriginX) / mapResolution;
    const pixelY = (y - mapOriginY) / mapResolution;

    const screenX = pixelX * (mapSize.w / mapPixelWidth);
    const screenY = mapSize.h - (pixelY * (mapSize.h / mapPixelHeight));

    return {
      x: screenX + offsetX,
      y: screenY + offsetY
    };
  };

  const robotScreenPos = useMemo(() => {
    if (mapSize.w === 0 || mapSize.h === 0) {
      return { x: -9999, y: -9999 };
    }
    return worldToPixel(robotPos.x, robotPos.y);
  }, [robotPos, mapSize]);

  const pipMapRef = useRef<HTMLDivElement | null>(null);
  const [pipSize, setPipSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!pipMapRef.current) return;

    const update = () => {
      setPipSize({
        w: pipMapRef.current!.clientWidth,
        h: pipMapRef.current!.clientHeight
      });
    };
    
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!pipMapRef.current) return;

    // PIP가 나타난 뒤 DOM이 안정되면 계산
    const timer = setTimeout(() => {
      setPipSize({
        w: pipMapRef.current!.clientWidth,
        h: pipMapRef.current!.clientHeight
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [isSwapped]);

  const pipRobotPos = useMemo(() => {
    if (pipSize.w === 0 || pipSize.h === 0) return { x: -9999, y: -9999 };

    const pixelX = (robotPos.x - mapOriginX) / mapResolution;
    const pixelY = (robotPos.y - mapOriginY) / mapResolution;

    const screenX = pixelX * (pipSize.w / mapPixelWidth);
    const screenY = pipSize.h - (pixelY * (pipSize.h / mapPixelHeight));

    return { x: screenX, y: screenY };
  }, [robotPos, pipSize]);

  useEffect(() => {
  if (!isOpen) return;
  if (!pipMapRef.current) return;

  const timer = setTimeout(() => {
    setPipSize({
      w: pipMapRef.current!.clientWidth,
      h: pipMapRef.current!.clientHeight
    });
  }, 100);

  return () => clearTimeout(timer);
}, [isOpen]);

useEffect(() => {
  const handleOutsideClick = (e: MouseEvent) => {
    if (
      camWrapperRef.current &&
      !camWrapperRef.current.contains(e.target as Node)
    ) {
      setIsCamOpen(false); // 외부 클릭 → 닫기
    }
  };

  document.addEventListener("mousedown", handleOutsideClick);

  return () => {
    document.removeEventListener("mousedown", handleOutsideClick);
  };
}, []);

// useEffect(() => {
//   const fetchStatus = () => {
//     fetch("http://localhost:8000/robot/status")
//       .then(res => res.json())
//       .then(data => setRobotStatus(data))
//       .catch(() => {});
//   };

//   fetchStatus();
//   const timer = setInterval(fetchStatus, 1000);
//   return () => clearInterval(timer);
// }, []);
  
const batteryPercentage =
  robotStatus.battery?.BatteryLevelRight ??
  robotStatus.battery?.BatteryLevelLeft ??
  0;
  /* --- robot selector --- */
  useEffect(() => {
    setSelectedRobot(selectedRobots);
    if (selectedRobots) {
      const idx = robots.findIndex(r => r.id === selectedRobots.id);
      if (idx !== -1) setRobotActiveIndex(idx);
    }
  }, [selectedRobots, robots]);
  
  // ---------------------------
  // Drag & Zoom Control
  // ---------------------------

  // camera/map zoom in/out 기능 분기 처리
  const cameraImgRef = useRef<HTMLImageElement | null>(null);
  const getActiveImg = () => (isMainMap ? innerRef.current : cameraImgRef.current);

  const clampTranslate = (nx: number, ny: number) => {
    const wrap = wrapperRef.current;
    const img = getActiveImg(); 
    if (!wrap || !img) return { x: nx, y: ny };

    const wrapW = wrap.clientWidth;
    const wrapH = wrap.clientHeight;

    const baseW = img.clientWidth;
    const baseH = img.clientHeight;

    const scaledW = baseW * scale;
    const scaledH = baseH * scale;

    const maxOffsetX = Math.max(0, (scaledW - wrapW) / 2);
    const maxOffsetY = Math.max(0, (scaledH - wrapH) / 2);

    const clamp = (v: number, min: number, max: number) =>
      Math.min(Math.max(v, min), max);

    return {
      x: clamp(nx, -maxOffsetX, maxOffsetX),
      y: clamp(ny, -maxOffsetY, maxOffsetY),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;

    const img = getActiveImg();
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;

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

  const handleSwapView = () => {
    setIsSwapped(prev => !prev);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setIsPanning(false);
  };

  useEffect(() => {
    setTranslate(prev => clampTranslate(prev.x, prev.y));
  }, [scale]);

  /* --- close modal --- */
  const handleClose = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setIsPanning(false);
    setIsSwapped(false);
    setCameraTabActiveIndex(0);

    setSelectedRobot(selectedRobots);
    onClose();
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);


  /* --- robot control API --- */
  const standHandle = () => fetch("http://localhost:8000/robot/stand", { method: "POST" });
  const sitHandle = () => fetch("http://localhost:8000/robot/sit", { method: "POST" });
  const slowHandle = () => fetch("http://localhost:8000/robot/slow", { method: "POST" });
  const normalHandle = () => fetch("http://localhost:8000/robot/normal", { method: "POST" });
  const fastHandle = () => fetch("http://localhost:8000/robot/fast", { method: "POST" });
  const handleWorkStart = () => fetch("http://localhost:8000/nav/startmove", {method: "POST"});
  const handlesavePoint = () => fetch("http://localhost:8000/nav/savepoint", {method: "POST"});

// fresh
type FlashTarget = "front" | "rear";
type FlashValue = "on" | "off";

const sendFlashCommand = async (target: FlashTarget, value: FlashValue) => {
  if(target == "front")
  {
    console.log("front");
    if(value == "on") { fetch("http://localhost:8000/robot/front_on", { method: "POST" }); }
    else{ fetch("http://localhost:8000/robot/front_off", { method: "POST" }); }
  }
  else
  {
    console.log("rear");
    if(value == "on") { fetch("http://localhost:8000/robot/rear_on", { method: "POST" }); }
    else{ fetch("http://localhost:8000/robot/rear_off", { method: "POST" }); }
  }
};

const handleFlashFront = (value: FlashValue) => {
  if (flashFront === value) return; // 동일 값 클릭 방지
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
  // const handleCameraTab = (idx: number, camId: number) => {
  //   setSelectedCam(camId);
  //   setCameraTabActiveIndex(idx);

  //   const newUrl = `http://localhost:8000/Video/${camId}`;
  //   setCameraStream(newUrl);
  //   setIsCamOpen(false);
  // };

  /* --- camera tab --- */
const handleCameraTab = (idx: number, cam: Camera) => {
  setSelectedCam(cam.id);
  setActiveCam(cam.id);
  setCameraTabActiveIndex(idx);

  // 🔥 3번 카메라 = Thermal
  if (cam.id === 3) {
    console.log("🔥 Thermal Camera Selected");
    setThermalUrl(null);
    connectThermalWS();
    setIsCamOpen(false);
    return;
  }

  // 🔹 일반 MJPEG 카메라
  if (wsRef.current) wsRef.current.close();
  setThermalUrl(null);

  const nextUrl = cam.webrtcUrl || `http://localhost:8000/Video/${cam.id}`;
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

  // ✅ 이미 open 이후 초기화가 끝났고, 사용자가 모달에서 CAM을 바꿨다면 덮어쓰지 않음
  if (didInitOnOpenRef.current && userTouchedCamRef.current) return;

  // ✅ open 시 1회만 초기화
  if (didInitOnOpenRef.current) return;
  didInitOnOpenRef.current = true;

  // 우선순위: initialCam → activeCam → camera[0]
  const baseCam =
    initialCam ??
    camera.find((c) => c.id === activeCam) ??
    camera[0];

  if (!baseCam) return;

  const nextIdx =
    typeof initialCamIndex === "number"
      ? initialCamIndex
      : Math.max(0, camera.findIndex((c) => c.id === baseCam.id));

  setSelectedCam(baseCam.id);
  setActiveCam(baseCam.id);
  setCameraTabActiveIndex(nextIdx);

  const nextUrl = baseCam.webrtcUrl || `http://localhost:8000/Video/${baseCam.id}`;
  setCameraStream(nextUrl);
  setIsCamOpen(false);
}, [isOpen, initialCam?.id, initialCamIndex, camera, activeCam]);


  // ---------------------------
  // UI
  // ---------------------------

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.remonteModalContent} onClick={(e) => e.stopPropagation()}>

        {/* TOP */}
        <div className={styles.modalTopDiv}>
          <div className={styles.modalTitle}>
            <img src="/icon/robot_control_w.png" alt="robot_control" key={retryKey} onError={handleImgError} />
            <div>원격 제어 <span>(실시간 카메라 및 위치 맵)</span></div>
          </div>
          <div>
            <button type='button' className={styles.workStart} onClick={handlesavePoint}>위치 저장</button>
            <button type='button' className={styles.workStart} onClick={handleWorkStart}>작업 시작</button>
            <button type='button' className={styles.closeBtn} onClick={handleClose}>✕</button>
          </div>
        </div>

        {/* MAIN CAMERA / MAP AREA */}
        <div className={styles.cameraView}>

          {/* Robot Select / Status */}
          <div className={styles.topPosition}>
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

          {/* camera selectBox */}
          <div ref={camWrapperRef} className={styles.modalCamSeletWrapper}>
            <div
              className={styles.modalCamSelect}
              onClick={() => setIsCamOpen((p) => !p)}
            >
              <span>{selectedCamLabel}</span>
              {isCamOpen ? (
                <img src="/icon/arrow_up.png" alt="arrow up" />
              ) : (
                <img src="/icon/arrow_down.png" alt="arrow down" />
              )}
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

                          {/* <div className={`${styles.viewBtn} ${styles.mt50}`}>
                <div className={`${styles.mb10} ${ isMainMap ? styles.mapCategoryTitle : styles.categoryTitle }`.trim()}>CAMERA</div>

                <div className={`${styles.camBtn} ${styles.mb20} ${ isMainMap ? styles.mapCamBtn : styles.camBtn }`.trim()}>
                  {camera.map((cam, idx) => (
                    <div
                      key={cam.id}
                      className={`${styles.camItem} ${cameraTabActiveIndex === idx ? styles.active : ""}`}
                      onClick={() => handleCameraTab(idx, cam.id)}
                    >
                      {cam.label}
                    </div>
                  ))}
                </div>

                
                </div> */}

            <div className={styles.topRightPostion}>
              <div className={styles.topRightIcon}>
                <VideoStatus className={styles.videoStatusCustom} video={video} primaryView={isMainMap ? "map" : "camera"} />

                <div className={styles.robotStatus}>
                  <img src={"/icon/online_w.png"} alt="net" key={retryKey} onError={handleImgError} />
                  <div>Online</div>
                </div>

                <div className={styles.robotStatus}>
                  <img src={"/icon/battery_full_w.png"} alt="battery" key={retryKey} onError={handleImgError} />
                  <div>{batteryPercentage}%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Swappable Camera/Map View */}
          <div className={styles["video-box"]} style={{ width: "100%", aspectRatio: "16/9", position: "relative" }}>
            <div
              ref={wrapperRef}
              style={{
                width: "100%",
                height: "100%",
                position: "relative",
                background: mainView === "map" ? "rgb(128, 128, 128)" : "transparent",
                overflow: "hidden",
                userSelect: "none",
                touchAction: "none",
                cursor: scale > 1 ? (isPanning ? "grabbing" : "grab") : "default"
              }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={endPan}
              onMouseLeave={endPan}
            >

              {/* MAIN CAMERA */}
              {activeCam === 3 && thermalUrl ? (
                <img
                  src={thermalUrl}
                  ref={cameraImgRef}
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    display: mainView === "camera" ? "block" : "none",
                  }}
                />
              ) : (
                <img
                  ref={cameraImgRef}
                  src={cameraStream}
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    display: mainView === "camera" ? "block" : "none",
                  }}
                />
              )}

              {/* 👇 INNER WRAPPER (지도 + 마커 같이 움직임) */}
              <div
                ref={innerRef}
                style={{
                  width: "100%",
                  height: "100%",
                  position: "relative",
                  transform: mainView === "map"
                    ? `translate(${translate.x}px, ${translate.y}px) scale(${scale})`
                    : "none",
                  transformOrigin: "center center",
                  transition: isPanning ? "none" : "transform 120ms ease"
                }}
              >

                  {/* MAIN MAP */}
                  <img
                    ref={mapRef}
                    src={mapImage}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      position: "absolute",
                      top: 0,
                      left: 0,
                      display: mainView === "map" ? "block" : "none",
                      pointerEvents: "none",
                      zIndex: 0
                    }}
                  />

                  {/* ROBOT MARKER */}
                  <img
                    src="/icon/robot_location(1).png"
                    style={{
                      position: "absolute",
                      left: `${robotScreenPos.x}px`,
                      top: `${robotScreenPos.y}px`,
                      height: "45px",
                      transform: "translate(-50%, -50%)",
                      zIndex: 20,
                      display: mainView === "map" ? "block" : "none",
                      pointerEvents: "none"
                    }}
                  />

              </div>

            </div>
          </div>
          <div className={styles.zoomBtnBox}>
            <div className={styles.zoomBtn} onClick={() => setScale(s => Math.min(s + 0.2, 3))}>
              <img src={`/icon/zoom_in_w.png`} />
            </div>
            <div className={styles.zoomBtn} onClick={() => setScale(s => Math.max(s - 0.2, 0.5))}>
              <img src={`/icon/zoom_out_w.png`} />
            </div>
          </div>
        </div>

          {/* Bottom Control */}
          <div className={styles.bottomPosition}>
            <div className={styles.bottomFlex}>

              <RemotePad primaryView={isMainMap ? "map" : "camera"}/>

              <div className={styles.middleBtnTotal}>
                <div className={styles.middleBtnTop}>
                  <div className={styles.modeBtnCommonBox}>
                    <div>MODE</div>
                    <div className={styles.standSitBtn}>
                      <div onClick={standHandle}>Stand</div>
                      <div onClick={sitHandle}>Sit</div>
                    </div>
                  </div>

                  <div className={styles.modeBtnCommonBox}>
                    <div>SPEED</div>
                    <div className={styles.speedBtn}>
                      <div onClick={slowHandle}>Slow</div>
                      <div onClick={normalHandle}>Normal</div>
                      <div onClick={fastHandle}>Fast</div>
                    </div> 
                  </div>
                </div>
                <div className={styles.middleBtnBottom}>
                  <div className={styles.freshBtnTitle}>FLASH</div>
                  <div className={styles.freshBtnFlex}>
                    <div className={styles.freshBtnSubtitle}>Front</div>
                    <div className={`${styles.freshBtn} ${styles.freshBtnFlex} ${styles.freshBtnFront}`}>
                      <div
                        className={`${styles.freshBtnMr8} ${styles.freshOn} ${flashFront === "on" ? styles.active : ""}`}
                        onClick={() => handleFlashFront("on")}
                      >
                        On
                      </div>
                      <div
                        className={`${styles.freshOff} ${flashFront === "off" ? styles.active : ""}`}
                        onClick={() => handleFlashFront("off")}
                      >
                        Off
                      </div>
                    </div>
                    <div className={styles.freshBtnSubtitle}>Rear</div>
                    <div className={`${styles.freshBtn} ${styles.freshBtnFlex}`}>
                      <div
                        className={`${styles.freshBtnMr8} ${styles.freshOn} ${flashRear === "on" ? styles.active : ""}`}
                        onClick={() => handleFlashRear("on")}
                      >
                        On
                      </div>
                      <div
                        className={`${styles.freshOff} ${flashRear === "off" ? styles.active : ""}`}
                        onClick={() => handleFlashRear("off")}
                      >
                        Off
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              
              {/* PIP VIEW */}
              <div className={styles.viewBox} style={{ 
                overflow: "hidden",
                position: "relative",
                
                }}>
                {/* PIP CAMERA */}
                {activeCam === 3 && thermalUrl ? (
                  <img
                    src={thermalUrl}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: pipView === "camera" ? "block" : "none",
                      position: "absolute",
                      top: 0,
                      left: 0
                    }}
                  />
                ) : (
                  <img
                    src={cameraStream}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: pipView === "camera" ? "block" : "none",
                      position: "absolute",
                      top: 0,
                      left: 0
                    }}
                  />
                )}
              {/* PIP MAP (지도 + 마커 세트) */}
                <div
                  ref={pipMapRef}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    background: pipView === "map" ? "rgb(128, 128, 128)" : "transparent",
                    display: pipView === "map" ? "block" : "none",
                    position: "absolute",
                    top: 0,
                    left: 0,
                  }}
                >
                  {/* 지도 */}
                  <img
                    src={mapImage}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      position: "absolute",
                      top: 0,
                      left: 0
                    }}
                  />

                  {/* 로봇 마커 */}
                  <img
                    src="/icon/robot_location(1).png"
                    style={{
                      position: "absolute",
                      left: `${pipRobotPos.x}px`,
                      top: `${pipRobotPos.y}px`,
                      // width: "20px",
                      height: "25px",
                      transform: "translate(-50%, -50%)",
                      pointerEvents: "none",
                      zIndex: 10
                    }}
                  />
                </div>
          
                <div className={styles.Floors}>1F</div>

                <div className={styles.viewExchangeBtn} 
                onClick={() => {
                  handleSwapView();
                }}>
                  <img src={"/icon/view-change.png"} alt="swap" key={retryKey} onError={handleImgError}/>
                </div>

              </div>
            </div>
          </div>
      </div>
    </div>
  );
}
