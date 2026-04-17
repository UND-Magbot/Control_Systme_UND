import type { MapConfig } from "./types";
import { getApiBase } from "@/app/config";

export function getOccGridConfig(): MapConfig {
  return {
    imageSrc: `${getApiBase()}/static/maps/gumi-v1.png`,
    resolution: 0.1,
    originX: -11,
    originY: -15.9,
    pixelWidth: 335,
    pixelHeight: 450,
  };
}

/** @deprecated getOccGridConfig() 사용 권장 */
export const OCC_GRID_CONFIG: MapConfig = {
  imageSrc: "/static/maps/gumi-v1.png",
  resolution: 0.1,
  originX: -11,
  originY: -15.9,
  pixelWidth: 335,
  pixelHeight: 450,
};

export const TEST_MAP_CONFIG = OCC_GRID_CONFIG;
