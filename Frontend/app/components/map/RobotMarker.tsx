"use client";

import styles from "./RobotMarker.module.css";

type RobotMarkerProps = {
  screenX: number;
  screenY: number;
  yaw?: number;
  size?: number;
  scale?: number;
};

export default function RobotMarker({
  screenX,
  screenY,
  yaw = 0,
  size = 20,
  scale = 1,
}: RobotMarkerProps) {
  const compensated = size / Math.sqrt(scale);
  const clampedSize = Math.max(18, Math.min(36, compensated));

  // yaw(rad)→degree 변환. 화면좌표 Y축 반전으로 부호 반전 필요
  const rotationDeg = -(yaw * 180) / Math.PI;

  return (
    <svg
      width={clampedSize}
      height={clampedSize}
      viewBox="0 0 24 24"
      style={{
        left: screenX,
        top: screenY,
        transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
        pointerEvents: "none",
        zIndex: 20,
      }}
    >
      <polygon
        points="2,4 22,12 2,20 6,12"
        fill="#E53E3E"
        stroke="#C53030"
        strokeWidth="1"
      />
    </svg>
  );
}
