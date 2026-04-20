"use client";

import styles from "./RobotMarker.module.css";

type RobotMarkerProps = {
  screenX: number;
  screenY: number;
  yaw?: number;
  name?: string;
  size?: number;
  scale?: number;
};

export default function RobotMarker({
  screenX,
  screenY,
  yaw = 0,
  name,
  size = 34,
  scale = 1,
}: RobotMarkerProps) {
  const inverseScale = 1 / scale;

  // yaw(rad)→degree 변환. 화면좌표 Y축 반전으로 부호 반전 필요
  const rotationDeg = -(yaw * 180) / Math.PI;

  return (
    <div
      className={styles.marker}
      style={{
        left: screenX,
        top: screenY,
        transform: `translate(-50%, -50%) scale(${inverseScale})`,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{
          transform: `rotate(${rotationDeg}deg)`,
        }}
      >
        <polygon
          points="2,4 22,12 2,20 6,12"
          fill="#1A73E8"
          stroke="#1557B0"
          strokeWidth="1"
        />
      </svg>
      {name && <span className={styles.name}>{name}</span>}
    </div>
  );
}
