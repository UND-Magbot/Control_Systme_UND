import type { MapConfig } from "@/app/components/map/types";

/**
 * World 좌표 → Three.js 3D 좌표 변환
 * World: (x, y) in meters
 * Three.js: X-right, Y-up, Z-toward-camera → 바닥은 XZ 평면
 *
 * 맵 중심을 (0, 0, 0)에 배치하여 카메라/컨트롤 설정 단순화
 */
export function worldTo3D(
  worldX: number,
  worldY: number,
  config: MapConfig
): { x: number; y: number; z: number } {
  const mapWidthM = config.pixelWidth * config.resolution;
  const mapHeightM = config.pixelHeight * config.resolution;
  const centerX = config.originX + mapWidthM / 2;
  const centerY = config.originY + mapHeightM / 2;

  return {
    x: worldX - centerX,
    y: 0,
    z: -(worldY - centerY),
  };
}

/**
 * 맵 크기(미터) 반환
 */
export function getMapDimensions(config: MapConfig): { width: number; height: number } {
  return {
    width: config.pixelWidth * config.resolution,
    height: config.pixelHeight * config.resolution,
  };
}
