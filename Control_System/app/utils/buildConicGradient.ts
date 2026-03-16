import type { DonutCommonInfo } from "@/app/type";

// 기본 배경색
export const DEFAULT_BACKGROUND_COLOR = "#5d6174";

const DEFAULT_COLORS = [
  "#c90a11", // red
  "#098fc2", // blue
  "#76a74c", // green
  "#c67925", // orange
];

export function buildConicGradient(
  data: DonutCommonInfo[] = [],
  colors: string[] = DEFAULT_COLORS,
  background: string = DEFAULT_BACKGROUND_COLOR
): string {
  if (!data || data.length === 0) {
    return `conic-gradient(${background} 0deg 360deg)`;
  }

  const total = data.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return `conic-gradient(${background} 0deg 360deg)`;
  }

  let currentDeg = 0;
  const parts: string[] = [];

  data.forEach((item, idx) => {
    const ratio = item.value / total;
    const deg = ratio * 360;
    const start = currentDeg;
    const end = currentDeg + deg;

    const color = colors[idx % colors.length];
    parts.push(`${color} ${start}deg ${end}deg`);

    currentDeg = end;
  });

  // 마지막 빈 공간(background) 채우기
  if (currentDeg < 360) {
    parts.push(`${background} ${currentDeg}deg 360deg`);
  }

  return `conic-gradient(${parts.join(", ")})`;
}