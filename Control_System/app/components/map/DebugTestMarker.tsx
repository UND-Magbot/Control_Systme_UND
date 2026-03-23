"use client";

type DebugTestMarkerProps = {
  screenX: number;
  screenY: number;
  label: string;
  color?: string;
};

export default function DebugTestMarker({
  screenX,
  screenY,
  label,
  color = "#ff0000",
}: DebugTestMarkerProps) {
  const size = 16;
  const half = size / 2;

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 50,
      }}
    >
      {/* Crosshair */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block" }}
      >
        {/* Horizontal line */}
        <line
          x1={0}
          y1={half}
          x2={size}
          y2={half}
          stroke={color}
          strokeWidth={2}
        />
        {/* Vertical line */}
        <line
          x1={half}
          y1={0}
          x2={half}
          y2={size}
          stroke={color}
          strokeWidth={2}
        />
        {/* Center dot */}
        <circle cx={half} cy={half} r={2} fill={color} />
      </svg>
      {/* Label */}
      <div
        style={{
          position: "absolute",
          top: -18,
          left: "50%",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
          background: "rgba(0,0,0,0.75)",
          color: "#fff",
          fontSize: 10,
          padding: "1px 4px",
          borderRadius: 3,
          lineHeight: "14px",
        }}
      >
        {label}
      </div>
    </div>
  );
}
