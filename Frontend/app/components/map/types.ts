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
  onMapClick?: (worldCoords: { x: number; y: number }) => void;
  onMapMouseMove?: (worldCoords: { x: number; y: number }) => void;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};
