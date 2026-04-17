import type { MapConfig } from "./types";
import { API_BASE } from "@/app/config";

export const OCC_GRID_CONFIG: MapConfig = {
  imageSrc: `${API_BASE}/static/maps/gumi-v1.png`,
  resolution: 0.1,
  originX: -11,
  originY: -15.9,
  pixelWidth: 335,
  pixelHeight: 450,
};

export const TEST_MAP_CONFIG = OCC_GRID_CONFIG;