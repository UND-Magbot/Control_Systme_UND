export type MapConfig = {
  imageSrc: string;
  resolution: number;
  originX: number;
  originY: number;
  pixelWidth: number;
  pixelHeight: number;
};

export type RobotPosition = {
  x: number;
  y: number;
  yaw: number;
};

export type POICategory = "work" | "charge" | "standby" | "waypoint" | "danger";

export type POIItem = {
  id: number;
  name: string;
  x: number;
  y: number;
  floor: string;
  floorId?: number | null;
  mapId?: number | null;
  category?: POICategory;
  isSelected?: boolean;
  icon?: string;
};

export type NavPathSegment = {
  from: { x: number; y: number; name?: string };
  to: { x: number; y: number; name?: string };
  direction: "one-way" | "two-way";
  waypoints?: { x: number; y: number }[];
};

export type NavPath = {
  segments: NavPathSegment[];
};

export type MapView = "2d" | "3d";

export type RobotOnMap = {
  id: number;
  name: string;
  position: RobotPosition;
  /** 위치 미확정(localization 발산/리셋 등) — true면 마지막 신뢰 위치에 '미확정' 스타일로 표시. */
  uncertain?: boolean;
};

export type CanvasMapProps = {
  config: MapConfig;
  view?: MapView;
  robotPos?: RobotPosition | null;
  robotName?: string;
  /** 다중 로봇 표시 (이 값이 있으면 robotPos/robotName 무시) */
  robots?: RobotOnMap[];
  pois?: POIItem[];
  navPath?: NavPath | null;
  selectedPoiId?: number | null;
  floor?: string;
  showRobot?: boolean;
  robotMarkerSize?: number;
  showPois?: boolean;
  showPath?: boolean;
  showLabels?: boolean;
  onPoiClick?: (poi: POIItem) => void;
  onPoiNavigate?: (poi: POIItem) => void;
  /** 3D 전용 — 추적 POI 지정 시 스크린 좌표를 onTrackedPoiScreen으로 지속 전달 */
  trackedPoi?: { x: number; y: number } | null;
  onTrackedPoiScreen?: (screen: { x: number; y: number; behind: boolean } | null) => void;
  onMapClick?: (worldCoords: { x: number; y: number }) => void;
  onMapMouseMove?: (worldCoords: { x: number; y: number }) => void;
  /** 위치 재조정용 — 정합 스캔 점군(월드 좌표 [x,y][]) 을 맵 위에 오버레이 */
  scanPoints?: number[][];
  /** 위치 재조정용 — 운영자가 지정 중인 pose 화살표. (x,y)=시작(위치), yaw=방향.
   *  toX/toY 가 있으면 시작→(toX,toY)로 늘어나는 rviz식 드래그 화살표로 그린다(없으면 고정 길이). */
  poseArrow?: { x: number; y: number; yaw: number; toX?: number; toY?: number } | null;
  /** 위치 재조정용 — rviz식 pose 드래그 모드. true면 드래그 팬을 끄고 누른 지점=위치, 끌기=방향. */
  poseDrawMode?: boolean;
  /** poseDrawMode — 드래그 시작(누른 지점, 월드 좌표) */
  onPoseDragStart?: (worldCoords: { x: number; y: number }) => void;
  /** poseDrawMode — 드래그 중(현재 커서, 월드 좌표) */
  onPoseDrag?: (worldCoords: { x: number; y: number }) => void;
  /** poseDrawMode — 드래그 종료(뗌) */
  onPoseDragEnd?: () => void;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};
