import type { PendingPlace } from "../components/tabs/map/MapPlaceCreateModal";

export type MapTab = "map" | "place" | "path";

export type MappingState =
  | "idle"
  | "startModal"
  | "mappingModal"
  | "success"
  | "saveModal";

export type Business = {
  id: number;
  BusinessName: string;
};

export type FloorItem = {
  id: number;
  BusinessId: number;
  FloorName: string;
};

export type RobotMap = {
  id: number;
  BusinessId: number;
  FloorId: number;
  MapName: string;
  PgmFilePath: string;
  ImgFilePath: string;
};

export type Robot = {
  id: number;
  RobotName: string;
  ModelName: string;
  SerialNumber: string;
  CurrentFloorId: number | null;
  CurrentMapId?: number | null;
};

export type RouteDirection = "forward" | "reverse" | "bidirectional";

export type RouteSegment = {
  tempId: string;
  startName: string;
  endName: string;
  direction: RouteDirection;
};

export type DbRoute = {
  id: number;
  MapId: number;
  StartPlaceName: string;
  EndPlaceName: string;
  Direction: string;
};

export type UndoAction =
  | { type: "addPlace"; tempId: string }
  | {
      type: "deletePendingPlace";
      place: PendingPlace;
      cascadedDbRoutes: number[];
      cascadedPendingRoutes: RouteSegment[];
    }
  | {
      type: "deleteDbPlace";
      id: number;
      cascadedDbRoutes: number[];
      cascadedPendingRoutes: RouteSegment[];
    }
  | { type: "addRoute"; tempId: string }
  | { type: "deletePendingRoute"; route: RouteSegment }
  | { type: "deleteDbRoute"; id: number }
  | {
      type: "mapReset";
      prevPendingPlaces: PendingPlace[];
      prevPendingRoutes: RouteSegment[];
      prevDeletedDbIds: Set<number>;
      prevDeletedRouteDbIds: Set<number>;
      prevMovedPlaces: Map<string, { x: number; y: number }>;
      prevModifiedDbIds: Set<number>;
    };
