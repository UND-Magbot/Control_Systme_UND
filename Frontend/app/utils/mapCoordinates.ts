import type { MapConfig } from "@/app/components/map/types";

export function worldToPixel(
  worldX: number,
  worldY: number,
  config: MapConfig,
  renderSize: { w: number; h: number }
): { x: number; y: number } {
  const px = (worldX - config.originX) / config.resolution;
  const py = (worldY - config.originY) / config.resolution;
  return {
    x: px * (renderSize.w / config.pixelWidth),
    y: renderSize.h - py * (renderSize.h / config.pixelHeight),
  };
}

export function pixelToWorld(
  pixelX: number,
  pixelY: number,
  config: MapConfig,
  renderSize: { w: number; h: number }
): { x: number; y: number } {
  const worldX =
    config.originX +
    (pixelX / (renderSize.w / config.pixelWidth)) * config.resolution;
  const worldY =
    config.originY +
    ((renderSize.h - pixelY) / (renderSize.h / config.pixelHeight)) *
      config.resolution;
  return { x: worldX, y: worldY };
}
