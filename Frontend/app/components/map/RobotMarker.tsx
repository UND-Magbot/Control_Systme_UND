"use client";

import styles from "./RobotMarker.module.css";

type RobotMarkerProps = {
  screenX: number;
  screenY: number;
  yaw?: number;
  name?: string;
  size?: number;
  scale?: number;
  /** 위치 미확정 — 마지막 신뢰 위치에 회색·반투명 '미확정' 스타일로 표시. */
  uncertain?: boolean;
};

export default function RobotMarker({
  screenX,
  screenY,
  yaw = 0,
  name,
  size = 34,
  scale = 1,
  uncertain = false,
}: RobotMarkerProps) {
  const inverseScale = 1 / scale;

  // yaw(rad)→degree 변환. 화면좌표 Y축 반전(py=h-...)으로 부호 반전(-yaw)이면 화살촉이 전방을 향함.
  // (ERR-05의 +180° 보정은 ERR-04 증상에 오염된 오진으로 과보정이라 원복 — 카메라=전방 대조 시 후방을 가리켰음)
  const rotationDeg = -(yaw * 180) / Math.PI;

  return (
    <div
      className={styles.marker}
      style={{
        left: screenX,
        top: screenY,
        transform: `translate(-50%, -50%) scale(${inverseScale})`,
        opacity: uncertain ? 0.55 : 1,
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
          fill={uncertain ? "#9AA0A6" : "#1A73E8"}
          stroke={uncertain ? "#5F6368" : "#1557B0"}
          strokeWidth="1"
          strokeDasharray={uncertain ? "2 2" : undefined}
        />
      </svg>
      {name && <span className={styles.name}>{name}</span>}
      {uncertain && <span className={styles.uncertainBadge}>위치 미확정</span>}
    </div>
  );
}
