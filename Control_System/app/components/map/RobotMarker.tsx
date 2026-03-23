"use client";

type RobotMarkerProps = {
  screenX: number;
  screenY: number;
  iconSrc?: string;
  size?: number;
  scale?: number;
};

export default function RobotMarker({
  screenX,
  screenY,
  iconSrc = "/icon/robot_icon(1).png",
  size = 20,
  scale = 1,
}: RobotMarkerProps) {
  const compensated = size / Math.sqrt(scale);
  const clampedSize = Math.max(10, Math.min(23, compensated));

  return (
    <img
      src={iconSrc}
      alt="robot"
      draggable={false}
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        height: clampedSize,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 20,
      }}
    />
  );
}
