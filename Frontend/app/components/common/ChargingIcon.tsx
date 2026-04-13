import React from "react";

type Props = { size?: number; color?: string; style?: React.CSSProperties };

/** 충전 중 번개 아이콘 (배터리 % 옆에 표시) */
export default function ChargingIcon({ size = 14, color = "#f59e0b", style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      style={{ verticalAlign: "middle", marginLeft: 2, ...style }}
      aria-label="충전 중"
    >
      <path d="M13 2L4 14h7v8l9-12h-7V2z" />
    </svg>
  );
}
